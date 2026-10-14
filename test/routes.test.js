import { test, describe, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../lib/app.js";

/* Every route runs against a fake AI. Nothing here reaches the network beyond 127.0.0.1. */

const FIXED_NOW = new Date("2026-10-14T10:00:00Z");

const fake = {
    parseCalls: [],
    planCalls: [],
    parse: async () => ({ ok: true, data: {} }),
    plan: async () => ({ ok: true, data: {} }),
};

function start(options = {}) {
    const app = createApp({
        clientDir: path.join(tmpdir(), "orari-no-client-build"), // no new client unless a test provides one
        aiConfigured: true,
        parseNaturalLanguageRequest: async (...args) => {
            fake.parseCalls.push(args);
            return fake.parse(...args);
        },
        generateStudyPlan: async (...args) => {
            fake.planCalls.push(args);
            return fake.plan(...args);
        },
        now: () => FIXED_NOW,
        rateLimit: { windowMs: 60_000, limit: 100_000 }, // out of the way unless a test sets its own
        ...options,
    });
    return new Promise((resolve) => {
        const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
    });
}

const stop = (server) => new Promise((resolve) => server.close(resolve));

// Waits for something that should happen soon; fails the test instead of hanging if it never does.
async function until(condition, what, timeoutMs = 3000) {
    const startedAt = Date.now();
    while (!condition()) {
        if (Date.now() - startedAt > timeoutMs) assert.fail(`timed out waiting for ${what}`);
        await new Promise((r) => setTimeout(r, 5));
    }
}

async function post(base, path, body, raw = false) {
    const res = await fetch(base + path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: raw ? body : JSON.stringify(body),
    });
    return { status: res.status, json: await res.json() };
}

