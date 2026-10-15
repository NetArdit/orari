/**
 * Account routes: the HTTP face of lib/accounts/service.js.
 *
 * NON-PRODUCTION until storage and mail are real. Over the in-memory repository, accounts and
 * sessions vanish on restart, so the server mounts these routes only when started with
 * ACCOUNTS_MODE=memory and the page says so. Nothing here is a persistence claim.
 *
 * What this layer adds to the service, per Codex's rulings of 2026-10-14:
 *  - the session cookie: HttpOnly, SameSite=Lax, Path=/, Secure, and the __Host- prefix when Secure;
 *  - Origin validation on every state-changing request, with a deliberate fallback;
 *  - rate limits on sign-in, sign-up, verification and reset, by address and by account;
 *  - the verified-address rule enforced here, on every sync route, and exported for the AI routes;
 *  - one error body shape, { code, error, fields? }, the same as the rest of the API;
 *  - no tokens, passwords or request bodies in logs, and no Referer leakage from reset links.
 */
import express from "express";
import { z } from "zod";
import { isValidDateStr } from "../time.js";
import { normaliseEmail } from "./service.js";

const DAY_SECONDS = 86_400;
const COOKIE_MAX_AGE = 90 * DAY_SECONDS; // the server enforces the absolute 90 days; the cookie never outlives it

/** English sentences for the codes. The code is what programs use; these are what people read. */
const MESSAGES = {
    UNAUTHENTICATED: "You need to sign in.",
    INVALID_CREDENTIALS: "The e-mail or password is not correct.",
    FORBIDDEN_ORIGIN: "The request was not accepted from this page.",
    EMAIL_NOT_VERIFIED: "Confirm your e-mail to use the AI.",
    EMAIL_INVALID: "Write the e-mail like name@example.com.",
    NAME_INVALID: "The name must be 1 to 80 characters long.",
    AGE_NOT_CONFIRMED: "Orari is for people aged 16 and over. Confirm your age to continue.",
    PASSWORD_TOO_SHORT: "The password must be at least 8 characters long. It can be a sentence.",
    PASSWORD_TOO_LONG: "The password is too long (at most 128 characters).",
    PASSWORD_INVALID: "The password is not valid.",
    PASSWORD_COMPROMISED: "This password has appeared in known data leaks. Choose another one.",
    PASSWORD_CHECK_UNAVAILABLE: "We could not check whether the password has appeared in a leak. Try again in a moment.",
    TOKEN_INVALID: "The link is not valid or has expired. Ask for a new one.",
    TOO_MANY_ATTEMPTS: "Too many attempts. Wait a few minutes and try again.",
    NOT_FOUND: "Not found.",
    REVISION_CONFLICT: "The plan was changed elsewhere. Showing the latest version.",
    MARK_CONFLICT: "This session was marked elsewhere. Showing the latest state.",
    PLAN_EXISTS: "This plan already exists.",
    PLAN_LIMIT: "You have reached the maximum number of plans.",
    OPERATION_INVALID: "The request is not valid.",
    STATUS_INVALID: "The session status is not valid.",
    VALIDATION: "Some of the details are not right.",
    BUSY: "The service is busy. Try again in a moment.",
};

const STATUS = {
    UNAUTHENTICATED: 401,
    INVALID_CREDENTIALS: 401,
    FORBIDDEN_ORIGIN: 403,
    EMAIL_NOT_VERIFIED: 403,
    TOO_MANY_ATTEMPTS: 429,
    NOT_FOUND: 404,
    REVISION_CONFLICT: 409,
    MARK_CONFLICT: 409,
    PLAN_EXISTS: 409,
    BUSY: 503,
};

export const sendError = (res, code, extra = {}) => res.status(STATUS[code] ?? 400).json({ code, error: MESSAGES[code] ?? MESSAGES.VALIDATION, ...extra });

/** The cookie header as a plain object. No library: the one cookie this app sets is simple. */
function parseCookies(header) {
    const out = {};
    for (const part of String(header ?? "").split(";")) {
        const at = part.indexOf("=");
        if (at > 0) out[part.slice(0, at).trim()] = part.slice(at + 1).trim();
    }
    return out;
}

/** Counts events per key inside a sliding window. In memory: per process, resets on restart. */
export function createAttemptLimiter({ windowMs, max, now = () => Date.now() }) {
    const hits = new Map();
    const fresh = (key) => {
        const cutoff = now() - windowMs;
        const list = (hits.get(key) ?? []).filter((t) => t > cutoff);
        if (list.length) hits.set(key, list);
        else hits.delete(key);
        return list;
    };
    return {
        blocked: (key) => fresh(key).length >= max,
        hit: (key) => {
            const list = fresh(key);
            list.push(now());
            hits.set(key, list);
        },
    };
}

