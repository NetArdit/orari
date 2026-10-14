/**
 * Account logic: sign-up, sign-in, sessions, password reset, e-mail verification, plans and marks.
 *
 * Everything outside the process is a dependency passed in: the repository (lib/accounts/
 * memoryRepository.js, later a PostgreSQL adapter), the password hasher, the mailer, the
 * compromised-password check, the clock and the id and token generators. No HTTP here: a route turns
 * these results into responses. Every failure is a result with a stable `code`, never an exception.
 *
 * Rules implemented here come from Codex's rulings of 2026-10-14 and OWASP's Authentication,
 * Password Storage, Forgot Password and Session Management cheat sheets.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { checkPasswordPolicy } from "./password.js";

export const LIMITS = Object.freeze({
    sessionIdleDays: 30,
    sessionAbsoluteDays: 90,
    resetMinutes: 30,
    verifyHours: 24,
    touchEveryMs: 60_000,
    maxPasswordInput: 1024,
    maxPlansPerUser: 200,
    appliedOpsKept: 200,
});

const DAY = 86_400_000;

export const hashToken = (token) => createHash("sha256").update(token).digest("hex");
const defaultNewToken = () => randomBytes(32).toString("base64url");

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normaliseEmail(input) {
    if (typeof input !== "string") return null;
    const email = input.trim().toLowerCase();
    return email.length <= 254 && EMAIL.test(email) ? email : null;
}

/**
 * @param {object} deps
 * @param {ReturnType<import("./memoryRepository.js").createMemoryAccountsRepository>} deps.repo
 * @param {ReturnType<import("./password.js").createPasswordHasher>} deps.hasher
 * @param {{ sendVerification(m:{to:string,link:string}):Promise<void>, sendReset(m:{to:string,link:string}):Promise<void>, sendPasswordChanged(m:{to:string}):Promise<void>, sendAccountExists(m:{to:string}):Promise<void>, sendAccountDeleted(m:{to:string}):Promise<void> }} deps.mail
 * @param {(password:string)=>Promise<{status:"clean"|"compromised"|"unavailable"}>} deps.passwordCheck
 * @param {string} deps.baseUrl  the site's own address, from configuration: links are never built from a request's Host header
 * @param {()=>Date} [deps.now]
 */