const planSession = (date, startTime, endTime, extra = {}) => ({
    date, startTime, endTime, type: "learning", title: "Seancë", goal: "", tasks: [], material: null, difficulty: "medium", ...extra,
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const planData = (sessions, extra = {}) => ({ strategy: "Strategjia", explanations: ["Sepse"], warnings: ["Kujdes"], sessions, ...extra });

// 2026-10-14 (Wed) to 2026-10-15, nothing else: free 07:00-23:00 on both days.
const createBody = (structured = {}) => ({
    profile: { name: "Arta", educationLevel: "university" },
    structured: { startDate: "2026-10-14", endDate: "2026-10-15", subject: "Matematikë", ...structured },
});

let server;
let base;
let errorLog;

before(async () => {
    ({ server, base } = await start());
});
after(() => stop(server));

beforeEach(() => {
    fake.parseCalls = [];
    fake.planCalls = [];
    fake.parse = async () => ({ ok: true, data: {} });
    fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-14", "08:00", "09:00")]) });
    errorLog = mock.method(console, "error", () => {});
});

describe("health, static files and generic errors", () => {
    test("GET /api/health reports that AI is configured", async () => {
        const res = await fetch(base + "/api/health");
        assert.equal(res.status, 200);
        assert.deepEqual(await res.json(), { success: true, message: "StudyFlow server is running.", aiConfigured: true });
    });

    test("GET / serves the page", async () => {
        const res = await fetch(base + "/");
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type"), /text\/html/);
        assert.match(await res.text(), /<title>StudyFlow<\/title>/);
    });

    test("files outside public are not served", async () => {
        assert.equal((await fetch(base + "/package.json")).status, 404);
        assert.equal((await fetch(base + "/lib/ai.js")).status, 404);
    });

    test("an unknown API path answers 404 as JSON", async () => {
        const res = await fetch(base + "/api/nope");
        assert.equal(res.status, 404);
        assert.equal((await res.json()).error, "API endpoint nuk u gjet.");
    });

    test("malformed JSON answers 400", async () => {
        const { status, json } = await post(base, "/api/parse", "{bad", true);
        assert.equal(status, 400);
        assert.equal(json.error, "Kërkesa nuk është JSON valid.");
    });

    test("a body over 100 kB answers 413", async () => {
        const { status, json } = await post(base, "/api/parse", { text: "a".repeat(150_000) });
        assert.equal(status, 413);
        assert.equal(json.error, "Kërkesa është shumë e madhe.");
    });
});

describe("the new client at /app, beside the old page", () => {
    let withClient;
    let dir;
    let outer;
    const OUTSIDE = "OUTSIDE-THE-CLIENT-FOLDER-7f3a";

    // fetch() tidies ".." out of an address before sending it; an attacker's tool does not.
    const rawGet = (address) =>
        new Promise((resolve, reject) => {
            const { hostname, port } = new URL(withClient.base);
            const req = http.request({ hostname, port, path: address, method: "GET" }, (res) => {
                let body = "";
                res.setEncoding("utf8");
                res.on("data", (chunk) => (body += chunk));
                res.on("end", () => resolve({ status: res.statusCode, body }));
            });
            req.on("error", reject);
            req.end();
        });

    before(async () => {
        // outer/ holds a file that must never be served; the client build lives in outer/client.
        outer = mkdtempSync(path.join(tmpdir(), "orari-client-"));
        writeFileSync(path.join(outer, "secret.txt"), OUTSIDE);
        dir = path.join(outer, "client");
        mkdirSync(path.join(dir, "assets"), { recursive: true });
        writeFileSync(path.join(dir, "index.html"), "<!doctype html><title>new client</title>");
        writeFileSync(path.join(dir, "assets", "index-abc123.js"), "console.log('client')");
        writeFileSync(path.join(dir, "favicon.svg"), "<svg xmlns='http://www.w3.org/2000/svg'/>");
        withClient = await start({ clientDir: dir });
    });
    after(async () => {
        await stop(withClient.server);
        rmSync(outer, { recursive: true, force: true });
    });

    test("/app and every address under it get the client's page, not cached", async () => {
        for (const address of ["/app", "/app/", "/app/orari", "/app/planet/abc/seanca/s1", "/app/nuk-ekziston"]) {
            const res = await fetch(withClient.base + address);
            assert.equal(res.status, 200, address);
            assert.match(res.headers.get("content-type"), /text\/html/, address);
            assert.equal(res.headers.get("cache-control"), "no-cache", address);
            assert.match(await res.text(), /new client/, address);
        }
    });

    test("hashed assets are served and may be cached for good", async () => {
        const res = await fetch(withClient.base + "/app/assets/index-abc123.js");
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type"), /javascript/);
        assert.match(res.headers.get("cache-control"), /max-age=31536000, immutable/);
        assert.equal(await res.text(), "console.log('client')");
    });

    test("a missing asset is a 404, never the HTML page", async () => {
        const res = await fetch(withClient.base + "/app/assets/gone-000.js");
        assert.equal(res.status, 404);
        assert.doesNotMatch(await res.text(), /new client/);
    });

    test("other files of the build are served as themselves", async () => {
        const res = await fetch(withClient.base + "/app/favicon.svg");
        assert.equal(res.status, 200);
        assert.match(res.headers.get("content-type"), /svg/);
    });

    test("the old page, the API and the security headers are unchanged", async () => {
        assert.match(await (await fetch(withClient.base + "/")).text(), /<title>StudyFlow<\/title>/);
        assert.equal((await fetch(withClient.base + "/api/health")).status, 200);
        assert.equal((await fetch(withClient.base + "/api/nope")).status, 404);
        assert.equal((await fetch(withClient.base + "/application")).status, 404);
        const csp = (await fetch(withClient.base + "/app/orari")).headers.get("content-security-policy");
        assert.match(csp, /script-src 'self'(;|$)/);
    });

    test("the client cannot be used to read files outside its folder", async () => {
        // The file exists and is readable from disk; only the server stands between it and the request.
        const reachable = await rawGet("/app/favicon.svg");
        assert.equal(reachable.status, 200);

        const attempts = [
            "/app/../secret.txt",
            "/app/%2e%2e/secret.txt",
            "/app/%2E%2E%2Fsecret.txt",
            "/app/..%2fsecret.txt",
            "/app/..%5csecret.txt",
            "/app/assets/../../secret.txt",
            "/app/assets/..%2f..%2fsecret.txt",
            "/app/assets/%2e%2e/%2e%2e/secret.txt",
            "/app/x/../../secret.txt",
            "/app//../secret.txt",
        ];
        for (const address of attempts) {
            const res = await rawGet(address);
            assert.equal(res.body.includes(OUTSIDE), false, `${address} served the outside file`);
            // Either refused, or answered with the client's own page like any other in-app address.
            const isClientPage = res.status === 200 && res.body.includes("new client");
            assert.ok([400, 403, 404].includes(res.status) || isClientPage, `${address} answered ${res.status}`);
        }
    });

    test("an address with a malformed escape does not crash the server", async () => {
        const inApp = await rawGet("/app/%E0%A4%A");
        assert.equal(inApp.status, 400);
        assert.deepEqual(JSON.parse(inApp.body), { code: "BAD_REQUEST", error: "Kërkesa nuk është e vlefshme." });
        // Outside /app no route tries to read the broken part, so these are simply not found.
        for (const address of ["/%E0%A4%A", "/api/%E0%A4%A"]) {
            assert.ok([400, 404].includes((await rawGet(address)).status), address);
        }
        assert.equal((await rawGet("/app/")).status, 200);
    });

    test("without a build, /app is not there and nothing else changes", async () => {
        assert.equal((await fetch(base + "/app")).status, 404);
        assert.equal((await fetch(base + "/app/orari")).status, 404);
        assert.equal((await fetch(base + "/")).status, 200);
    });
});

describe("P2-11: security headers", () => {
    test("pages and API answers carry the headers, and Express does not announce itself", async () => {
        for (const path of ["/", "/api/health", "/api/nope"]) {
            const res = await fetch(base + path);
            const csp = res.headers.get("content-security-policy");
            assert.match(csp, /default-src 'self'/, path);
            assert.match(csp, /script-src 'self'(;|$)/, path);
            assert.match(csp, /frame-ancestors 'none'/, path);
            assert.equal(res.headers.get("x-content-type-options"), "nosniff", path);
            assert.equal(res.headers.get("x-powered-by"), null, path);
        }
    });

    test("the policy allows what the page loads: its own files and Google Fonts", async () => {
        const csp = (await fetch(base + "/")).headers.get("content-security-policy");
        assert.match(csp, /style-src 'self' 'unsafe-inline' https:\/\/fonts\.googleapis\.com/);
        assert.match(csp, /font-src 'self' https:\/\/fonts\.gstatic\.com/);
        assert.match(csp, /connect-src 'self'/);
    });

    test("nothing forces HTTPS, so http://localhost keeps working", async () => {
        const res = await fetch(base + "/");
        assert.equal(res.headers.get("strict-transport-security"), null);
        assert.doesNotMatch(res.headers.get("content-security-policy"), /upgrade-insecure-requests/);
    });
});

describe("P0-5: protecting the shared AI quota", () => {
    test("a client over its limit gets 429 on every AI route, the AI is not called, other routes still answer", async () => {
        const limited = await start({ rateLimit: { windowMs: 60_000, limit: 2 } });
        try {
            assert.equal((await post(limited.base, "/api/parse", { text: "abc def" })).status, 200);
            assert.equal((await post(limited.base, "/api/create-plan", {})).status, 400); // invalid requests count too
            const callsBefore = fake.parseCalls.length + fake.planCalls.length;

            for (const path of ["/api/parse", "/api/create-plan", "/api/adjust-plan"]) {
                const res = await fetch(limited.base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "abc def" }) });
                assert.equal(res.status, 429, path);
                assert.equal((await res.json()).error, "Ke bërë shumë kërkesa njëra pas tjetrës. Prit pak minuta dhe provo përsëri.");
                assert.ok(res.headers.get("retry-after"), "says when to come back");
            }

            assert.equal(fake.parseCalls.length + fake.planCalls.length, callsBefore);
            assert.equal((await fetch(limited.base + "/api/health")).status, 200);
            assert.equal((await fetch(limited.base + "/")).status, 200);
        } finally {
            await stop(limited.server);
        }
    });

    test("only so many AI requests are worked on at once; the next gets 503 and a slot frees when one ends", async () => {
        const capped = await start({ maxConcurrentAi: 1 });
        let finishFirst;
        fake.parse = () => new Promise((resolve) => { finishFirst = () => resolve({ ok: true, data: {} }); });
        try {
            const first = post(capped.base, "/api/parse", { text: "abc def" });
            await until(() => fake.parseCalls.length > 0, "the first request to reach the AI");

            const second = await fetch(capped.base + "/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: "abc def" }) });
            assert.equal(second.status, 503);
            assert.equal(second.headers.get("retry-after"), "15");
            assert.equal((await second.json()).error, "Shërbimi është i zënë për momentin. Provo përsëri pas pak.");
            assert.equal(fake.parseCalls.length, 1);

            finishFirst();
            assert.equal((await first).status, 200);

            fake.parse = async () => ({ ok: true, data: {} });
            assert.equal((await post(capped.base, "/api/parse", { text: "abc def" })).status, 200);
        } finally {
            await stop(capped.server);
        }
    });

    test("a request that fails validation gives its slot back", async () => {
        const capped = await start({ maxConcurrentAi: 1 });
        try {
            assert.equal((await post(capped.base, "/api/parse", {})).status, 400);
            assert.equal((await post(capped.base, "/api/parse", { text: "abc def" })).status, 200);
        } finally {
            await stop(capped.server);
        }
    });
});

