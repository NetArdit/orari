/** The push routes over HTTP: who may call them, and that each call is made as the signed-in person and nobody else. */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createApp } from "../lib/app.js";
import { createAccounts } from "../lib/accounts/http.js";
import { createMemoryAccountsRepository } from "../lib/accounts/memoryRepository.js";
import { createPasswordHasher } from "../lib/accounts/password.js";
import { createAccountService } from "../lib/accounts/service.js";
import { createTestMail } from "../lib/accounts/testMail.js";

const ORIGIN = "https://orari.example";
const PW = "Qershor-Lule-47x";
const tokenIn = (link) => decodeURIComponent(link.split("#token=")[1]);

describe("push routes", () => {
    const calls = [];
    let server, base, mail;
    let override = null;
    const store = new Proxy({}, { get: (_t, method) => async (...args) => (calls.push({ method, args }), override ?? { ok: true, planned: 0, subscriptions: 0, counts: {}, failed: [] }) });
    before(async () => {
        mail = createTestMail();
        const service = createAccountService({ repo: createMemoryAccountsRepository(), hasher: createPasswordHasher({ params: { N: 1024, r: 8, p: 1 } }), mail, baseUrl: ORIGIN, passwordCheck: async () => ({ status: "clean" }) });
        const accounts = { ...createAccounts({ service, allowedOrigins: [ORIGIN], secureCookies: false, limits: { signup: { max: 1000 }, loginIp: { max: 1000 }, loginAccount: { max: 1000 }, verify: { max: 1000 } } }), mode: "memory" };
        const app = createApp({ aiConfigured: true, parseNaturalLanguageRequest: async () => ({ ok: true, data: {} }), generateStudyPlan: async () => ({ ok: false }), accounts, push: { publicKey: "PUBLIC", store } });
        server = await new Promise((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
        base = `http://127.0.0.1:${server.address().port}`;
    });
    after(() => new Promise((r) => server.close(r)));

    async function person(email, verified) {
        let cookie = "";
        const call = async (method, path, body, origin = ORIGIN) => {
            const res = await fetch(base + path, { method, headers: { ...(origin ? { Origin: origin } : {}), ...(cookie ? { Cookie: cookie } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
            for (const line of res.headers.getSetCookie()) cookie = line.split(";")[0];
            return { status: res.status, json: await res.json().catch(() => null) };
        };
        await call("POST", "/api/account/signup", { email, password: PW, name: "P", confirmsAge16: true });
        await new Promise((r) => setTimeout(r, 30));
        if (verified) await call("POST", "/api/account/verify", { token: tokenIn(mail.messages.findLast((m) => m.kind === "verification" && m.to === email).link) });
        await call("POST", "/api/account/login", { email, password: PW });
        return call;
    }

    test("nobody signed in is refused, and so is an unconfirmed address", async () => {
        const anon = async (m, p) => (await fetch(base + p, { method: m, headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: m === "GET" ? undefined : "{}" })).status;
        for (const [m, p] of [["GET", "/api/push/config"], ["GET", "/api/push/status"], ["POST", "/api/push/subscribe"], ["POST", "/api/push/sync"], ["POST", "/api/push/snooze"], ["PUT", "/api/push/prefs"]]) assert.equal(await anon(m, p), 401, p);
        const unconfirmed = await person("unconfirmed@example.test", false);
        assert.equal((await unconfirmed("GET", "/api/push/status")).status, 403);
        assert.equal((await unconfirmed("POST", "/api/push/sync", { reminders: [], activeSessionIds: [] })).status, 403);
    });

    test("each call is made as the signed-in person, whatever the body says about someone else", async () => {
        const a = await person("a@example.test", true);
        const b = await person("b@example.test", true);
        calls.length = 0;
        assert.equal((await a("GET", "/api/push/config")).json.publicKey, "PUBLIC");
        await a("POST", "/api/push/sync", { userId: "someone-else", reminders: [], activeSessionIds: [] });
        await b("POST", "/api/push/snooze", { id: "r1", minutes: 5, userId: "a" });
        await b("POST", "/api/push/unsubscribe", { endpoint: "https://push.example/x" });
        const users = calls.map((c) => [c.method, c.args[0]]);
        const idA = users.find(([m]) => m === "sync")[1];
        const idB = users.find(([m]) => m === "snooze")[1];
        assert.notEqual(idA, idB);
        assert.notEqual(idA, "someone-else");
        assert.equal(users.find(([m]) => m === "unsubscribe")[1], idB);
    });

    test("a request from another site is refused and reaches nothing", async () => {
        const a = await person("c@example.test", true);
        calls.length = 0;
        assert.equal((await a("POST", "/api/push/sync", { reminders: [], activeSessionIds: [] }, "https://evil.example")).status, 403);
        assert.equal(calls.length, 0);
    });

    test("refusals from the store become plain answers: 404 unknown, 409 snooze limit, 400 invalid", async () => {
        const a = await person("d@example.test", true);
        try {
            override = { ok: false, code: "NOT_FOUND" };
            assert.equal((await a("POST", "/api/push/snooze", { id: "x", minutes: 5 })).status, 404);
            override = { ok: false, code: "SNOOZE_LIMIT" };
            const limit = await a("POST", "/api/push/snooze", { id: "x", minutes: 5 });
            assert.equal(limit.status, 409);
            assert.match(limit.json.error, /3 times/);
            override = { ok: false, code: "VALIDATION" };
            assert.equal((await a("PUT", "/api/push/prefs", {})).status, 400);
        } finally {
            override = null;
        }
    });
});
