/**
 * The whole account journey over HTTP, on a REAL PostgreSQL (embedded-postgres), with the real password hasher
 * and a capturing mailer: sign up, verify, sign in, save a plan, mark a session, forgot and reset the password,
 * sign out. Then the process is "restarted" (a second app and service on the same database): the account,
 * its session cookie and its plans are still there, and mail that was waiting is sent.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { createApp } from "../lib/app.js";
import { createAccounts } from "../lib/accounts/http.js";
import { createPasswordHasher } from "../lib/accounts/password.js";
import { createAccountService } from "../lib/accounts/service.js";
import { createTestMail } from "../lib/accounts/testMail.js";
import { createPostgresAccountsRepository } from "../lib/accounts/postgres/repository.js";
import { createLinkSealer, withSealedOutbox } from "../lib/accounts/postgres/sealedOutbox.js";
import { startPostgres } from "./helpers/embeddedPg.js";

const ORIGIN = "https://orari.example";
const GOOD = "een lange zin die niemand raadt";
const NEW_GOOD = "een andere lange zin voor later";
const flush = () => new Promise((resolve) => setTimeout(resolve, 100));
/** Waits (up to 15 s) for something the server does in the background, such as dispatching mail. A remote database is slower than a local one. */
async function until(find) {
    for (let i = 0; i < 150; i++) {
        const found = find();
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return undefined;
}
const tokenIn = (link) => decodeURIComponent(link.split("#token=")[1]);

let db;
before(async () => (db = await startPostgres()));
after(async () => db?.stop());

async function bootApp(mail) {
    const service = createAccountService({
        repo: withSealedOutbox(createPostgresAccountsRepository({ pool: db.pool }), createLinkSealer("test-secret-test-secret-test-secret-12")),
        hasher: createPasswordHasher({ params: { N: 1024, r: 8, p: 1 } }),
        mail,
        baseUrl: ORIGIN,
        passwordCheck: async () => ({ status: "clean" }),
    });
    const accounts = { ...createAccounts({ service, allowedOrigins: [ORIGIN], secureCookies: true }), mode: "postgres" };
    const app = createApp({
        aiConfigured: true,
        parseNaturalLanguageRequest: async () => ({ ok: true, data: {} }),
        generateStudyPlan: async () => ({ ok: false, error: "unused" }),
        rateLimit: { windowMs: 60_000, limit: 100_000 },
        accounts,
    });
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    return { service, base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) };
}

function browser(base) {
    let cookie = "";
    const request = async (method, path, body) => {
        const res = await fetch(base + path, {
            method,
            headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
            body: body === undefined ? undefined : JSON.stringify(body),
        });
        for (const line of res.headers.getSetCookie()) {
            const [pair, ...attrs] = line.split(";").map((p) => p.trim());
            const [name, value] = pair.split("=");
            cookie = attrs.some((a) => /^Max-Age=0$/i.test(a)) || value === "" ? "" : `${name}=${value}`;
        }
        const text = await res.text();
        let json = null;
        try { json = JSON.parse(text); } catch { /* not JSON */ }
        return { status: res.status, json };
    };
    return { request, get: (p) => request("GET", p), post: (p, b) => request("POST", p, b ?? {}), get cookie() { return cookie; }, set cookie(v) { cookie = v; } };
}

const session = (id) => ({ id, status: "pending", date: "2026-10-15", startTime: "08:00", endTime: "09:00", type: "learning", title: "Seancë " + id });
const plan = (id) => ({ id, createdAt: "2026-10-01T08:00:00.000Z", subject: "Matematikë", startDate: "2026-10-14", endDate: "2026-10-30", sessions: [session("s1"), session("s2")] });

