/**
 * The job store of lib/jobs.js, kept in PostgreSQL so that it works where no process lives between requests
 * (Netlify functions). The rules are the same: a job belongs to one caller, an unknown id and someone else's id
 * look alike, one running job per caller, the same idempotency key with the same request gives the same job and
 * with another request is refused.
 *
 * The work itself does not run in the request that starts it. `dispatch(id)` asks something else to run it (a
 * Netlify background function) and `runJob(id)` is what that something calls. A cancel marks the job; the
 * running work is not interrupted (a different process runs it) but its late answer is thrown away.
 *
 * Every call here is async. The store is a drop-in for the interface the routes use in lib/app.js.
 */
const DEFAULTS = { resultTtlMs: 10 * 60_000, staleRunningMs: 5 * 60_000, maxRunning: 4, maxRunningPerOwner: 1, maxKeptPerOwner: 5, maxKeyLength: 100 };

export const JOBS_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS jobs (
    id          TEXT PRIMARY KEY,
    owner       TEXT NOT NULL,
    kind        TEXT NOT NULL,
    status      TEXT NOT NULL CHECK (status IN ('running', 'done', 'failed', 'cancelled')),
    payload     JSONB NOT NULL,
    result      JSONB,
    idem_key    TEXT,
    fingerprint TEXT NOT NULL DEFAULT '',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    finished_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS jobs_owner_key ON jobs (owner, idem_key) WHERE idem_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS jobs_owner ON jobs (owner, created_at);
`;

const snapshot = (row) => ({
    id: row.id,
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    ...(row.status === "done" || row.status === "failed" ? { result: row.result } : {}),
});

/**
 * @param {{ pool: { query(text: string, values?: unknown[]): Promise<{rows: any[], rowCount: number}> }, dispatch: (id: string) => Promise<void>, newId?: () => string }} options
 */
export function createDbJobStore({ pool, dispatch, newId = () => crypto.randomUUID(), ...options }) {
    const config = { ...DEFAULTS, ...options };
    const q = (text, values = []) => pool.query(text, values);

    async function sweep() {
        // Finished jobs go after their time; a job that has been "running" far longer than any work can is failed, not left hanging.
        await q("DELETE FROM jobs WHERE status <> 'running' AND finished_at < now() - ($1 || ' milliseconds')::interval", [String(config.resultTtlMs)]);
        await q(
            `UPDATE jobs SET status = 'failed', finished_at = now(), result = $2::jsonb
              WHERE status = 'running' AND created_at < now() - ($1 || ' milliseconds')::interval`,
            [String(config.staleRunningMs), JSON.stringify({ status: 500, body: { code: "INTERNAL", error: "Something went wrong. Try again." } })],
        );
    }

    return {
        async start(owner, { kind, body, account }, { key, fingerprint = "" } = {}) {
            await sweep();
            if (key !== undefined && (typeof key !== "string" || key.length < 8 || key.length > config.maxKeyLength)) return { ok: false, code: "KEY_INVALID" };
            if (key !== undefined) {
                const existing = (await q("SELECT * FROM jobs WHERE owner = $1 AND idem_key = $2", [owner, key])).rows[0];
                if (existing) return existing.fingerprint !== fingerprint ? { ok: false, code: "KEY_REUSED" } : { ok: true, job: snapshot(existing), existing: true };
            }
            const counts = (await q(
                `SELECT count(*) FILTER (WHERE owner = $1 AND status = 'running')::int AS mine_running,
                        count(*) FILTER (WHERE owner = $1)::int AS mine,
                        count(*) FILTER (WHERE status = 'running')::int AS running
                   FROM jobs`,
                [owner],
            )).rows[0];
            if (counts.mine_running >= config.maxRunningPerOwner || counts.running >= config.maxRunning || counts.mine >= config.maxKeptPerOwner) return { ok: false, code: "BUSY" };

            const id = newId();
            let inserted;
            try {
                inserted = (await q(
                    "INSERT INTO jobs (id, owner, kind, status, payload, idem_key, fingerprint) VALUES ($1,$2,$3,'running',$4::jsonb,$5,$6) RETURNING *",
                    [id, owner, kind, JSON.stringify({ body, account: account ?? null }), key ?? null, fingerprint],
                )).rows[0];
            } catch (error) {
                // Two starts with one key at the same moment: the unique index lets one in; the other gets that job.
                if (error?.code === "23505" && key !== undefined) {
                    const existing = (await q("SELECT * FROM jobs WHERE owner = $1 AND idem_key = $2", [owner, key])).rows[0];
                    if (existing) return existing.fingerprint !== fingerprint ? { ok: false, code: "KEY_REUSED" } : { ok: true, job: snapshot(existing), existing: true };
                }
                throw error;
            }
            try {
                await dispatch(id);
            } catch {
                await q("UPDATE jobs SET status = 'failed', finished_at = now(), result = $2::jsonb WHERE id = $1 AND status = 'running'", [id, JSON.stringify({ status: 503, body: { code: "SERVER_BUSY", error: "The service is busy right now. Try again in a moment." } })]);
                return { ok: true, job: snapshot((await q("SELECT * FROM jobs WHERE id = $1", [id])).rows[0]), existing: false };
            }
            return { ok: true, job: snapshot(inserted), existing: false };
        },

        async get(owner, id) {
            await sweep();
            const row = (await q("SELECT * FROM jobs WHERE id = $1 AND owner = $2", [id, owner])).rows[0];
            return row ? snapshot(row) : null;
        },

        async cancel(owner, id) {
            await sweep();
            const row = (await q("SELECT id, status FROM jobs WHERE id = $1 AND owner = $2", [id, owner])).rows[0];
            if (!row) return false;
            if (row.status === "running") await q("UPDATE jobs SET status = 'cancelled', finished_at = now() WHERE id = $1 AND status = 'running'", [id]);
            return true;
        },

        /** What the background function calls: runs the work of a job that is still running and records its answer. */
        async runJob(id, run) {
            const row = (await q("SELECT kind, payload FROM jobs WHERE id = $1 AND status = 'running'", [id])).rows[0];
            if (!row) return false;
            let result;
            try {
                result = await run(row.kind, row.payload);
            } catch {
                result = { status: 500, body: { code: "INTERNAL", error: "Something went wrong. Try again." } };
            }
            // Only a job still running takes the answer: a cancelled one keeps its status and no result.
            await q(
                "UPDATE jobs SET status = $2, result = $3::jsonb, finished_at = now(), payload = '{}'::jsonb WHERE id = $1 AND status = 'running'",
                [id, result.status >= 200 && result.status < 300 ? "done" : "failed", JSON.stringify({ status: result.status, body: result.body })],
            );
            return true;
        },
    };
}