describe("without an API key", () => {
    let unconfigured;
    before(async () => {
        unconfigured = await start({ aiConfigured: false });
    });
    after(() => stop(unconfigured.server));

    test("health says so, and the three AI routes answer 503 before looking at the body", async () => {
        const health = await (await fetch(unconfigured.base + "/api/health")).json();
        assert.equal(health.aiConfigured, false);

        for (const path of ["/api/parse", "/api/create-plan", "/api/adjust-plan"]) {
            const { status, json } = await post(unconfigured.base, path, {});
            assert.equal(status, 503, path);
            assert.equal(json.error, "AI nuk është konfiguruar ende.", path);
        }
        assert.equal(fake.parseCalls.length + fake.planCalls.length, 0);
    });
});

describe("POST /api/parse", () => {
    test("returns what the AI extracted, and gives the AI the text and the current time", async () => {
        const parsed = { subject: "JavaScript", startDate: "2026-10-20", clarifyingQuestions: [] };
        fake.parse = async () => ({ ok: true, data: parsed });

        const { status, json } = await post(base, "/api/parse", { text: "Du me msu JavaScript" });

        assert.equal(status, 200);
        assert.deepEqual(json, { parsed });
        assert.equal(fake.parseCalls.length, 1);
        const [text, today, options] = fake.parseCalls[0];
        assert.deepEqual([text, today], ["Du me msu JavaScript", FIXED_NOW]);
        assert.ok(options.signal instanceof AbortSignal);
    });

    test("P1-13: the AI is given the person's own date when the client sends it", async () => {
        await post(base, "/api/parse", { text: "nesër kam provim", clientDate: "2026-10-15", timeZone: "Europe/Belgrade" });
        assert.equal(fake.parseCalls[0][1], "2026-10-15");
    });

    test("P1-13: with only a time zone, today is worked out for that zone", async () => {
        // The fixed clock is 2026-10-14 10:00 UTC: already the 15th on Kiritimati (UTC+14), still the 14th in Prishtina.
        await post(base, "/api/parse", { text: "nesër kam provim", timeZone: "Pacific/Kiritimati" });
        await post(base, "/api/parse", { text: "nesër kam provim", timeZone: "Europe/Belgrade" });
        assert.deepEqual(fake.parseCalls.map((call) => call[1]), ["2026-10-15", "2026-10-14"]);
    });

    test("P1-13: an unknown time zone or an impossible date is refused and names the field", async () => {
        let res = await post(base, "/api/parse", { text: "abc def", timeZone: "Prishtina" });
        assert.equal(res.status, 400);
        assert.deepEqual(res.json.fields, [{ path: "timeZone", message: "Zona kohore nuk është e vlefshme." }]);

        res = await post(base, "/api/parse", { text: "abc def", clientDate: "2026-02-31" });
        assert.equal(res.status, 400);
        assert.deepEqual(res.json.fields, [{ path: "clientDate", message: "Data nuk është e vlefshme." }]);
        assert.equal(fake.parseCalls.length, 0);
    });

    test("invalid bodies answer 400 without calling the AI", async () => {
        for (const body of [{}, { text: "ab" }, { text: "a".repeat(2001) }, { text: 5 }]) {
            const { status, json } = await post(base, "/api/parse", body);
            assert.equal(status, 400);
            assert.equal(json.error, "Përshkrimi mungon ose është shumë i gjatë/i shkurtër.");
            assert.equal(json.fields[0].path, "text");
        }
        assert.equal(fake.parseCalls.length, 0);
    });

    test("an unusable AI answer gives 502 with a safe message", async () => {
        fake.parse = async () => ({ ok: false, error: "malformed_json" });
        const { status, json } = await post(base, "/api/parse", { text: "abc def" });
        assert.equal(status, 502);
        assert.equal(json.error, "AI gjeneroi një përgjigje të pavlefshme gjatë analizimit. Provo përsëri.");
    });

    test("provider errors are mapped to safe messages and never leak provider text", async () => {
        const cases = [
            [401, 503, "AI nuk është konfiguruar ende."],
            [429, 503, "Shërbimi AI ka arritur kufirin e përdorimit. Provo më vonë."],
            [402, 503, "Modeli AI nuk është i disponueshëm për momentin."],
            [400, 502, "AI nuk e pranoi kërkesën. Provo të riformulosh."],
            [500, 502, "AI nuk mundi ta krijojë planin. Provo përsëri."],
            [undefined, 502, "AI nuk mundi ta krijojë planin. Provo përsëri."],
        ];
        for (const [providerStatus, expectedStatus, expectedMessage] of cases) {
            fake.parse = async () => {
                throw Object.assign(new Error("sk-secret provider detail"), { status: providerStatus });
            };
            const { status, json } = await post(base, "/api/parse", { text: "abc def" });
            assert.equal(status, expectedStatus, String(providerStatus));
            assert.equal(json.error, expectedMessage, String(providerStatus));
        }
    });
});

