/**
 * The storage the account logic needs, as a narrow interface, and an in-memory implementation of it.
 *
 * Nothing here knows about HTTP, passwords or e-mail. A PostgreSQL adapter will implement the same
 * methods later; until a host is chosen the logic and its tests run against this one. Every method is
 * async so that swapping in a database changes nothing for callers. Values passed in and out are
 * copied, so a caller can never change stored data by holding on to an object.
 *
 * @typedef {object} UserRecord
 * @property {string} id
 * @property {string} email            lower-case, unique
 * @property {string} passwordHash
 * @property {string} name
 * @property {string|null} emailVerifiedAt
 * @property {string} createdAt
 *
 * @typedef {object} SessionRecord
 * @property {string} id
 * @property {string} userId
 * @property {string} tokenHash        SHA-256 of the cookie value; the value itself is never stored
 * @property {string} createdAt
 * @property {string} lastSeenAt
 * @property {string} userAgent        short label for the device list
 *
 * @typedef {object} TokenRecord       reset and e-mail verification tokens
 * @property {string} id
 * @property {string} userId
 * @property {"reset"|"verify"} purpose
 * @property {string} tokenHash
 * @property {string} expiresAt
 * @property {string|null} usedAt
 */

const copy = (value) => (value === undefined ? undefined : structuredClone(value));

export function createMemoryAccountsRepository() {
    /** @type {Map<string, UserRecord>} */ const users = new Map();
    /** @type {Map<string, SessionRecord>} */ const sessions = new Map();
    /** @type {Map<string, TokenRecord>} */ const tokens = new Map();
    /** userId -> Map(planId -> plan record) */ const plans = new Map();

    const plansOf = (userId) => plans.get(userId) ?? plans.set(userId, new Map()).get(userId);

    return {
        /* ---- users ---- */
        async createUser(user) {
            if ([...users.values()].some((u) => u.email === user.email)) return { ok: false, code: "EMAIL_TAKEN" };
            users.set(user.id, copy(user));
            return { ok: true };
        },
        async findUserByEmail(email) {
            return copy([...users.values()].find((u) => u.email === email));
        },
        async findUserById(id) {
            return copy(users.get(id));
        },
        async updateUser(id, changes) {
            const user = users.get(id);
            if (!user) return false;
            Object.assign(user, copy(changes));
            return true;
        },

        /* ---- sessions ---- */
        async createSession(session) {
            sessions.set(session.id, copy(session));
        },
        async findSessionByTokenHash(tokenHash) {
            return copy([...sessions.values()].find((s) => s.tokenHash === tokenHash));
        },
        async touchSession(id, lastSeenAt) {
            const session = sessions.get(id);
            if (session) session.lastSeenAt = lastSeenAt;
        },
        async listSessions(userId) {
            return copy([...sessions.values()].filter((s) => s.userId === userId));
        },
        async deleteSession(id) {
            return sessions.delete(id);
        },
        /** Removes every session of a user, except one if given. Returns how many were removed. */
        async deleteSessionsOf(userId, exceptId) {
            let removed = 0;
            for (const [id, session] of sessions) {
                if (session.userId === userId && id !== exceptId) {
                    sessions.delete(id);
                    removed++;
                }
            }
            return removed;
        },

        /* ---- one-time tokens ---- */
        async createToken(token) {
            tokens.set(token.id, copy(token));
        },
        async findTokenByHash(purpose, tokenHash) {
            return copy([...tokens.values()].find((t) => t.purpose === purpose && t.tokenHash === tokenHash));
        },
        /** Marks a token used, only if it was not already: of two concurrent uses exactly one wins. */
        async useToken(id, usedAt) {
            const token = tokens.get(id);
            if (!token || token.usedAt) return false;
            token.usedAt = usedAt;
            return true;
        },
        /** Makes every unused token of a purpose for a user unusable (a newer request replaces older ones). */
        async voidTokens(userId, purpose, usedAt) {
            for (const token of tokens.values()) if (token.userId === userId && token.purpose === purpose && !token.usedAt) token.usedAt = usedAt;
        },

        /* ---- plans, owned by a user ---- */
        async insertPlan(userId, plan) {
            const own = plansOf(userId);
            if (own.has(plan.id)) return { ok: false, code: "PLAN_EXISTS" };
            own.set(plan.id, copy(plan));
            return { ok: true };
        },
        async getPlan(userId, planId) {
            return copy(plansOf(userId).get(planId));
        },
        async listPlans(userId) {
            return copy([...plansOf(userId).values()]);
        },
        /** Replaces a plan only if its stored revision is the one the caller based its change on. */
        async replacePlan(userId, plan, baseRevision) {
            const own = plansOf(userId);
            const current = own.get(plan.id);
            if (!current) return { ok: false, code: "NOT_FOUND" };
            if (current.revision !== baseRevision) return { ok: false, code: "REVISION_CONFLICT", current: copy(current) };
            own.set(plan.id, copy(plan));
            return { ok: true };
        },
        async deletePlan(userId, planId) {
            return plansOf(userId).delete(planId);
        },

        /* ---- erasure ---- */
        /** Everything held about a user: the account, its sessions, its tokens, its plans. */
        async eraseUser(userId) {
            users.delete(userId);
            for (const [id, s] of sessions) if (s.userId === userId) sessions.delete(id);
            for (const [id, t] of tokens) if (t.userId === userId) tokens.delete(id);
            plans.delete(userId);
        },

        /** For tests: whether anything at all still refers to a user. */
        async _holdsAnythingFor(userId) {
            return users.has(userId) || [...sessions.values()].some((s) => s.userId === userId) || [...tokens.values()].some((t) => t.userId === userId) || (plans.get(userId)?.size ?? 0) > 0;
        },
    };
}