const SessionStatus = z.enum(["pending", "completed", "partial", "skipped"]);
const text = (max) => z.string().max(max);
const SyncSession = z.object({
    id: z.string().min(1).max(100),
    status: SessionStatus,
    date: z.string().refine(isValidDateStr),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    type: z.enum(["learning", "practice", "recall", "revision", "assessment", "project"]),
    title: z.string().min(1).max(200),
    goal: text(400).default(""),
    tasks: z.array(text(300)).max(12).default([]),
    material: text(300).nullable().default(null),
    difficulty: z.enum(["easy", "medium", "hard"]).default("medium"),
});
const SyncPlan = z.object({
    id: z.string().min(1).max(100),
    createdAt: z.string().min(1).max(40),
    subject: z.string().min(1).max(200),
    startDate: z.string().refine(isValidDateStr),
    endDate: z.string().refine(isValidDateStr),
    planMode: text(40).default("general"),
    strategy: text(2000).default(""),
    explanations: z.array(text(600)).max(10).default([]),
    warnings: z.array(text(600)).max(10).default([]),
    structured: z.record(z.unknown()).default({}),
    sessions: z.array(SyncSession).max(2000),
});

function fieldsOf(error) {
    return error.issues.slice(0, 10).map((i) => ({ path: i.path.join("."), message: MESSAGES.VALIDATION }));
}

/**
 * @param {object} options
 * @param {ReturnType<import("./service.js").createAccountService>} options.service
 * @param {string[]} options.allowedOrigins   e.g. ["https://orari.example"]; the site's own origins
 * @param {boolean} [options.secureCookies=true]  false only for plain-http development in a browser that refuses Secure cookies
 * @param {object} [options.limits]           override for tests
 * @param {() => number} [options.now]
 */