describe("every error body carries a stable code beside its message", () => {
    const adjust = (progress = {}, structured = {}) => ({ ...createBody({ startDate: "2026-10-10", endDate: "2026-10-16", ...structured }), progress: { today: "2026-10-15", ...progress } });
    const thrown = (extra) => async () => {
        throw Object.assign(new Error("provider detail"), extra);
    };

    test("requests refused before any AI work", async () => {
        const cases = [
            ["/api/parse", {}, 400, "VALIDATION"],
            ["/api/create-plan", {}, 400, "VALIDATION"],
            ["/api/adjust-plan", {}, 400, "VALIDATION"],
            ["/api/create-plan", createBody({ startDate: "2026-10-20", endDate: "2026-10-14" }), 400, "DATES_REVERSED"],
            ["/api/create-plan", createBody({ startDate: "2026-01-01", endDate: "2026-07-20" }), 400, "PERIOD_TOO_LONG"],
            ["/api/create-plan", createBody({ weeklyAvailability: [{ day: "wed", off: true }, { day: "thu", off: true }] }), 400, "NO_FREE_TIME"],
            ["/api/adjust-plan", adjust({ today: "2026-10-17" }), 400, "PLAN_FINISHED"],
            ["/api/adjust-plan", adjust({}, { weeklyAvailability: [{ day: "thu", off: true }, { day: "fri", off: true }] }), 400, "NO_FREE_TIME"],
        ];
        for (const [path, body, status, code] of cases) {
            const res = await post(base, path, body);
            assert.deepEqual([res.status, res.json.code], [status, code], `${path} ${code}`);
            assert.equal(typeof res.json.error, "string");
        }
        assert.equal(fake.parseCalls.length + fake.planCalls.length, 0);
    });

    test("malformed JSON, oversized bodies and unknown API paths", async () => {
        assert.equal((await post(base, "/api/parse", "{bad", true)).json.code, "BAD_JSON");
        assert.equal((await post(base, "/api/parse", { text: "a".repeat(150_000) })).json.code, "BODY_TOO_LARGE");
        assert.equal((await (await fetch(base + "/api/nope")).json()).code, "NOT_FOUND");
    });

    test("what the AI or its provider did, each with its own code", async () => {
        const cases = [
            [thrown({ status: 401 }), 503, "AI_NOT_CONFIGURED"],
            [thrown({ status: 429 }), 503, "PROVIDER_RATE_LIMITED"],
            [thrown({ status: 402 }), 503, "PROVIDER_UNAVAILABLE"],
            [thrown({ status: 400 }), 502, "AI_REJECTED_REQUEST"],
            [thrown({ status: 500 }), 502, "AI_FAILED"],
            [thrown({}), 502, "AI_FAILED"],
            [thrown({ code: "AI_DEADLINE" }), 504, "AI_TIMEOUT"],
            [async () => ({ ok: false, error: "malformed_json" }), 502, "AI_UNUSABLE_ANSWER"],
            [async () => ({ ok: true, data: planData([planSession("2026-10-14", "03:00", "04:00")]) }), 502, "AI_NO_USABLE_SESSIONS"],
        ];
        for (const [behaviour, status, code] of cases) {
            fake.plan = behaviour;
            const res = await post(base, "/api/create-plan", createBody());
            assert.deepEqual([res.status, res.json.code], [status, code], code);
        }
        fake.parse = async () => ({ ok: false, error: "malformed_json" });
        assert.equal((await post(base, "/api/parse", { text: "abc def" })).json.code, "AI_UNUSABLE_ANSWER");
    });

    test("the three different 503s are told apart by code, not by wording", async () => {
        const unconfigured = await start({ aiConfigured: false });
        const capped = await start({ maxConcurrentAi: 0 });
        try {
            fake.plan = thrown({ status: 429 });
            const codes = [
                (await post(unconfigured.base, "/api/create-plan", createBody())).json.code,
                (await post(capped.base, "/api/create-plan", createBody())).json.code,
                (await post(base, "/api/create-plan", createBody())).json.code,
            ];
            assert.deepEqual(codes, ["AI_NOT_CONFIGURED", "SERVER_BUSY", "PROVIDER_RATE_LIMITED"]);
        } finally {
            await stop(unconfigured.server);
            await stop(capped.server);
        }
    });

    test("a client over its limit gets RATE_LIMITED", async () => {
        const limited = await start({ rateLimit: { windowMs: 60_000, limit: 1 } });
        try {
            await post(limited.base, "/api/parse", { text: "abc def" });
            const res = await post(limited.base, "/api/parse", { text: "abc def" });
            assert.deepEqual([res.status, res.json.code], [429, "RATE_LIMITED"]);
        } finally {
            await stop(limited.server);
        }
    });

    test("every code the server can send is in the published list, and the list has no duplicates", async () => {
        const { ERROR_CODES } = await import("../lib/schema.js");
        const { readFileSync } = await import("node:fs");
        const used = new Set();
        for (const file of ["lib/app.js", "lib/plan.js", "lib/accounts/service.js", "lib/accounts/http.js", "lib/accounts/password.js", "lib/accounts/memoryRepository.js"]) {
            const source = readFileSync(new URL("../" + file, import.meta.url), "utf8");
            for (const match of source.matchAll(/(?:code|errorCode): "([A-Z_]+)"/g)) used.add(match[1]);
            for (const match of source.matchAll(/sendError\(res, "([A-Z_]+)"/g)) used.add(match[1]);
        }
        assert.equal(new Set(ERROR_CODES).size, ERROR_CODES.length);
        // EMAIL_TAKEN is the repository's own answer to the service, which turns it into the same reply as for a new address; it is never sent to a client.
        const internalOnly = new Set(["EMAIL_TAKEN"]);
        assert.deepEqual([...used].filter((code) => !ERROR_CODES.includes(code) && !internalOnly.has(code)), []);
        assert.deepEqual(ERROR_CODES.filter((code) => !used.has(code)), []);
    });
});

describe("P1-1: deadline and cancellation", () => {
    test("when the AI runs out of time every AI route answers 504 with its own message", async () => {
        const late = async () => {
            throw Object.assign(new Error("ai_deadline_exceeded"), { code: "AI_DEADLINE" });
        };
        fake.parse = late;
        fake.plan = late;
        const adjust = { ...createBody({ startDate: "2026-10-10", endDate: "2026-10-16" }), progress: { today: "2026-10-15" } };
        for (const [path, body] of [["/api/parse", { text: "abc def" }], ["/api/create-plan", createBody()], ["/api/adjust-plan", adjust]]) {
            const { status, json } = await post(base, path, body);
            assert.equal(status, 504, path);
            assert.equal(json.error, "AI po vonon më shumë se zakonisht. Provo përsëri pas pak.", path);
        }
    });

    test("when the browser cancels, the AI work is told to stop and its slot is freed", async () => {
        const capped = await start({ maxConcurrentAi: 1 });
        let seenSignal;
        fake.plan = (input, { signal }) =>
            new Promise((resolve, reject) => {
                seenSignal = signal;
                signal.addEventListener("abort", () => reject(Object.assign(new Error("ai_request_aborted"), { code: "AI_ABORTED" })));
            });
        try {
            const browser = new AbortController();
            const pending = fetch(capped.base + "/api/create-plan", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(createBody()),
                signal: browser.signal,
            }).catch((error) => error.name);

            await until(() => seenSignal, "the request to reach the AI");
            assert.equal(seenSignal.aborted, false);

            browser.abort();
            assert.equal(await pending, "AbortError");
            await until(() => seenSignal.aborted, "the AI work to be told to stop");

            // The only slot must be free again for the next request.
            fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-14", "08:00", "09:00")]) });
            let status;
            for (let i = 0; i < 50 && status !== 200; i++) {
                status = (await post(capped.base, "/api/create-plan", createBody())).status;
                if (status !== 200) await new Promise((r) => setTimeout(r, 10));
            }
            assert.equal(status, 200);
        } finally {
            await stop(capped.server);
        }
    });

    test("a request that finishes normally does not abort its signal", async () => {
        let seenSignal;
        fake.parse = async (text, today, { signal }) => {
            seenSignal = signal;
            return { ok: true, data: {} };
        };
        await post(base, "/api/parse", { text: "abc def" });
        await new Promise((r) => setTimeout(r, 30));
        assert.equal(seenSignal.aborted, false);
    });
});