export function createAccountService({ repo, hasher, mail, passwordCheck, baseUrl, now = () => new Date(), newId = randomUUID, newToken = defaultNewToken }) {
    const iso = () => now().toISOString();
    const at = (ms) => new Date(now().getTime() + ms).toISOString();
    const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, emailVerified: Boolean(u.emailVerifiedAt) });

    // One hash of a throwaway password, started when the service is made (not on the first unknown
    // sign-in, which would then be the slow one), so that signing in with an unknown address costs
    // the same as signing in with a known one. This removes one visible difference; it does not prove
    // the response times are equal. That has to be measured against the real storage, and rate limits
    // are what bound what an observer can learn.
    const decoy = hasher.hash("een-wachtwoord-dat-niemand-gebruikt");
    decoy.catch(() => undefined);
    const decoyHash = () => decoy;

    /* Mail goes through an outbox. The message is stored first and sent afterwards, so a crash or a
       provider outage between the decision and the send loses nothing: dispatchMail() (called after
       every enqueue and by a timer in the server) sends what is due, with growing delays, and gives
       up after five attempts, dropping the link it held. How long the provider takes never delays the
       answer to a visitor. */
    const RETRY_DELAYS_MIN = [1, 5, 15, 60, 240];
    const send = {
        verification: (m) => mail.sendVerification({ to: m.to, link: m.link }),
        reset: (m) => mail.sendReset({ to: m.to, link: m.link }),
        changed: (m) => mail.sendPasswordChanged({ to: m.to }),
        exists: (m) => mail.sendAccountExists({ to: m.to }),
        deleted: (m) => mail.sendAccountDeleted({ to: m.to }),
    };

    let dispatching = null;
    async function dispatchOnce() {
        const due = await repo.outboxClaim({ now: iso(), limit: 20, leaseUntil: at(2 * 60_000) });
        let sent = 0;
        for (const message of due) {
            if (message.expiresAt && message.expiresAt <= iso()) {
                await repo.outboxDone(message.id); // the link inside has already stopped working
                continue;
            }
            try {
                await send[message.kind](message);
                await repo.outboxDone(message.id);
                sent++;
            } catch {
                const attempts = message.attempts + 1;
                if (attempts >= RETRY_DELAYS_MIN.length) await repo.outboxFail(message.id, { attempts, failedAt: iso() });
                else await repo.outboxFail(message.id, { attempts, nextAttemptAt: at(RETRY_DELAYS_MIN[attempts - 1] * 60_000) });
            }
        }
        return sent;
    }
    // One dispatch at a time in this process; a second request while one runs shares it.
    const dispatchMail = () => (dispatching ??= dispatchOnce().finally(() => (dispatching = null)));

    async function enqueueMail(kind, userId, to, extra = {}) {
        await repo.outboxAdd({ id: newId(), kind, userId, to, createdAt: iso(), nextAttemptAt: iso(), attempts: 0, ...extra });
        void dispatchMail().catch(() => undefined);
    }

    async function checkNewPassword(password) {
        const policy = checkPasswordPolicy(password);
        if (!policy.ok) return policy;
        const check = await passwordCheck(password);
        if (check.status === "compromised") return { ok: false, code: "PASSWORD_COMPROMISED" };
        // Not "clean": the check could not be made, and the person is told so instead of being waved through.
        if (check.status === "unavailable") return { ok: false, code: "PASSWORD_CHECK_UNAVAILABLE" };
        return { ok: true };
    }

    async function issueToken(userId, purpose, ttlMs) {
        const token = newToken();
        await repo.voidTokens(userId, purpose, iso());
        await repo.createToken({ id: newId(), userId, purpose, tokenHash: hashToken(token), expiresAt: at(ttlMs), usedAt: null });
        return token;
    }

    async function takeToken(purpose, token) {
        if (typeof token !== "string" || token.length < 20 || token.length > 200) return null;
        const record = await repo.findTokenByHash(purpose, hashToken(token));
        if (!record || record.usedAt || new Date(record.expiresAt) <= now()) return null;
        return record;
    }

    async function startSession(user, userAgent) {
        const token = newToken();
        const session = { id: newId(), userId: user.id, tokenHash: hashToken(token), createdAt: iso(), lastSeenAt: iso(), userAgent: String(userAgent ?? "").slice(0, 120) };
        await repo.createSession(session);
        return { token, sessionId: session.id };
    }

    const service = {
        /* ======================= sign-up and e-mail ======================= */

        /**
         * The answer is the same whether or not the address already has an account: the owner of an
         * existing address gets a different e-mail, the visitor learns nothing.
         */
        async signUp({ email, password, name, confirmsAge16 }) {
            const address = normaliseEmail(email);
            if (!address) return { ok: false, code: "EMAIL_INVALID" };
            const displayName = typeof name === "string" ? name.trim() : "";
            if (displayName.length < 1 || displayName.length > 80) return { ok: false, code: "NAME_INVALID" };
            // Orari is for people of 16 and over (Kosovo law 06/L-082, Art. 7). This is a declaration, not proof.
            if (confirmsAge16 !== true) return { ok: false, code: "AGE_NOT_CONFIRMED" };
            const accepted = await checkNewPassword(password);
            if (!accepted.ok) return accepted;

            const passwordHash = await hasher.hash(password);
            const existing = await repo.findUserByEmail(address);
            if (existing) {
                await enqueueMail("exists", existing.id, address);
                return { ok: true, status: "check_email" };
            }

            const user = { id: newId(), email: address, passwordHash, name: displayName, emailVerifiedAt: null, createdAt: iso() };
            const created = await repo.createUser(user);
            if (!created.ok) {
                // Lost a race with another sign-up for the same address: behave as if it had existed.
                await enqueueMail("exists", null, address);
                return { ok: true, status: "check_email" };
            }
            const token = await issueToken(user.id, "verify", LIMITS.verifyHours * 3_600_000);
            await enqueueMail("verification", user.id, address, { link: `${baseUrl}/app/verify#token=${token}`, expiresAt: at(LIMITS.verifyHours * 3_600_000) });
            return { ok: true, status: "check_email" };
        },

        async verifyEmail(token) {
            const record = await takeToken("verify", token);
            if (!record) return { ok: false, code: "TOKEN_INVALID" };
            if (!(await repo.useToken(record.id, iso()))) return { ok: false, code: "TOKEN_INVALID" };
            await repo.updateUser(record.userId, { emailVerifiedAt: iso() });
            return { ok: true };
        },

        /** A new verification link, for the signed-in person. Older links stop working. */
        async resendVerification(userId) {
            const user = await repo.findUserById(userId);
            if (!user || user.emailVerifiedAt) return { ok: true };
            const token = await issueToken(user.id, "verify", LIMITS.verifyHours * 3_600_000);
            await enqueueMail("verification", user.id, user.email, { link: `${baseUrl}/app/verify#token=${token}`, expiresAt: at(LIMITS.verifyHours * 3_600_000) });
            return { ok: true };
        },

        /** Plan sync and the AI need a verified address (Codex, Q5). The rest of the account does not. */
        canUseSyncAndAi: (user) => Boolean(user?.emailVerified),

        /** Sends the mail that is due. Called after every enqueue, and on a timer so that a restart picks up what was left. Returns how many were sent. */
        dispatchMail,

        async mailStats() {
            return repo.outboxStats();
        },

        /* ============================ sign-in ============================ */

        async logIn({ email, password, userAgent }) {
            const address = normaliseEmail(email);
            const tooLong = typeof password !== "string" || password.length > LIMITS.maxPasswordInput;
            const user = address ? await repo.findUserByEmail(address) : undefined;
            const storedHash = user?.passwordHash ?? (await decoyHash());
            const matches = tooLong ? false : await hasher.verify(password, storedHash);
            if (!user || !matches) return { ok: false, code: "INVALID_CREDENTIALS" };

            if (hasher.needsRehash(user.passwordHash)) await repo.updateUser(user.id, { passwordHash: await hasher.hash(password) });
            // A new token at every sign-in: a session id seen before sign-in is never valid after it.
            const { token, sessionId } = await startSession(user, userAgent);
            return { ok: true, token, sessionId, user: publicUser(user) };
        },

        /** The person behind a cookie value, or why there is none. Expired sessions are removed here. */
        async authenticate(token) {
            if (typeof token !== "string" || token.length < 20 || token.length > 200) return { ok: false, code: "UNAUTHENTICATED" };
            const session = await repo.findSessionByTokenHash(hashToken(token));
            if (!session) return { ok: false, code: "UNAUTHENTICATED" };

            const age = now().getTime() - new Date(session.createdAt).getTime();
            const idle = now().getTime() - new Date(session.lastSeenAt).getTime();
            if (age > LIMITS.sessionAbsoluteDays * DAY || idle > LIMITS.sessionIdleDays * DAY) {
                await repo.deleteSession(session.id);
                return { ok: false, code: "UNAUTHENTICATED" };
            }

            const user = await repo.findUserById(session.userId);
            if (!user) {
                await repo.deleteSession(session.id);
                return { ok: false, code: "UNAUTHENTICATED" };
            }
            if (idle > LIMITS.touchEveryMs) await repo.touchSession(session.id, iso());
            return { ok: true, user: publicUser(user), sessionId: session.id };
        },

        async logOut(token) {
            const session = typeof token === "string" ? await repo.findSessionByTokenHash(hashToken(token)) : undefined;
            if (session) await repo.deleteSession(session.id);
            return { ok: true };
        },

        async listSessions(userId, currentSessionId) {
            const sessions = await repo.listSessions(userId);
            return sessions
                .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
                .map((s) => ({ id: s.id, device: s.userAgent, createdAt: s.createdAt, lastSeenAt: s.lastSeenAt, current: s.id === currentSessionId }));
        },

        /** Ends one of this person's own sessions. Someone else's session id is simply not found. */
        async revokeSession(userId, sessionId) {
            const own = (await repo.listSessions(userId)).some((s) => s.id === sessionId);
            if (!own) return { ok: false, code: "NOT_FOUND" };
            await repo.deleteSession(sessionId);
            return { ok: true };
        },

        async revokeOtherSessions(userId, currentSessionId) {
            return { ok: true, removed: await repo.deleteSessionsOf(userId, currentSessionId) };
        },

        /* ============================ passwords ============================ */

        /** Always the same answer. A link goes out only if the address has an account. */
        async requestPasswordReset({ email }) {
            const address = normaliseEmail(email);
            const user = address ? await repo.findUserByEmail(address) : undefined;
            if (user) {
                const token = await issueToken(user.id, "reset", LIMITS.resetMinutes * 60_000);
                // The token is in the fragment, so it is not sent to the server by the browser and not passed on in a Referer header.
                await enqueueMail("reset", user.id, user.email, { link: `${baseUrl}/app/reset#token=${token}`, expiresAt: at(LIMITS.resetMinutes * 60_000) });
            }
            return { ok: true };
        },

        /**
         * A weak or compromised new password is refused WITHOUT using up the link. After a reset all
         * sessions end, other links stop working, and the person must sign in again: no automatic sign-in.
         */
        async resetPassword({ token, newPassword }) {
            const record = await takeToken("reset", token);
            if (!record) return { ok: false, code: "TOKEN_INVALID" };
            const accepted = await checkNewPassword(newPassword);
            if (!accepted.ok) return accepted;

            if (!(await repo.useToken(record.id, iso()))) return { ok: false, code: "TOKEN_INVALID" };
            const user = await repo.findUserById(record.userId);
            if (!user) return { ok: false, code: "TOKEN_INVALID" };

            // Using the link shows control of the mailbox, which is what verification asks for.
            await repo.updateUser(user.id, { passwordHash: await hasher.hash(newPassword), emailVerifiedAt: user.emailVerifiedAt ?? iso() });
            await repo.voidTokens(user.id, "reset", iso());
            await repo.deleteSessionsOf(user.id);
            await enqueueMail("changed", user.id, user.email);
            return { ok: true };
        },

        async changePassword({ userId, currentPassword, newPassword, currentSessionId }) {
            const user = await repo.findUserById(userId);
            if (!user) return { ok: false, code: "NOT_FOUND" };
            const tooLong = typeof currentPassword !== "string" || currentPassword.length > LIMITS.maxPasswordInput;
            if (tooLong || !(await hasher.verify(currentPassword, user.passwordHash))) return { ok: false, code: "INVALID_CREDENTIALS" };
            const accepted = await checkNewPassword(newPassword);
            if (!accepted.ok) return accepted;

            await repo.updateUser(user.id, { passwordHash: await hasher.hash(newPassword) });
            await repo.deleteSessionsOf(user.id, currentSessionId);
            await enqueueMail("changed", user.id, user.email);
            return { ok: true };
        },

        /* ======================= plans and marks ======================= */

        async listPlans(userId) {
            return repo.listPlans(userId);
        },

        /** The server gives the plan its revision: 1 for a new plan. A taken id is reported so the client can pick another. */
        async createPlan(userId, plan) {
            if ((await repo.listPlans(userId)).length >= LIMITS.maxPlansPerUser) return { ok: false, code: "PLAN_LIMIT" };
            const record = { ...structuredClone(plan), revision: 1, updatedAt: iso(), appliedOps: [], sessions: (plan.sessions ?? []).map((s) => ({ ...s, revision: 0 })) };
            const inserted = await repo.insertPlan(userId, record);
            return inserted.ok ? { ok: true, plan: record } : inserted;
        },

        /**
         * Replaces a plan's content (a re-plan, an edit). `baseRevision` is the revision the change was
         * made from; if the plan has moved on, nothing is written and the current plan is returned for the
         * client to merge. Marks are kept as the server has them: a re-plan must not undo a tick made on another device.
         */
        async updatePlan(userId, planId, changes, baseRevision) {
            const current = await repo.getPlan(userId, planId);
            if (!current) return { ok: false, code: "NOT_FOUND" };
            if (current.revision !== baseRevision) return { ok: false, code: "REVISION_CONFLICT", current };
            const next = { ...current, ...structuredClone(changes), id: current.id, revision: current.revision + 1, updatedAt: iso(), appliedOps: current.appliedOps };
            next.sessions = (changes.sessions ?? current.sessions).map((s) => {
                const known = current.sessions.find((c) => c.id === s.id);
                return known ? { ...s, status: known.status, revision: known.revision } : { ...s, revision: 0 };
            });
            const written = await repo.replacePlan(userId, next, baseRevision);
            return written.ok ? { ok: true, plan: next } : written;
        },

        async deletePlan(userId, planId) {
            return (await repo.deletePlan(userId, planId)) ? { ok: true } : { ok: false, code: "NOT_FOUND" };
        },

        /**
         * One mark on one session, as an operation:
         *  - `opId` makes it idempotent: sending it twice (a retry after a lost answer) changes nothing the second time;
         *  - `baseSessionRevision` is the revision of that session the person saw; if another device has marked it
         *    since, the mark is refused and the current state is returned, so a delayed offline mark can never
         *    silently overwrite a newer action. No client clock is involved anywhere.
         * Marks on different sessions of one plan do not conflict with each other.
         */
        async markSession(userId, planId, sessionId, { opId, status, baseSessionRevision }) {
            if (typeof opId !== "string" || opId.length < 8 || opId.length > 100) return { ok: false, code: "OPERATION_INVALID" };
            if (!["pending", "completed", "partial", "skipped"].includes(status)) return { ok: false, code: "STATUS_INVALID" };

            for (let attempt = 0; attempt < 5; attempt++) {
                const plan = await repo.getPlan(userId, planId);
                const session = plan?.sessions.find((s) => s.id === sessionId);
                if (!plan || !session) return { ok: false, code: "NOT_FOUND" };

                // The log is bounded (the last LIMITS.appliedOpsKept operations of a plan), and that is safe:
                // a session's revision only ever goes up, so an operation that has left the log was made from a
                // revision the session has long passed, and its replay is refused below as a conflict. It
                // can never be applied a second time. The log's only job is to answer a recent retry with
                // "already done" instead of a conflict.
                if (plan.appliedOps.includes(opId)) return { ok: true, duplicate: true, status: session.status, sessionRevision: session.revision };
                if (baseSessionRevision !== session.revision) return { ok: false, code: "MARK_CONFLICT", current: { status: session.status, sessionRevision: session.revision } };

                const next = {
                    ...plan,
                    revision: plan.revision + 1,
                    updatedAt: iso(),
                    appliedOps: [...plan.appliedOps, opId].slice(-LIMITS.appliedOpsKept),
                    sessions: plan.sessions.map((s) => (s.id === sessionId ? { ...s, status, revision: s.revision + 1 } : s)),
                };
                const written = await repo.replacePlan(userId, next, plan.revision);
                // The plan moved on for a reason that is not this session (a mark on another one): look again.
                if (written.ok) return { ok: true, duplicate: false, status, sessionRevision: session.revision + 1 };
                if (written.code !== "REVISION_CONFLICT") return written;
            }
            return { ok: false, code: "BUSY" };
        },

        /* ===================== the person's own data ===================== */

        /** Everything held about the person that they could want back, without anything secret. */
        async exportAccount(userId) {
            const user = await repo.findUserById(userId);
            if (!user) return { ok: false, code: "NOT_FOUND" };
            const plans = (await repo.listPlans(userId)).map(({ appliedOps, ...plan }) => plan);
            return { ok: true, account: { email: user.email, name: user.name, createdAt: user.createdAt, emailVerified: Boolean(user.emailVerifiedAt) }, plans };
        },

        /** Erases the account, its sessions, its links and its plans, after the password is confirmed. */
        async deleteAccount({ userId, password }) {
            const user = await repo.findUserById(userId);
            if (!user) return { ok: false, code: "NOT_FOUND" };
            const tooLong = typeof password !== "string" || password.length > LIMITS.maxPasswordInput;
            if (tooLong || !(await hasher.verify(password, user.passwordHash))) return { ok: false, code: "INVALID_CREDENTIALS" };
            await repo.eraseUser(userId);
            // After erasure, so the notice holds no reference to the erased account.
            await enqueueMail("deleted", null, user.email);
            return { ok: true };
        },
    };

    return service;
}