test("sign up, verify, sign in, save a plan, mark, reset the password, sign out; all of it survives a restart", async () => {
    const mail = createTestMail();
    const first = await bootApp(mail);
    const page = browser(first.base);
    const email = "arta@example.test";

    assert.equal((await page.post("/api/account/signup", { email, password: GOOD, name: "Arta Krasniqi", confirmsAge16: true })).status, 200);
    const verification = await until(() => mail.messages.find((m) => m.kind === "verification" && m.to === email));
    assert.ok(verification, "the verification mail was sent");
    assert.equal((await browser(first.base).post("/api/account/verify", { token: tokenIn(verification.link) })).status, 200);

    assert.equal((await page.post("/api/account/login", { email, password: GOOD })).status, 200);
    const me = await page.get("/api/account/me");
    assert.equal(me.json.user.emailVerified, true);
    assert.equal(me.json.user.name, "Arta Krasniqi");

    assert.equal((await page.post("/api/sync/plans", { plan: plan("p1") })).status, 201);
    const marked = await page.post("/api/sync/plans/p1/marks", { sessionId: "s1", opId: "operation-one-1", status: "completed", baseSessionRevision: 0 });
    assert.equal(marked.status, 200);

    // forgot and reset
    assert.equal((await browser(first.base).post("/api/account/password/forgot", { email })).status, 200);
    const reset = await until(() => mail.messages.find((m) => m.kind === "reset" && m.to === email));
    assert.ok(reset, "the reset mail was sent");
    assert.equal((await browser(first.base).post("/api/account/password/reset", { token: tokenIn(reset.link), newPassword: NEW_GOOD })).status, 200);
    assert.equal((await browser(first.base).post("/api/account/login", { email, password: GOOD })).status, 401, "the old password no longer works");
    assert.equal((await page.get("/api/account/me")).status, 401, "a reset ends the sessions that existed");

    const again = browser(first.base);
    assert.equal((await again.post("/api/account/login", { email, password: NEW_GOOD })).status, 200);
    const savedCookie = again.cookie;
    assert.ok(savedCookie, "a session cookie was issued");
    await first.close();

    // "restart": a new app and service on the same database
    const mail2 = createTestMail();
    const second = await bootApp(mail2);
    const back = browser(second.base);
    back.cookie = savedCookie;
    const stillThere = await back.get("/api/account/me");
    assert.equal(stillThere.status, 200, "the session survives a restart");
    const plans = await back.get("/api/sync/plans");
    assert.equal(plans.json.plans.length, 1);
    assert.equal(plans.json.plans[0].sessions.find((s) => s.id === "s1").status, "completed", "the mark survived");
    assert.equal((await browser(second.base).post("/api/account/login", { email, password: NEW_GOOD })).status, 200, "the new password works after a restart");

    // sign out, then the cookie is dead
    assert.equal((await back.post("/api/account/logout")).status, 200);
    back.cookie = savedCookie;
    assert.equal((await back.get("/api/account/me")).status, 401);
    await second.close();
});

test("mail that was waiting when the process stopped is sent by the next one", async () => {
    const failing = createTestMail();
    let brokenCalls = 0;
    const brokenMail = { ...failing, sendVerification: async () => { brokenCalls++; throw new Error("provider down"); } };
    const first = await bootApp(brokenMail);
    const email = "drita@example.test";
    assert.equal((await browser(first.base).post("/api/account/signup", { email, password: GOOD, name: "Drita", confirmsAge16: true })).status, 200);
    await flush();
    await until(() => (brokenCalls > 0 ? true : undefined));
    assert.equal(failing.messages.filter((m) => m.to === email).length, 0, "nothing was delivered");
    await first.close();

    const working = createTestMail();
    const second = await bootApp(working);
    // the retry time of the first attempt is a minute away; dispatch is what the server's timer calls
    const outbox = await db.pool.query("UPDATE outbox SET next_attempt_at = '2000-01-01T00:00:00.000Z', lease_until = NULL");
    assert.ok(outbox.rowCount >= 1, "the message was stored in the database");
    await second.service.dispatchMail();
    const delivered = await until(() => working.messages.find((m) => m.kind === "verification" && m.to === email));
    assert.ok(delivered, "the next process sent it");
    await second.close();
});