describe("POST /api/create-plan", () => {
    test("returns the plan with ids, pending status, statistics and only the profile name", async () => {
        fake.plan = async () => ({
            ok: true,
            data: planData([planSession("2026-10-14", "08:00", "09:00"), planSession("2026-10-15", "20:00", "21:30", { type: "revision" })]),
        });

        const { status, json } = await post(base, "/api/create-plan", createBody({ planMode: "exam" }));

        assert.equal(status, 200);
        assert.deepEqual(Object.keys(json).sort(), ["endDate", "explanations", "planMode", "profile", "sessions", "startDate", "stats", "strategy", "subject", "warnings"]);
        assert.deepEqual(json.profile, { name: "Arta" });
        assert.deepEqual([json.subject, json.startDate, json.endDate, json.planMode], ["Matematikë", "2026-10-14", "2026-10-15", "exam"]);
        assert.deepEqual([json.strategy, json.explanations, json.warnings], ["Strategjia", ["Sepse"], ["Kujdes"]]);
        assert.deepEqual(json.stats, { totalSessions: 2, totalMinutes: 150, totalHours: 2.5 });
        assert.deepEqual(json.sessions.map((s) => [s.status, s.date, s.startTime, s.type]), [
            ["pending", "2026-10-14", "08:00", "learning"],
            ["pending", "2026-10-15", "20:00", "revision"],
        ]);
        for (const s of json.sessions) assert.match(s.id, UUID);
        assert.notEqual(json.sessions[0].id, json.sessions[1].id);
    });

    test("the AI receives the plan inputs and the computed calendar, with defaults applied", async () => {
        await post(base, "/api/create-plan", createBody({ goal: "Provimi", sessionPreferenceMinutes: 45 }));

        assert.equal(fake.planCalls.length, 1);
        const input = fake.planCalls[0][0];
        assert.deepEqual(
            [input.subject, input.goal, input.planMode, input.difficulty, input.sessionPreferenceMinutes, input.adaptation],
            ["Matematikë", "Provimi", "general", "medium", 45, undefined]
        );
        assert.deepEqual(input.calendar.map((d) => [d.date, d.weekday, d.windows.map((w) => `${w.start}-${w.end}`)]), [
            ["2026-10-14", "wed", ["07:00-23:00"]],
            ["2026-10-15", "thu", ["07:00-23:00"]],
        ]);
    });

    test("sessions outside the free windows are removed and a warning is added", async () => {
        fake.plan = async () => ({
            ok: true,
            data: planData([planSession("2026-10-14", "05:00", "06:00"), planSession("2026-10-14", "08:00", "09:00"), planSession("2026-10-20", "08:00", "09:00")]),
        });

        const { status, json } = await post(base, "/api/create-plan", createBody());

        assert.equal(status, 200);
        assert.deepEqual(json.sessions.map((s) => s.startTime), ["08:00"]);
        assert.deepEqual(json.stats, { totalSessions: 1, totalMinutes: 60, totalHours: 1 });
        assert.deepEqual(json.warnings, ["Kujdes", "2 seanca të propozuara nga AI u hoqën, sepse nuk përshtateshin me kohën që ke të lirë."]);
    });

    test("P1-3: sessions come back in time order, without overlaps and without slivers", async () => {
        fake.plan = async () => ({
            ok: true,
            data: planData([
                planSession("2026-10-15", "08:00", "09:00"),
                planSession("2026-10-14", "09:00", "11:00"),
                planSession("2026-10-14", "08:00", "10:00"),
                planSession("2026-10-14", "12:00", "12:10"),
            ]),
        });
        const { json } = await post(base, "/api/create-plan", createBody());
        assert.deepEqual(json.sessions.map((s) => `${s.date} ${s.startTime}-${s.endTime}`), ["2026-10-14 08:00-10:00", "2026-10-15 08:00-09:00"]);
        assert.equal(json.stats.totalMinutes, 180);
    });

    test("invalid bodies answer 400 without calling the AI", async () => {
        const missingSubject = createBody();
        delete missingSubject.structured.subject;
        for (const body of [{}, missingSubject, createBody({ weeklyAvailability: [{ day: "mon", windows: [{ start: "10:00", end: "09:00" }] }] })]) {
            const { status, json } = await post(base, "/api/create-plan", body);
            assert.equal(status, 400);
            assert.equal(json.error, "Na mungojnë disa të dhëna për ta krijuar planin.");
            assert.ok(json.fields.length > 0);
        }
        assert.equal(fake.planCalls.length, 0);
    });

    test("P1-6: a validation error says which field and why", async () => {
        const body = createBody({ weeklyAvailability: [{ day: "mon", windows: [{ start: "10:00", end: "09:00" }] }] });
        delete body.structured.subject;
        const { json } = await post(base, "/api/create-plan", body);
        assert.deepEqual(json.fields, [
            { path: "structured.subject", message: "Plotëso këtë fushë." },
            { path: "structured.weeklyAvailability.0.windows.0.end", message: "Koha e përfundimit duhet të jetë pas kohës së fillimit." },
        ]);
    });

    test("P1-6: a time typed as 9:00 is accepted and reaches the calendar as 09:00", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-14", "09:00", "10:00")]) });
        const body = createBody({ weeklyAvailability: [{ day: "wed", windows: [{ start: "9:00", end: "10:00" }] }] });
        const { status, json } = await post(base, "/api/create-plan", body);
        assert.equal(status, 200);
        assert.equal(json.sessions.length, 1);
        assert.deepEqual(fake.planCalls[0][0].calendar[0].windows, [{ start: "09:00", end: "10:00", minutes: 60 }]);
    });

    test("date rules answer 400 with their own message, without calling the AI", async () => {
        const cases = [
            [{ startDate: "2026-13-01", endDate: "2026-13-05" }, "Datat e planit nuk janë valide."],
            [{ startDate: "2026-10-20", endDate: "2026-10-14" }, "Data e fillimit duhet të jetë para datës së mbarimit."],
            [{ startDate: "2026-01-01", endDate: "2026-07-20" }, "Periudha e planit është shumë e gjatë (maksimumi ~6 muaj)."],
        ];
        for (const [dates, message] of cases) {
            const { status, json } = await post(base, "/api/create-plan", createBody(dates));
            assert.equal(status, 400, message);
            assert.equal(json.error, message);
        }
        assert.equal(fake.planCalls.length, 0);
    });

    test("31 February is refused and never reaches the AI", async () => {
        const { status, json } = await post(base, "/api/create-plan", createBody({ startDate: "2026-02-31", endDate: "2026-03-04" }));
        assert.equal(status, 400);
        assert.deepEqual(json, {
            code: "VALIDATION",
            error: "Datat e planit nuk janë valide.",
            fields: [{ path: "structured.startDate", message: "Data nuk është e vlefshme." }],
        });
        assert.equal(fake.planCalls.length, 0);
    });

    test("no free time at all answers 400 without calling the AI", async () => {
        const body = createBody({ weeklyAvailability: [{ day: "wed", off: true }, { day: "thu", off: true }] });
        const { status, json } = await post(base, "/api/create-plan", body);
        assert.equal(status, 400);
        assert.equal(json.error, "Nuk gjenden dritare kohore të lira në periudhën e zgjedhur. Kontrollo disponueshmërinë dhe angazhimet.");
        assert.equal(fake.planCalls.length, 0);
    });

    test("P1-4: when no proposed session is usable the answer is an error, not an empty plan", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-14", "03:00", "04:00")]) });
        const { status, json } = await post(base, "/api/create-plan", createBody());
        assert.equal(status, 502);
        assert.equal(json.error, "AI nuk arriti të vendoste asnjë seancë në kohën që ke të lirë. Provo përsëri.");
    });

    test("P1-4: one removed session is reported in the singular", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-14", "03:00", "04:00"), planSession("2026-10-14", "08:00", "09:00")], { warnings: [] }) });
        const { json } = await post(base, "/api/create-plan", createBody());
        assert.deepEqual(json.warnings, ["1 seancë e propozuar nga AI u hoq, sepse nuk përshtatej me kohën që ke të lirë."]);
    });

    test("an unusable AI answer gives 502; a provider error is mapped", async () => {
        fake.plan = async () => ({ ok: false, error: "schema_validation_failed" });
        let res = await post(base, "/api/create-plan", createBody());
        assert.equal(res.status, 502);
        assert.equal(res.json.error, "AI gjeneroi një plan të paplotë. Provo përsëri.");

        fake.plan = async () => {
            throw Object.assign(new Error("rate limited upstream"), { status: 429 });
        };
        res = await post(base, "/api/create-plan", createBody());
        assert.equal(res.status, 503);
        assert.equal(res.json.error, "Shërbimi AI ka arritur kufirin e përdorimit. Provo më vonë.");
    });
});