export function createAccounts({ service, allowedOrigins, secureCookies = true, limits = {}, now = () => Date.now() }) {
    const cookieName = secureCookies ? "__Host-orari_session" : "orari_session";
    const origins = new Set(allowedOrigins);

    const L = {
        loginIp: { windowMs: 15 * 60_000, max: 20, ...limits.loginIp },
        loginAccount: { windowMs: 15 * 60_000, max: 8, ...limits.loginAccount },
        signup: { windowMs: 60 * 60_000, max: 10, ...limits.signup },
        verify: { windowMs: 60 * 60_000, max: 20, ...limits.verify },
        forgotIp: { windowMs: 60 * 60_000, max: 10, ...limits.forgotIp },
        forgotAccount: { windowMs: 60 * 60_000, max: 3, ...limits.forgotAccount },
        reset: { windowMs: 60 * 60_000, max: 10, ...limits.reset },
    };
    const lim = Object.fromEntries(Object.entries(L).map(([k, v]) => [k, createAttemptLimiter({ ...v, now })]));
    const ipOf = (req) => req.ip ?? req.socket?.remoteAddress ?? "unknown";

    const setSessionCookie = (res, token) =>
        res.append("Set-Cookie", `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}${secureCookies ? "; Secure" : ""}`);
    const clearSessionCookie = (res) =>
        res.append("Set-Cookie", `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secureCookies ? "; Secure" : ""}`);

    /**
     * State-changing requests must come from this site. A browser always sends Origin on a POST, so:
     *  - Origin present: it must be one of ours;
     *  - Origin absent: Sec-Fetch-Site must say same-origin or none;
     *  - both absent: not a browser, which cannot be tricked into sending a cookie it does not hold;
     *    allowed only if the request carries no session cookie.
     */
    function originGuard(req, res, next) {
        if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
        const origin = req.get("origin");
        const site = req.get("sec-fetch-site");
        if (origin !== undefined) return origins.has(origin) ? next() : sendError(res, "FORBIDDEN_ORIGIN");
        if (site !== undefined) return site === "same-origin" || site === "none" ? next() : sendError(res, "FORBIDDEN_ORIGIN");
        if (parseCookies(req.get("cookie"))[cookieName]) return sendError(res, "FORBIDDEN_ORIGIN");
        return next();
    }

    /** Puts req.account = { user, sessionId, token } or answers 401. */
    async function authenticate(req, res, next) {
        const token = parseCookies(req.get("cookie"))[cookieName];
        const result = await service.authenticate(token);
        if (!result.ok) {
            clearSessionCookie(res);
            return sendError(res, "UNAUTHENTICATED");
        }
        req.account = { user: result.user, sessionId: result.sessionId, token };
        next();
    }

    function requireVerified(req, res, next) {
        if (!service.canUseSyncAndAi(req.account.user)) return sendError(res, "EMAIL_NOT_VERIFIED");
        next();
    }

    const wrap = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
    const fail = (res, result) => sendError(res, result.code, result.current ? { current: result.current } : {});
    const body = (req) => (req.body && typeof req.body === "object" ? req.body : {});

    const router = express.Router();
    router.use(originGuard);
    // A reset or verification page must not pass its address, and so its token, on in a Referer header.
    router.use((req, res, next) => (res.set("Cache-Control", "no-store"), next()));

    /* ---------------- no session needed ---------------- */

    router.post("/signup", wrap(async (req, res) => {
        const ip = ipOf(req);
        if (lim.signup.blocked(ip)) return sendError(res, "TOO_MANY_ATTEMPTS");
        lim.signup.hit(ip);
        const result = await service.signUp(body(req));
        return result.ok ? res.json({ ok: true, status: result.status }) : fail(res, result);
    }));

    router.post("/verify", wrap(async (req, res) => {
        const ip = ipOf(req);
        if (lim.verify.blocked(ip)) return sendError(res, "TOO_MANY_ATTEMPTS");
        lim.verify.hit(ip);
        const result = await service.verifyEmail(body(req).token);
        return result.ok ? res.json({ ok: true }) : fail(res, result);
    }));

    router.post("/login", wrap(async (req, res) => {
        const { email, password } = body(req);
        const address = normaliseEmail(email) ?? "?";
        const ipKey = ipOf(req);
        const accountKey = `${ipKey}|${address}`;
        if (lim.loginIp.blocked(ipKey) || lim.loginAccount.blocked(accountKey)) return sendError(res, "TOO_MANY_ATTEMPTS");
        const result = await service.logIn({ email, password, userAgent: req.get("user-agent") });
        if (!result.ok) {
            lim.loginIp.hit(ipKey);
            lim.loginAccount.hit(accountKey);
            return fail(res, result);
        }
        setSessionCookie(res, result.token);
        return res.json({ ok: true, user: result.user });
    }));

    // The same answer for any address. Throttled by address and by account; a throttled request still
    // gets the same answer, only no mail is queued, so the limit itself reveals nothing.
    router.post("/password/forgot", wrap(async (req, res) => {
        const ip = ipOf(req);
        const address = normaliseEmail(body(req).email);
        const accountBlocked = address ? lim.forgotAccount.blocked(address) : false;
        if (!lim.forgotIp.blocked(ip) && !accountBlocked) {
            lim.forgotIp.hit(ip);
            if (address) lim.forgotAccount.hit(address);
            await service.requestPasswordReset({ email: address });
        }
        return res.json({ ok: true });
    }));

    router.post("/password/reset", wrap(async (req, res) => {
        const ip = ipOf(req);
        if (lim.reset.blocked(ip)) return sendError(res, "TOO_MANY_ATTEMPTS");
        lim.reset.hit(ip);
        const { token, newPassword } = body(req);
        const result = await service.resetPassword({ token, newPassword });
        // Reset never signs anyone in, and it ends every session: the cookie, if any, is cleared too.
        if (result.ok) clearSessionCookie(res);
        return result.ok ? res.json({ ok: true }) : fail(res, result);
    }));

    router.post("/logout", wrap(async (req, res) => {
        await service.logOut(parseCookies(req.get("cookie"))[cookieName]);
        clearSessionCookie(res);
        return res.json({ ok: true });
    }));

    /* ---------------- a session is needed ---------------- */

    router.get("/me", authenticate, (req, res) => res.json({ user: req.account.user, canSync: service.canUseSyncAndAi(req.account.user) }));

    router.post("/resend-verification", authenticate, wrap(async (req, res) => {
        const ip = ipOf(req);
        if (lim.verify.blocked(ip)) return sendError(res, "TOO_MANY_ATTEMPTS");
        lim.verify.hit(ip);
        await service.resendVerification(req.account.user.id);
        return res.json({ ok: true });
    }));

    router.get("/sessions", authenticate, wrap(async (req, res) => {
        res.json({ sessions: await service.listSessions(req.account.user.id, req.account.sessionId) });
    }));

    router.post("/sessions/revoke", authenticate, wrap(async (req, res) => {
        const result = await service.revokeSession(req.account.user.id, String(body(req).sessionId ?? ""));
        if (result.ok && body(req).sessionId === req.account.sessionId) clearSessionCookie(res);
        return result.ok ? res.json({ ok: true }) : fail(res, result);
    }));

    router.post("/sessions/revoke-others", authenticate, wrap(async (req, res) => {
        res.json(await service.revokeOtherSessions(req.account.user.id, req.account.sessionId));
    }));

    router.post("/profile", authenticate, wrap(async (req, res) => {
        const result = await service.updateName({ userId: req.account.user.id, name: body(req).name });
        return result.ok ? res.json({ ok: true, user: result.user }) : fail(res, result);
    }));

    router.post("/email/change", authenticate, wrap(async (req, res) => {
        const { currentPassword, newEmail } = body(req);
        if (lim.loginAccount.blocked(`email|${req.account.user.id}`)) return sendError(res, "TOO_MANY_ATTEMPTS");
        const result = await service.requestEmailChange({ userId: req.account.user.id, currentPassword, newEmail });
        if (!result.ok && result.code === "INVALID_CREDENTIALS") lim.loginAccount.hit(`email|${req.account.user.id}`);
        return result.ok ? res.json({ ok: true, status: "check_email" }) : fail(res, result);
    }));

    router.post("/password/change", authenticate, wrap(async (req, res) => {
        const { currentPassword, newPassword } = body(req);
        if (lim.loginAccount.blocked(`change|${req.account.user.id}`)) return sendError(res, "TOO_MANY_ATTEMPTS");
        const result = await service.changePassword({ userId: req.account.user.id, currentPassword, newPassword, currentSessionId: req.account.sessionId });
        if (!result.ok && result.code === "INVALID_CREDENTIALS") lim.loginAccount.hit(`change|${req.account.user.id}`);
        return result.ok ? res.json({ ok: true }) : fail(res, result);
    }));

    router.get("/export", authenticate, wrap(async (req, res) => {
        const result = await service.exportAccount(req.account.user.id);
        res.set("Content-Disposition", 'attachment; filename="orari-data.json"');
        return result.ok ? res.json(result) : fail(res, result);
    }));

    router.post("/delete", authenticate, wrap(async (req, res) => {
        if (lim.loginAccount.blocked(`delete|${req.account.user.id}`)) return sendError(res, "TOO_MANY_ATTEMPTS");
        const result = await service.deleteAccount({ userId: req.account.user.id, password: body(req).password });
        if (!result.ok && result.code === "INVALID_CREDENTIALS") lim.loginAccount.hit(`delete|${req.account.user.id}`);
        if (result.ok) clearSessionCookie(res);
        return result.ok ? res.json({ ok: true }) : fail(res, result);
    }));

    /* ---------------- plan sync: a session AND a verified address ---------------- */

    const sync = express.Router();
    sync.use(originGuard, authenticate, requireVerified);
    sync.use((req, res, next) => (res.set("Cache-Control", "no-store"), next()));

    sync.get("/plans", wrap(async (req, res) => res.json({ plans: await service.listPlans(req.account.user.id) })));

    sync.post("/plans", wrap(async (req, res) => {
        const parsed = SyncPlan.safeParse(body(req).plan);
        if (!parsed.success) return sendError(res, "VALIDATION", { fields: fieldsOf(parsed.error) });
        const result = await service.createPlan(req.account.user.id, parsed.data);
        return result.ok ? res.status(201).json({ plan: result.plan }) : fail(res, result);
    }));

    sync.post("/plans/:planId", wrap(async (req, res) => {
        const parsed = SyncPlan.safeParse(body(req).plan);
        if (!parsed.success) return sendError(res, "VALIDATION", { fields: fieldsOf(parsed.error) });
        if (!Number.isInteger(body(req).baseRevision)) return sendError(res, "VALIDATION", { fields: [{ path: "baseRevision", message: MESSAGES.VALIDATION }] });
        const result = await service.updatePlan(req.account.user.id, req.params.planId, parsed.data, body(req).baseRevision);
        return result.ok ? res.json({ plan: result.plan }) : fail(res, result);
    }));

    sync.post("/plans/:planId/delete", wrap(async (req, res) => {
        const result = await service.deletePlan(req.account.user.id, req.params.planId);
        return result.ok ? res.json({ ok: true }) : fail(res, result);
    }));

    sync.post("/plans/:planId/marks", wrap(async (req, res) => {
        const { sessionId, opId, status, baseSessionRevision } = body(req);
        if (typeof sessionId !== "string" || !Number.isInteger(baseSessionRevision)) return sendError(res, "VALIDATION");
        const result = await service.markSession(req.account.user.id, req.params.planId, sessionId, { opId, status, baseSessionRevision });
        return result.ok ? res.json(result) : fail(res, result);
    }));

    return {
        accountRouter: router,
        syncRouter: sync,
        /** Middleware for the AI routes: a session and a verified address, or 401 / 403. Sets req.account. */
        // The origin check comes first: the AI and job routes change state too (they spend the shared quota and
        // start or stop work), and the ruling is that every state-changing request is checked. Reads pass it.
        requireVerifiedAccount: [originGuard, authenticate, requireVerified],
        cookieName,
    };
}
