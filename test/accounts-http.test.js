import { test, describe, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../lib/app.js";
import { createAccounts } from "../lib/accounts/http.js";
import { createMemoryAccountsRepository } from "../lib/accounts/memoryRepository.js";
import { createPasswordHasher } from "../lib/accounts/password.js";
import { createAccountService } from "../lib/accounts/service.js";
import { createTestMail } from "../lib/accounts/testMail.js";

/* The account routes over HTTP, against the in-memory repository, a test mailer and a cheap hasher.
   Nothing here touches the network beyond 127.0.0.1. */

const ORIGIN = "https://orari.example";
const GOOD = "een lange zin die niemand raadt";
const NEW_GOOD = "een andere lange zin voor later";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const tokenIn = (link) => decodeURIComponent(link.split("#token=")[1]);

const aiCalls = [];

async function boot({ secureCookies = true, limits = {} } = {}) {
    const mail = createTestMail();
    const service = createAccountService({
        repo: createMemoryAccountsRepository(),
        hasher: createPasswordHasher({ params: { N: 1024, r: 8, p: 1 } }),
        mail,
        baseUrl: ORIGIN,
        passwordCheck: async () => ({ status: "clean" }),
    });
    const accounts = { ...createAccounts({ service, allowedOrigins: [ORIGIN], secureCookies, limits }), mode: "memory" };
    const app = createApp({
        aiConfigured: true,
        parseNaturalLanguageRequest: async (...args) => (aiCalls.push(args), { ok: true, data: {} }),
        generateStudyPlan: async () => ({ ok: false, error: "unused" }),
        rateLimit: { windowMs: 60_000, limit: 100_000 },
        accounts,
    });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    return { server, base: `http://127.0.0.1:${server.address().port}`, mail, service, cookieName: accounts.cookieName };
}

/** A tiny browser: it keeps the session cookie and sends an Origin like a page of the site would. */
function browser(base, { origin = ORIGIN } = {}) {
    let cookie = "";
    const jar = {
        get cookie() {
            return cookie;
        },
        set cookie(value) {
            cookie = value;
        },
        async request(method, path, body, headers = {}) {
            const sent = { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers };
            const res = await fetch(base + path, { method, headers: sent, body: body === undefined ? undefined : JSON.stringify(body) });
            const setCookie = res.headers.getSetCookie();
            for (const line of setCookie) {
                const [pair, ...attributes] = line.split(";").map((p) => p.trim());
                const [name, value] = pair.split("=");
                if (attributes.some((a) => /^Max-Age=0$/i.test(a)) || value === "") cookie = "";
                else cookie = `${name}=${value}`;
            }
            const text = await res.text();
            let json = null;
            try {
                json = JSON.parse(text);
            } catch {
                /* not JSON */
            }
            return { status: res.status, json, headers: res.headers, setCookie, text };
        },
        post: (path, body, headers) => jar.request("POST", path, body ?? {}, headers),
        get: (path, headers) => jar.request("GET", path, undefined, headers),
    };
    return jar;
}

let ctx;
// The shared server makes many sign-ups from one address; its limits are out of the way here and tested on their own below.
const OPEN = { signup: { max: 10_000 }, verify: { max: 10_000 }, loginIp: { max: 10_000 }, loginAccount: { max: 10_000 }, forgotIp: { max: 10_000 }, forgotAccount: { max: 10_000 }, reset: { max: 10_000 } };
before(async () => (ctx = await boot({ limits: OPEN })));
after(() => new Promise((resolve) => ctx.server.close(resolve)));

let seq = 0;
async function newUser(name = "Arta") {
    const email = `user${++seq}@example.test`;
    const page = browser(ctx.base);
    assert.equal((await page.post("/api/account/signup", { email, password: GOOD, name, confirmsAge16: true })).status, 200);
    await flush();
    const verification = ctx.mail.messages.filter((m) => m.kind === "verification" && m.to === email).at(-1);
    return { email, page, verifyToken: tokenIn(verification.link) };
}
async function signedIn(verified = false) {
    const user = await newUser();
    if (verified) assert.equal((await browser(ctx.base).post("/api/account/verify", { token: user.verifyToken })).status, 200);
    assert.equal((await user.page.post("/api/account/login", { email: user.email, password: GOOD })).status, 200);
    return user;
}

beforeEach(() => {
    aiCalls.length = 0;
});

describe("status", () => {
    test("says whether accounts exist and in which mode", async () => {
        const on = await browser(ctx.base).get("/api/account/status");
        assert.deepEqual(on.json, { accounts: "memory" });

        const off = createApp({ aiConfigured: true, parseNaturalLanguageRequest: async () => ({ ok: true, data: {} }), generateStudyPlan: async () => ({ ok: false }) });
        const s = await new Promise((resolve) => { const x = off.listen(0, "127.0.0.1", () => resolve(x)); });
        try {
            const res = await fetch(`http://127.0.0.1:${s.address().port}/api/account/status`);
            assert.deepEqual(await res.json(), { accounts: "off" });
            assert.equal((await fetch(`http://127.0.0.1:${s.address().port}/api/account/me`)).status, 404); // routes are not there at all
        } finally {
            await new Promise((resolve) => s.close(resolve));
        }
    });
});

describe("what a visitor can and cannot learn", () => {
    test("sign-up answers the same for a new address and an existing one", async () => {
        const known = await newUser();
        const again = await browser(ctx.base).post("/api/account/signup", { email: known.email, password: NEW_GOOD, name: "Dikush", confirmsAge16: true });
        const fresh = await browser(ctx.base).post("/api/account/signup", { email: `fresh${++seq}@example.test`, password: GOOD, name: "Tjetër", confirmsAge16: true });
        assert.deepEqual([again.status, again.json], [fresh.status, fresh.json]);
        assert.deepEqual(again.json, { ok: true, status: "check_email" });
    });

    test("a wrong password and an unknown address are the same answer", async () => {
        const { email } = await newUser();
        const page = browser(ctx.base);
        const wrong = await page.post("/api/account/login", { email, password: "e gabuar e gabuar e gabuar" });
        const unknown = await page.post("/api/account/login", { email: "nobody@example.test", password: "e gabuar e gabuar e gabuar" });
        assert.deepEqual([wrong.status, wrong.json], [unknown.status, unknown.json]);
        assert.equal(wrong.json.code, "INVALID_CREDENTIALS");
        assert.deepEqual(wrong.setCookie, []);
    });

    test("forgot-password answers the same for any address, and only a real one gets a link", async () => {
        const { email } = await newUser();
        const known = await browser(ctx.base).post("/api/account/password/forgot", { email });
        const unknown = await browser(ctx.base).post("/api/account/password/forgot", { email: "nobody@example.test" });
        const junk = await browser(ctx.base).post("/api/account/password/forgot", { email: 12 });
        await flush();
        assert.deepEqual([known.status, known.json], [unknown.status, unknown.json]);
        assert.deepEqual([junk.status, junk.json], [known.status, known.json]);
        assert.equal(ctx.mail.messages.filter((m) => m.kind === "reset" && m.to === "nobody@example.test").length, 0);
        assert.equal(ctx.mail.messages.filter((m) => m.kind === "reset" && m.to === email).length, 1);
    });
});

describe("the session cookie", () => {
    test("is HttpOnly, Secure, SameSite=Lax, Path=/, host-only and bounded to 90 days", async () => {
        const user = await newUser();
        const res = await user.page.post("/api/account/login", { email: user.email, password: GOOD });
        assert.equal(res.setCookie.length, 1);
        const [pair, ...attributes] = res.setCookie[0].split(";").map((p) => p.trim());
        assert.match(pair, /^__Host-orari_session=[A-Za-z0-9_-]{40,}$/);
        assert.deepEqual(attributes.sort(), ["HttpOnly", "Max-Age=7776000", "Path=/", "SameSite=Lax", "Secure"].sort());
        assert.equal(attributes.some((a) => /^Domain=/i.test(a)), false);
        assert.equal(JSON.stringify(res.json).includes(pair.split("=")[1]), false); // the token is not in the body
    });

    test("the plain-http development setting drops Secure and the __Host- prefix and nothing else", async () => {
        const dev = await boot({ secureCookies: false });
        try {
            const page = browser(dev.base);
            await page.post("/api/account/signup", { email: "dev@example.test", password: GOOD, name: "Dev", confirmsAge16: true });
            const res = await page.post("/api/account/login", { email: "dev@example.test", password: GOOD });
            assert.match(res.setCookie[0], /^orari_session=/);
            assert.equal(/Secure/i.test(res.setCookie[0]), false);
            assert.match(res.setCookie[0], /HttpOnly/);
            assert.match(res.setCookie[0], /SameSite=Lax/);
        } finally {
            await new Promise((resolve) => dev.server.close(resolve));
        }
    });

    test("signing out clears it, and the old value no longer works", async () => {
        const user = await signedIn();
        const old = user.page.cookie;
        const out = await user.page.post("/api/account/logout");
        assert.equal(out.status, 200);
        assert.match(out.setCookie[0], /Max-Age=0/);
        user.page.cookie = old; // a copy someone kept
        assert.equal((await user.page.get("/api/account/me")).status, 401);
    });

    test("without a valid session the person is told so and the stale cookie is cleared", async () => {
        const page = browser(ctx.base);
        page.cookie = "__Host-orari_session=" + "z".repeat(43);
        const res = await page.get("/api/account/me");
        assert.deepEqual([res.status, res.json.code], [401, "UNAUTHENTICATED"]);
        assert.match(res.setCookie[0], /Max-Age=0/);
    });

    test("account responses are not cacheable", async () => {
        const user = await signedIn();
        for (const res of [await user.page.get("/api/account/me"), await user.page.get("/api/account/sessions")]) {
            assert.equal(res.headers.get("cache-control"), "no-store");
        }
    });
});

describe("Origin validation on state-changing requests", () => {
    test("a request from another site is refused and does nothing", async () => {
        const { email } = await newUser();
        const attacker = browser(ctx.base, { origin: "https://evil.example" });
        const res = await attacker.post("/api/account/login", { email, password: GOOD });
        assert.deepEqual([res.status, res.json.code], [403, "FORBIDDEN_ORIGIN"]);
        assert.deepEqual(res.setCookie, []);
    });

    test("every state-changing route has the guard, signed in or not", async () => {
        const user = await signedIn(true);
        const evil = browser(ctx.base, { origin: "https://evil.example" });
        evil.cookie = user.page.cookie; // the victim's cookie, as a hostile page's request would carry it
        const routes = [
            "/api/account/signup", "/api/account/verify", "/api/account/login", "/api/account/logout", "/api/account/password/forgot", "/api/account/password/reset",
            "/api/account/password/change", "/api/account/resend-verification", "/api/account/sessions/revoke", "/api/account/sessions/revoke-others", "/api/account/delete",
            "/api/sync/plans", "/api/sync/plans/p1", "/api/sync/plans/p1/delete", "/api/sync/plans/p1/marks",
        ];
        for (const route of routes) {
            const res = await evil.post(route, {});
            assert.deepEqual([res.status, res.json?.code], [403, "FORBIDDEN_ORIGIN"], route);
        }
        // And the victim is still signed in with everything intact.
        assert.equal((await user.page.get("/api/account/me")).status, 200);
    });

    test("without an Origin, Sec-Fetch-Site decides; cross-site is refused, same-origin is allowed", async () => {
        const { email } = await newUser();
        const page = browser(ctx.base, { origin: null });
        assert.equal((await page.post("/api/account/login", { email, password: GOOD }, { "Sec-Fetch-Site": "cross-site" })).status, 403);
        assert.equal((await page.post("/api/account/login", { email, password: GOOD }, { "Sec-Fetch-Site": "same-site" })).status, 403);
        assert.equal((await page.post("/api/account/login", { email, password: GOOD }, { "Sec-Fetch-Site": "same-origin" })).status, 200);
    });

    test("with neither header: allowed for a caller that holds no session cookie, refused for one that does", async () => {
        const user = await newUser();
        const bare = browser(ctx.base, { origin: null });
        assert.equal((await bare.post("/api/account/login", { email: user.email, password: GOOD })).status, 200); // now holds a cookie
        assert.equal((await bare.post("/api/account/logout")).status, 403);
    });

    test("reading is not guarded by Origin (GET), only by the session", async () => {
        const user = await signedIn();
        const res = await user.page.get("/api/account/me", { Origin: "https://evil.example" });
        assert.equal(res.status, 200);
    });
});

describe("verification gates sync and the AI, not sign-in", () => {
    test("an unverified person can sign in and see their account, but not sync", async () => {
        const user = await signedIn(false);
        const me = await user.page.get("/api/account/me");
        assert.deepEqual([me.status, me.json.user.emailVerified, me.json.canSync], [200, false, false]);
        for (const [method, path, body] of [["GET", "/api/sync/plans"], ["POST", "/api/sync/plans", { plan: {} }], ["POST", "/api/sync/plans/p1/marks", {}], ["POST", "/api/sync/plans/p1/delete", {}]]) {
            const res = await user.page.request(method, path, body);
            assert.deepEqual([res.status, res.json.code], [403, "EMAIL_NOT_VERIFIED"], `${method} ${path}`);
        }
    });

    test("the AI routes need a session and a verified address", async () => {
        const anonymous = await browser(ctx.base).post("/api/parse", { text: "abc def" });
        assert.deepEqual([anonymous.status, anonymous.json.code], [401, "UNAUTHENTICATED"]);

        const unverified = await signedIn(false);
        const refused = await unverified.page.post("/api/parse", { text: "abc def" });
        assert.deepEqual([refused.status, refused.json.code], [403, "EMAIL_NOT_VERIFIED"]);
        assert.equal(aiCalls.length, 0);

        const verified = await signedIn(true);
        const allowed = await verified.page.post("/api/parse", { text: "abc def" });
        assert.equal(allowed.status, 200);
        assert.equal(aiCalls.length, 1);
    });

    test("verifying with the link opens sync; the link works once", async () => {
        const user = await signedIn(false);
        const first = await browser(ctx.base).post("/api/account/verify", { token: user.verifyToken });
        const second = await browser(ctx.base).post("/api/account/verify", { token: user.verifyToken });
        assert.equal(first.status, 200);
        assert.deepEqual([second.status, second.json.code], [400, "TOKEN_INVALID"]);
        assert.equal((await user.page.get("/api/sync/plans")).status, 200);
    });
});

describe("password reset over HTTP", () => {
    test("the whole flow: link, new password, every session ended, no automatic sign-in, nothing secret in the answers", async () => {
        const user = await signedIn(true);
        const other = browser(ctx.base);
        await other.post("/api/account/login", { email: user.email, password: GOOD });

        const logs = [];
        const originals = { log: console.log, error: console.error, warn: console.warn, info: console.info };
        for (const name of Object.keys(originals)) console[name] = (...args) => logs.push(args.map(String).join(" "));
        let token;
        let reset;
        try {
            await browser(ctx.base).post("/api/account/password/forgot", { email: user.email });
            await flush();
            token = tokenIn(ctx.mail.messages.filter((m) => m.kind === "reset" && m.to === user.email).at(-1).link);
            reset = await browser(ctx.base).post("/api/account/password/reset", { token, newPassword: NEW_GOOD });
        } finally {
            Object.assign(console, originals);
        }

        assert.equal(reset.status, 200);
        assert.deepEqual(reset.json, { ok: true });
        assert.deepEqual(reset.setCookie.filter((c) => /Max-Age=0/.test(c)).length, 1);
        assert.equal(reset.text.includes(token), false);
        assert.equal((await user.page.get("/api/account/me")).status, 401);
        assert.equal((await other.get("/api/account/me")).status, 401);
        assert.equal((await browser(ctx.base).post("/api/account/login", { email: user.email, password: GOOD })).status, 401);
        assert.equal((await browser(ctx.base).post("/api/account/login", { email: user.email, password: NEW_GOOD })).status, 200);
        assert.equal(logs.some((line) => line.includes(token) || line.includes(NEW_GOOD)), false, "a token or password reached the logs");
    });

    test("the link is single use over HTTP too", async () => {
        const user = await newUser();
        await browser(ctx.base).post("/api/account/password/forgot", { email: user.email });
        await flush();
        const token = tokenIn(ctx.mail.messages.filter((m) => m.kind === "reset" && m.to === user.email).at(-1).link);
        assert.equal((await browser(ctx.base).post("/api/account/password/reset", { token, newPassword: NEW_GOOD })).status, 200);
        const again = await browser(ctx.base).post("/api/account/password/reset", { token, newPassword: "nog een lange zin hier" });
        assert.deepEqual([again.status, again.json.code], [400, "TOKEN_INVALID"]);
    });

    test("pages that carry a link are served with a policy that sends no Referer", async () => {
        const res = await fetch(ctx.base + "/app/reset");
        assert.equal(res.headers.get("referrer-policy"), "no-referrer");
    });
});

describe("rate limits", () => {
    test("sign-in is limited per address and per account, and a success does not count", async () => {
        const limited = await boot({ limits: { loginAccount: { max: 3 }, loginIp: { max: 100 } } });
        try {
            const page = browser(limited.base);
            await page.post("/api/account/signup", { email: "limit@example.test", password: GOOD, name: "L", confirmsAge16: true });
            for (let i = 0; i < 3; i++) assert.equal((await page.post("/api/account/login", { email: "limit@example.test", password: "e gabuar e gabuar e gabuar" })).status, 401);
            const blocked = await page.post("/api/account/login", { email: "limit@example.test", password: GOOD });
            assert.deepEqual([blocked.status, blocked.json.code], [429, "TOO_MANY_ATTEMPTS"]);
            // Another address from the same place is not affected by that account's limit.
            await page.post("/api/account/signup", { email: "other@example.test", password: GOOD, name: "O", confirmsAge16: true });
            assert.equal((await page.post("/api/account/login", { email: "other@example.test", password: GOOD })).status, 200);
        } finally {
            await new Promise((resolve) => limited.server.close(resolve));
        }
    });

    test("forgot-password past its limit still answers the same, and sends no more mail", async () => {
        const limited = await boot({ limits: { forgotAccount: { max: 2 } } });
        try {
            const page = browser(limited.base);
            await page.post("/api/account/signup", { email: "reset@example.test", password: GOOD, name: "R", confirmsAge16: true });
            const answers = [];
            for (let i = 0; i < 5; i++) answers.push(await page.post("/api/account/password/forgot", { email: "reset@example.test" }));
            await flush();
            assert.ok(answers.every((a) => a.status === 200 && JSON.stringify(a.json) === JSON.stringify({ ok: true })));
            assert.equal(limited.mail.messages.filter((m) => m.kind === "reset").length, 2);
        } finally {
            await new Promise((resolve) => limited.server.close(resolve));
        }
    });

    test("sign-up and reset are limited per address too", async () => {
        const limited = await boot({ limits: { signup: { max: 2 }, reset: { max: 2 } } });
        try {
            const page = browser(limited.base);
            const make = (i) => page.post("/api/account/signup", { email: `s${i}@example.test`, password: GOOD, name: "S", confirmsAge16: true });
            assert.equal((await make(1)).status, 200);
            assert.equal((await make(2)).status, 200);
            assert.equal((await make(3)).status, 429);
            for (let i = 0; i < 2; i++) assert.equal((await page.post("/api/account/password/reset", { token: "x".repeat(40), newPassword: NEW_GOOD })).status, 400);
            assert.equal((await page.post("/api/account/password/reset", { token: "x".repeat(40), newPassword: NEW_GOOD })).status, 429);
        } finally {
            await new Promise((resolve) => limited.server.close(resolve));
        }
    });
});

describe("devices", () => {
    test("the list marks this device; ending another device ends its session; ending this one clears the cookie", async () => {
        const user = await signedIn(true);
        const phone = browser(ctx.base);
        await phone.post("/api/account/login", { email: user.email, password: GOOD }, { "User-Agent": "Chrome on Android" });

        const list = (await user.page.get("/api/account/sessions")).json.sessions;
        assert.equal(list.length, 2);
        assert.equal(list.filter((s) => s.current).length, 1);
        const other = list.find((s) => !s.current);

        assert.equal((await user.page.post("/api/account/sessions/revoke", { sessionId: other.id })).status, 200);
        assert.equal((await phone.get("/api/account/me")).status, 401);
        const self = list.find((s) => s.current);
        const ended = await user.page.post("/api/account/sessions/revoke", { sessionId: self.id });
        assert.match(ended.setCookie[0], /Max-Age=0/);
    });

    test("someone else's session id is simply not found", async () => {
        const a = await signedIn(true);
        const b = await signedIn(true);
        const theirs = (await b.page.get("/api/account/sessions")).json.sessions[0];
        const res = await a.page.post("/api/account/sessions/revoke", { sessionId: theirs.id });
        assert.deepEqual([res.status, res.json.code], [404, "NOT_FOUND"]);
        assert.equal((await b.page.get("/api/account/me")).status, 200);
    });
});

describe("plans and marks over HTTP", () => {
    const session = (id) => ({ id, status: "pending", date: "2026-10-15", startTime: "08:00", endTime: "09:00", type: "learning", title: "Seancë " + id });
    const plan = (id = "p1") => ({ id, createdAt: "2026-10-01T08:00:00.000Z", subject: "Matematikë", startDate: "2026-10-14", endDate: "2026-10-30", sessions: [session("s1"), session("s2")] });

    test("create, list, mark, and see the revisions", async () => {
        const user = await signedIn(true);
        const created = await user.page.post("/api/sync/plans", { plan: plan() });
        assert.deepEqual([created.status, created.json.plan.revision], [201, 1]);

        const marked = await user.page.post("/api/sync/plans/p1/marks", { sessionId: "s1", opId: "operation-one-1", status: "completed", baseSessionRevision: 0 });
        assert.deepEqual([marked.status, marked.json.sessionRevision, marked.json.duplicate], [200, 1, false]);
        const again = await user.page.post("/api/sync/plans/p1/marks", { sessionId: "s1", opId: "operation-one-1", status: "completed", baseSessionRevision: 0 });
        assert.deepEqual([again.status, again.json.duplicate], [200, true]);

        const stale = await user.page.post("/api/sync/plans/p1/marks", { sessionId: "s1", opId: "operation-two-2", status: "skipped", baseSessionRevision: 0 });
        assert.deepEqual([stale.status, stale.json.code, stale.json.current], [409, "MARK_CONFLICT", { status: "completed", sessionRevision: 1 }]);

        const listed = (await user.page.get("/api/sync/plans")).json.plans;
        assert.deepEqual(listed[0].sessions.map((s) => [s.status, s.revision]), [["completed", 1], ["pending", 0]]);
    });

    test("an invalid plan is refused with fields and nothing is stored", async () => {
        const user = await signedIn(true);
        const res = await user.page.post("/api/sync/plans", { plan: { ...plan(), startDate: "2026-02-31", sessions: [{ ...session("s1"), startTime: "9:00" }] } });
        assert.equal(res.status, 400);
        assert.equal(res.json.code, "VALIDATION");
        assert.ok(res.json.fields.length >= 2);
        assert.deepEqual((await user.page.get("/api/sync/plans")).json.plans, []);
    });

    test("a plan changed from a stale revision is refused with the current plan", async () => {
        const user = await signedIn(true);
        await user.page.post("/api/sync/plans", { plan: plan() });
        await user.page.post("/api/sync/plans/p1/marks", { sessionId: "s1", opId: "operation-three-3", status: "partial", baseSessionRevision: 0 });
        const stale = await user.page.post("/api/sync/plans/p1", { plan: { ...plan(), subject: "Ndryshuar" }, baseRevision: 1 });
        assert.deepEqual([stale.status, stale.json.code, stale.json.current.revision], [409, "REVISION_CONFLICT", 2]);
    });

    test("people only ever see their own plans", async () => {
        const a = await signedIn(true);
        const b = await signedIn(true);
        await a.page.post("/api/sync/plans", { plan: plan() });
        assert.deepEqual((await b.page.get("/api/sync/plans")).json.plans, []);
        assert.equal((await b.page.post("/api/sync/plans/p1/marks", { sessionId: "s1", opId: "operation-four-4", status: "completed", baseSessionRevision: 0 })).status, 404);
        assert.equal((await b.page.post("/api/sync/plans/p1/delete", {})).status, 404);
        assert.equal((await a.page.get("/api/sync/plans")).json.plans.length, 1);
    });
});

describe("the person's own data", () => {
    test("export holds the data and nothing secret; deleting the account needs the password and ends everything", async () => {
        const user = await signedIn(true);
        await user.page.post("/api/sync/plans", { plan: { id: "p1", createdAt: "2026-10-01T08:00:00.000Z", subject: "Kimi", startDate: "2026-10-14", endDate: "2026-10-30", sessions: [] } });

        const exported = await user.page.get("/api/account/export");
        assert.equal(exported.status, 200);
        assert.match(exported.headers.get("content-disposition"), /attachment/);
        for (const secret of ["scrypt$", "passwordHash", "tokenHash", user.page.cookie.split("=")[1]]) assert.equal(exported.text.includes(secret), false, secret);
        assert.equal(exported.json.plans.length, 1);

        assert.deepEqual((await user.page.post("/api/account/delete", { password: "e gabuar e gabuar e gabuar" })).json.code, "INVALID_CREDENTIALS");
        const deleted = await user.page.post("/api/account/delete", { password: GOOD });
        assert.equal(deleted.status, 200);
        assert.equal((await browser(ctx.base).post("/api/account/login", { email: user.email, password: GOOD })).status, 401);
    });
});