describe("POST /api/adjust-plan", () => {
    const adjustBody = (progress = {}, structured = {}) => ({
        ...createBody({ startDate: "2026-10-10", endDate: "2026-10-16", ...structured }),
        progress: { today: "2026-10-15", ...progress },
    });

    test("plans from today to the end date", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-15", "08:00", "09:00"), planSession("2026-10-16", "08:00", "09:00")]) });

        const { status, json } = await post(base, "/api/adjust-plan", adjustBody());

        assert.equal(status, 200);
        assert.deepEqual([json.startDate, json.endDate], ["2026-10-15", "2026-10-16"]);
        assert.deepEqual(json.sessions.map((s) => [s.status, s.date]), [
            ["pending", "2026-10-15"],
            ["pending", "2026-10-16"],
        ]);
        for (const s of json.sessions) assert.match(s.id, UUID);
        assert.deepEqual(json.stats, { totalSessions: 2, totalMinutes: 120, totalHours: 2 });
    });

    test("P0-1: session ids never repeat across a plan's creation and its later adjustments", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-15", "08:00", "09:00"), planSession("2026-10-16", "08:00", "09:00")]) });
        const created = await post(base, "/api/create-plan", createBody({ startDate: "2026-10-10", endDate: "2026-10-16" }));
        const first = await post(base, "/api/adjust-plan", adjustBody());
        const second = await post(base, "/api/adjust-plan", adjustBody());
        const ids = [created, first, second].flatMap((r) => r.json.sessions.map((s) => s.id));
        assert.equal(ids.length, 6);
        assert.equal(new Set(ids).size, 6);
    });

    test("the AI receives only the remaining calendar and the progress summaries", async () => {
        await post(base, "/api/adjust-plan", adjustBody({ completedSessionSummaries: ["2026-10-10 Hyrje (completed)"], missedSessionSummaries: ["2026-10-12 Ushtrime"], remainingMaterialNote: "Kapitulli 5" }));

        const input = fake.planCalls[0][0];
        assert.deepEqual(input.calendar.map((d) => d.date), ["2026-10-15", "2026-10-16"]);
        assert.deepEqual(input.adaptation.completed, ["2026-10-10 Hyrje (completed)"]);
        assert.deepEqual(input.adaptation.missed, ["2026-10-12 Ushtrime"]);
        assert.equal(input.adaptation.remainingMaterialNote, "Kapitulli 5");
        assert.match(input.adaptation.instruction, /^Rishpërndaj vetëm materialin e mbetur\./);
    });

    test("invalid bodies answer 400 without calling the AI", async () => {
        for (const body of [{}, createBody(), adjustBody({ today: "sot" })]) {
            const { status, json } = await post(base, "/api/adjust-plan", body);
            assert.equal(status, 400);
            assert.equal(json.error, "Na mungojnë disa të dhëna për ta rregulluar planin.");
            assert.ok(json.fields.length > 0);
        }
        assert.equal(fake.planCalls.length, 0);
    });

    test("P1-4: removed sessions are reported on adjust too, and an empty result is an error", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-15", "03:00", "04:00"), planSession("2026-10-15", "08:00", "09:00")]) });
        let res = await post(base, "/api/adjust-plan", adjustBody());
        assert.equal(res.status, 200);
        assert.deepEqual(res.json.warnings, ["Kujdes", "1 seancë e propozuar nga AI u hoq, sepse nuk përshtatej me kohën që ke të lirë."]);

        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-15", "03:00", "04:00")]) });
        res = await post(base, "/api/adjust-plan", adjustBody());
        assert.equal(res.status, 502);
        assert.equal(res.json.error, "AI nuk arriti të vendoste asnjë seancë në kohën që ke të lirë. Provo përsëri.");
    });

    test("P1-4: with no free time left, adjust answers 400 and does not call the AI", async () => {
        const body = adjustBody({}, { weeklyAvailability: [{ day: "thu", off: true }, { day: "fri", off: true }] });
        const { status, json } = await post(base, "/api/adjust-plan", body);
        assert.equal(status, 400);
        assert.equal(json.error, "Nuk ka mbetur kohë e lirë deri në fund të planit. Zgjate afatin ose shto më shumë kohë të lirë.");
        assert.equal(fake.planCalls.length, 0);
    });

    test("P1-4: a plan whose end date has passed gets its own message", async () => {
        const { status, json } = await post(base, "/api/adjust-plan", adjustBody({ today: "2026-10-17" }));
        assert.equal(status, 400);
        assert.equal(json.error, "Ky plan ka përfunduar dhe nuk ka më ditë për ta rregulluar. Krijo një plan të ri.");
        assert.equal(fake.planCalls.length, 0);
    });

    test("with the person's current time, today is planned only from now on", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-15", "19:00", "20:00")]) });
        await post(base, "/api/adjust-plan", adjustBody({ now: "18:30" }));

        assert.deepEqual(fake.planCalls[0][0].calendar.map((d) => [d.date, d.windows.map((w) => `${w.start}-${w.end}`)]), [
            ["2026-10-15", ["18:30-23:00"]],
            ["2026-10-16", ["07:00-23:00"]],
        ]);
    });

    test("a session the AI places earlier today than now is removed and reported; later today and tomorrow morning are kept", async () => {
        fake.plan = async () => ({
            ok: true,
            data: planData([
                planSession("2026-10-15", "08:00", "09:00"), // this morning, already gone
                planSession("2026-10-15", "18:00", "19:00"), // started before now
                planSession("2026-10-15", "18:30", "19:30"), // from now
                planSession("2026-10-16", "08:00", "09:00"), // tomorrow morning is fine
            ]),
        });
        const { status, json } = await post(base, "/api/adjust-plan", adjustBody({ now: "18:30" }));

        assert.equal(status, 200);
        assert.deepEqual(json.sessions.map((s) => `${s.date} ${s.startTime}`), ["2026-10-15 18:30", "2026-10-16 08:00"]);
        assert.deepEqual(json.warnings, ["Kujdes", "2 seanca të propozuara nga AI u hoqën, sepse nuk përshtateshin me kohën që ke të lirë."]);
    });

    test("current time before, during and after the free window of a one-window day", async () => {
        const oneWindow = { weeklyAvailability: [{ day: "thu", windows: [{ start: "17:00", end: "19:00" }] }, { day: "fri", windows: [{ start: "17:00", end: "19:00" }] }] };
        const todaysWindows = async (now) => {
            fake.planCalls = [];
            await post(base, "/api/adjust-plan", adjustBody({ now }, oneWindow));
            return fake.planCalls[0][0].calendar[0].windows.map((w) => `${w.start}-${w.end}`);
        };
        assert.deepEqual(await todaysWindows("09:00"), ["17:00-19:00"]);
        assert.deepEqual(await todaysWindows("17:45"), ["17:45-19:00"]);
        assert.deepEqual(await todaysWindows("18:41"), []); // 19 minutes left: not worth a session
        assert.deepEqual(await todaysWindows("21:00"), []);
    });

    test("if nothing is left of today and today is the last day, there is no free time and the AI is not called", async () => {
        const { status, json } = await post(base, "/api/adjust-plan", adjustBody({ today: "2026-10-16", now: "23:30" }));
        assert.deepEqual([status, json.code], [400, "NO_FREE_TIME"]);
        assert.equal(fake.planCalls.length, 0);
    });

    test("a client that sends no time gets the whole of today, as before", async () => {
        await post(base, "/api/adjust-plan", adjustBody());
        assert.deepEqual(fake.planCalls[0][0].calendar[0].windows.map((w) => `${w.start}-${w.end}`), ["07:00-23:00"]);
    });

    test("a current time that is not a time is refused and names the field", async () => {
        const { status, json } = await post(base, "/api/adjust-plan", adjustBody({ now: "tani" }));
        assert.equal(status, 400);
        assert.deepEqual(json.fields, [{ path: "progress.now", message: "Shkruaje orën në formatin 08:30." }]);
    });

    test("the last day of a plan can still be adjusted", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-16", "08:00", "09:00")]) });
        const { status, json } = await post(base, "/api/adjust-plan", adjustBody({ today: "2026-10-16" }));
        assert.equal(status, 200);
        assert.equal(json.sessions.length, 1);
    });

    test("an unusable AI answer gives 502; a provider error is mapped", async () => {
        fake.plan = async () => ({ ok: false, error: "insufficient_extraction" });
        let res = await post(base, "/api/adjust-plan", adjustBody());
        assert.equal(res.status, 502);
        assert.equal(res.json.error, "AI gjeneroi një plan të paplotë. Provo përsëri.");

        fake.plan = async () => {
            throw Object.assign(new Error("no credits"), { status: 402 });
        };
        res = await post(base, "/api/adjust-plan", adjustBody());
        assert.equal(res.status, 503);
        assert.equal(res.json.error, "Modeli AI nuk është i disponueshëm për momentin.");
    });
});

describe("logging", () => {
    test("validation failures and dropped sessions are logged on the server", async () => {
        await post(base, "/api/create-plan", {});
        assert.equal(errorLog.mock.calls.length, 1);
        assert.equal(errorLog.mock.calls[0].arguments[0], "[create-plan] validation failed:");
    });
});
