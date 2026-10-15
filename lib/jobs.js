/**
 * Long work as a job that is started, polled and, if wanted, cancelled, instead of one request held open.
 *
 * What it is: an in-process store. A job is owned by one caller (an account id, or an address when there is no
 * account); nobody else can read or cancel it, and an unknown id and someone else's id look the same.
 *
 * What it is NOT: durable. Jobs, results and idempotency keys live in this process's memory. A restart loses
 * them, and a poller then gets "not found" and must start again. Surviving a restart needs a store outside the
 * process, which does not exist yet (no database or host has been chosen). Nothing here may be described as
 * durable.
 *
 * Lifecycle: running -> done | failed | cancelled; a finished job is kept for `resultTtlMs` and then is gone
 * (reads answer "not found"). Starting a job with an idempotency key already used by the same owner returns the
 * same job, so a retried start after a lost answer does not run the work twice. The same key with a different
 * request (another kind or other content) is refused, never answered with the first request's job.
 */

/** JSON with object keys in sorted order, so two equal values always give the same text. Used to compare requests. */
export function canonicalJson(value) {
    if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
    if (value && typeof value === "object") {
        return `{${Object.keys(value)
            .sort()
            .filter((k) => value[k] !== undefined)
            .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
            .join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}

const DEFAULTS = { resultTtlMs: 10 * 60_000, maxRunning: 4, maxRunningPerOwner: 1, maxKeptPerOwner: 5, maxKept: 500, maxKeyLength: 100 };

export function createJobStore({ now = () => Date.now(), newId = () => crypto.randomUUID(), ...options } = {}) {
    const config = { ...DEFAULTS, ...options };
    /** id -> job */ const jobs = new Map();
    /** `${owner}|${key}` -> id */ const keys = new Map();

    function sweep() {
        const t = now();
        for (const [id, job] of jobs) {
            if (job.finishedAt !== null && t - job.finishedAt >= config.resultTtlMs) {
                jobs.delete(id);
                if (job.keyRef) keys.delete(job.keyRef);
            }
        }
    }

    const running = () => [...jobs.values()].filter((j) => j.status === "running");
    const snapshot = (job) => ({
        id: job.id,
        status: job.status,
        createdAt: job.createdAt,
        ...(job.status === "done" || job.status === "failed" ? { result: job.result } : {}),
    });

    return {
        /**
         * @param {string} owner
         * @param {(signal: AbortSignal) => Promise<{status: number, body: unknown}>} run
         * @param {{key?: string, fingerprint?: string}} [meta] fingerprint names the request (kind and body); a key is only ever reused for the same one
         * @returns {{ok: true, job: object, existing: boolean} | {ok: false, code: "BUSY" | "KEY_INVALID" | "KEY_REUSED"}}
         */
        start(owner, run, { key, fingerprint = "" } = {}) {
            sweep();
            if (key !== undefined && (typeof key !== "string" || key.length < 8 || key.length > config.maxKeyLength)) return { ok: false, code: "KEY_INVALID" };
            const keyRef = key === undefined ? null : `${owner}|${key}`;
            if (keyRef && keys.has(keyRef)) {
                const existing = jobs.get(keys.get(keyRef));
                if (existing) {
                    // The same key for another request is a client mistake: never answer it with the first request's job.
                    if (existing.fingerprint !== fingerprint) return { ok: false, code: "KEY_REUSED" };
                    return { ok: true, job: snapshot(existing), existing: true };
                }
            }
            const mine = [...jobs.values()].filter((j) => j.owner === owner);
            if (mine.filter((j) => j.status === "running").length >= config.maxRunningPerOwner) return { ok: false, code: "BUSY" };
            if (running().length >= config.maxRunning) return { ok: false, code: "BUSY" };
            if (mine.length >= config.maxKeptPerOwner) return { ok: false, code: "BUSY" };
            if (jobs.size >= config.maxKept) return { ok: false, code: "BUSY" };

            const controller = new AbortController();
            const job = { id: newId(), owner, status: "running", createdAt: new Date(now()).toISOString(), finishedAt: null, result: null, keyRef, fingerprint, controller };
            jobs.set(job.id, job);
            if (keyRef) keys.set(keyRef, job.id);

            Promise.resolve()
                .then(() => run(controller.signal))
                .then(
                    (result) => {
                        if (job.status !== "running") return;
                        job.status = result.status >= 200 && result.status < 300 ? "done" : "failed";
                        job.result = { status: result.status, body: result.body };
                    },
                    () => {
                        if (job.status !== "running") return;
                        job.status = "failed";
                        job.result = { status: 500, body: { code: "INTERNAL", error: "Something went wrong. Try again." } };
                    },
                )
                .finally(() => {
                    // A cancelled job already has its finish time; the late unwinding of its work must not extend its life.
                    if (job.finishedAt === null) job.finishedAt = now();
                });
            return { ok: true, job: snapshot(job), existing: false };
        },

        /** The job, only for its owner; otherwise null (same answer as for an id that never existed). */
        get(owner, id) {
            sweep();
            const job = jobs.get(id);
            return job && job.owner === owner ? snapshot(job) : null;
        },

        /** Stops a running job. Returns false for an unknown or foreign id; a finished job is left as it is. */
        cancel(owner, id) {
            sweep();
            const job = jobs.get(id);
            if (!job || job.owner !== owner) return false;
            if (job.status === "running") {
                job.status = "cancelled";
                job.finishedAt = now();
                job.controller.abort();
            }
            return true;
        },

        /** For tests and status pages: how many jobs are running and how many are kept. */
        stats() {
            sweep();
            return { running: running().length, kept: jobs.size };
        },
    };
}

/**
 * Lets an Express handler that answers with res.status(...).json(...) run as a job: it gets a request-like
 * object with the body and a response-like object that records the answer. Closing the response (a cancel)
 * fires its "close" listeners with writableEnded false, which is how the handlers notice and stop.
 */
export function runHandlerAsJob(handler, { body, account }) {
    return (signal) =>
        new Promise((resolve, reject) => {
            const closers = [];
            let finished = false;
            const res = {
                statusCode: 200,
                writableEnded: false,
                status(code) {
                    this.statusCode = code;
                    return this;
                },
                json(payload) {
                    if (finished) return this;
                    finished = true;
                    this.writableEnded = true;
                    resolve({ status: this.statusCode, body: payload });
                    return this;
                },
                on(event, listener) {
                    if (event === "close") closers.push(listener);
                    return this;
                },
            };
            signal.addEventListener("abort", () => {
                if (finished) return;
                finished = true;
                for (const listener of closers) listener();
                reject(new Error("cancelled"));
            });
            Promise.resolve(handler({ body, account }, res)).then(() => {
                // A handler that answered nobody (aborted) leaves the promise to the cancel path above.
                if (!finished && signal.aborted) return;
            }, reject);
        });
}
