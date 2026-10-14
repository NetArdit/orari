/**
 * PostgreSQL implementation of the accounts repository interface (see ../memoryRepository.js).
 *
 * NOT CONNECTED: it takes an injected `pool` (anything with `query(text, values) -> {rows, rowCount}`, such as
 * a `pg` Pool) and nothing in the application creates one. No database, host or credential has been chosen.
 * It has been checked only against a recording fake for the shape of its statements; it has never run against
 * a real PostgreSQL and must not be trusted until the behavioural tests of the in-memory repository pass
 * against one.
 *
 * Every contract that must be atomic is one statement, so no transaction or connection checkout is needed:
 *  - useToken: one conditional UPDATE, the row count decides;
 *  - replacePlan: one conditional UPDATE on the stored revision, the row count decides;
 *  - insertPlan: refuses a retired id and a taken id inside one INSERT;
 *  - deletePlan: the delete and the retirement of the id in one statement;
 *  - outboxClaim: FOR UPDATE SKIP LOCKED, so two dispatchers never take the same message.
 */
export function createPostgresAccountsRepository({ pool }) {
    if (!pool || typeof pool.query !== "function") throw new Error("A pool with query() is required.");
    const q = (text, values = []) => pool.query(text, values);
    const one = (result) => result.rows[0];

    return {
        /* ---- users ---- */
        async createUser(user) {
            const result = await q(
                "INSERT INTO users (id, email, password_hash, name, data, created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (email) DO NOTHING",
                [user.id, user.email, user.passwordHash, user.name, JSON.stringify(user), user.createdAt],
            );
            return result.rowCount === 1 ? { ok: true } : { ok: false, code: "EMAIL_TAKEN" };
        },
        async findUserByEmail(email) {
            return one(await q("SELECT data FROM users WHERE email = $1", [email]))?.data;
        },
        async findUserById(id) {
            return one(await q("SELECT data FROM users WHERE id = $1", [id]))?.data;
        },
        async updateUser(id, changes) {
            const result = await q("UPDATE users SET data = data || $2::jsonb, password_hash = COALESCE($3, password_hash), name = COALESCE($4, name) WHERE id = $1", [
                id,
                JSON.stringify(changes),
                changes.passwordHash ?? null,
                changes.name ?? null,
            ]);
            return result.rowCount === 1;
        },

        /* ---- sessions ---- */
        async createSession(session) {
            await q("INSERT INTO sessions (id, user_id, token_hash, last_seen_at, data) VALUES ($1,$2,$3,$4,$5)", [session.id, session.userId, session.tokenHash, session.lastSeenAt, JSON.stringify(session)]);
        },
        async findSessionByTokenHash(tokenHash) {
            return one(await q("SELECT data FROM sessions WHERE token_hash = $1", [tokenHash]))?.data;
        },
        async touchSession(id, lastSeenAt) {
            await q("UPDATE sessions SET last_seen_at = $2, data = jsonb_set(data, '{lastSeenAt}', to_jsonb($2::text)) WHERE id = $1", [id, lastSeenAt]);
        },
        async listSessions(userId) {
            return (await q("SELECT data FROM sessions WHERE user_id = $1", [userId])).rows.map((r) => r.data);
        },
        async deleteSession(id) {
            return (await q("DELETE FROM sessions WHERE id = $1", [id])).rowCount === 1;
        },
        async deleteSessionsOf(userId, exceptId) {
            return (await q("DELETE FROM sessions WHERE user_id = $1 AND ($2::text IS NULL OR id <> $2)", [userId, exceptId ?? null])).rowCount;
        },

        /* ---- one-time tokens ---- */
        async createToken(token) {
            await q("INSERT INTO tokens (id, user_id, purpose, token_hash, expires_at, used_at) VALUES ($1,$2,$3,$4,$5,$6)", [token.id, token.userId, token.purpose, token.tokenHash, token.expiresAt, token.usedAt ?? null]);
        },
        async findTokenByHash(purpose, tokenHash) {
            const row = one(await q("SELECT id, user_id, purpose, token_hash, expires_at, used_at FROM tokens WHERE purpose = $1 AND token_hash = $2", [purpose, tokenHash]));
            return row && { id: row.id, userId: row.user_id, purpose: row.purpose, tokenHash: row.token_hash, expiresAt: row.expires_at, usedAt: row.used_at };
        },
        /** Atomic: of two concurrent uses exactly one updates a row. Expiry is checked at the moment of use. */
        async useToken(id, usedAt) {
            return (await q("UPDATE tokens SET used_at = $2 WHERE id = $1 AND used_at IS NULL AND expires_at > $2", [id, usedAt])).rowCount === 1;
        },
        async voidTokens(userId, purpose, usedAt) {
            await q("UPDATE tokens SET used_at = $3 WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL", [userId, purpose, usedAt]);
        },

        /* ---- outbox ---- */
        async outboxAdd(message) {
            await q("INSERT INTO outbox (id, user_id, created_at, next_attempt_at, data) VALUES ($1,$2,$3,$4,$5)", [message.id, message.userId ?? null, message.createdAt, message.nextAttemptAt, JSON.stringify(message)]);
        },
        async outboxClaim({ now, limit, leaseUntil }) {
            const result = await q(
                `UPDATE outbox SET lease_until = $3, data = jsonb_set(data, '{leaseUntil}', to_jsonb($3::text))
                 WHERE id IN (
                     SELECT id FROM outbox
                     WHERE failed_at IS NULL AND next_attempt_at <= $1 AND (lease_until IS NULL OR lease_until <= $1)
                     ORDER BY created_at LIMIT $2 FOR UPDATE SKIP LOCKED)
                 RETURNING data`,
                [now, limit, leaseUntil],
            );
            return result.rows.map((r) => r.data).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        },
        async outboxDone(id) {
            await q("DELETE FROM outbox WHERE id = $1", [id]);
        },
        async outboxFail(id, { attempts, nextAttemptAt, failedAt }) {
            if (failedAt) {
                // Giving up drops the link the message held.
                await q("UPDATE outbox SET failed_at = $2, lease_until = NULL, data = (data - 'link' - 'leaseUntil') || jsonb_build_object('attempts', $3::int, 'failedAt', $2::text) WHERE id = $1", [id, failedAt, attempts]);
            } else {
                await q("UPDATE outbox SET next_attempt_at = $2, lease_until = NULL, data = (data - 'leaseUntil') || jsonb_build_object('attempts', $3::int, 'nextAttemptAt', $2::text) WHERE id = $1", [id, nextAttemptAt, attempts]);
            }
        },
        async outboxStats() {
            const row = one(await q("SELECT count(*) FILTER (WHERE failed_at IS NULL)::int AS waiting, count(*) FILTER (WHERE failed_at IS NOT NULL)::int AS failed FROM outbox"));
            return { waiting: row.waiting, failed: row.failed };
        },

        /* ---- plans ---- */
        async insertPlan(userId, plan) {
            const result = await q(
                `INSERT INTO plans (user_id, id, revision, data)
                 SELECT $1, $2, $3, $4
                 WHERE NOT EXISTS (SELECT 1 FROM retired_plans WHERE user_id = $1 AND plan_id = $2)
                 ON CONFLICT (user_id, id) DO NOTHING`,
                [userId, plan.id, plan.revision, JSON.stringify(plan)],
            );
            return result.rowCount === 1 ? { ok: true } : { ok: false, code: "PLAN_EXISTS" };
        },
        async getPlan(userId, planId) {
            return one(await q("SELECT data FROM plans WHERE user_id = $1 AND id = $2", [userId, planId]))?.data;
        },
        async listPlans(userId) {
            return (await q("SELECT data FROM plans WHERE user_id = $1 ORDER BY id", [userId])).rows.map((r) => r.data);
        },
        /** Compare-and-swap on the stored revision; on a miss the current row tells which kind of miss it was. */
        async replacePlan(userId, plan, baseRevision) {
            const result = await q("UPDATE plans SET revision = $4, data = $3 WHERE user_id = $1 AND id = $2 AND revision = $5", [userId, plan.id, JSON.stringify(plan), plan.revision, baseRevision]);
            if (result.rowCount === 1) return { ok: true };
            const current = one(await q("SELECT data FROM plans WHERE user_id = $1 AND id = $2", [userId, plan.id]))?.data;
            return current ? { ok: false, code: "REVISION_CONFLICT", current } : { ok: false, code: "NOT_FOUND" };
        },
        async deletePlan(userId, planId) {
            const result = await q(
                `WITH removed AS (DELETE FROM plans WHERE user_id = $1 AND id = $2 RETURNING id),
                      retired AS (INSERT INTO retired_plans (user_id, plan_id) SELECT $1, id FROM removed ON CONFLICT DO NOTHING)
                 SELECT count(*)::int AS n FROM removed`,
                [userId, planId],
            );
            return one(result).n === 1;
        },

        /* ---- erasure ---- */
        async eraseUser(userId) {
            // Sessions, tokens, plans and retired ids go with the user row (ON DELETE CASCADE); the outbox has no foreign key.
            await q("DELETE FROM outbox WHERE user_id = $1", [userId]);
            await q("DELETE FROM users WHERE id = $1", [userId]);
        },
    };
}
