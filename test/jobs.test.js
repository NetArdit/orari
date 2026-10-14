import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../lib/app.js";
import { createJobStore } from "../lib/jobs.js";

const tick = () => new Promise((resolve) => setImmediate(resolve));
function deferred() {
    let resolve;
    const promise = new Promise((r) => (resolve = r));
    return { promise, resolve };
}

describe("job store", () => {
    function store(options) {
        let time = 1_000_000;
        let n = 0;
        const s = createJobStore({ now: () => time, newId: () => `job-${++n}`, ...options });
        return { s, advance: (ms) => (time += ms) };
    }

    test("a job runs, is polled, and ends done with its result", async () => {
        const { s } = store();
        const gate = deferred();
        const started = s.start("a", async () => (await gate.promise, { status: 200, body: { ok: 1 } }));
        assert.equal(started.ok, true);
        assert.equal(s.get("a", "job-1").status, "running");
        gate.resolve();
        await tick();
        await tick();
        assert.deepEqual(s.get("a", "job-1").result, { status: 200, body: { ok: 1 } });
        assert.equal(s.get("a", "job-1").status, "done");
    });

    test("a refused or crashed run ends failed, never stuck running", async () => {
        const { s } = store({ maxRunningPerOwner: 3 });
        s.start("a", async () => ({ status: 502, body: { code: "X" } }));
        s.start("a", async () => {
            throw new Error("boom");
        });
        await tick();
        await tick();
        assert.equal(s.get("a", "job-1").status, "failed");
        assert.equal(s.get("a", "job-2").status, "failed");
        assert.equal(s.get("a", "job-2").result.status, 500);
    });

    test("only the owner can read or cancel a job; a foreign id looks like an unknown one", async () => {
        const { s } = store();
        s.start("a", () => new Promise(() => {}));
        assert.equal(s.get("b", "job-1"), null);
        assert.equal(s.cancel("b", "job-1"), false);
        assert.equal(s.get("a", "job-1").status, "running");
    });

    test("cancel aborts the work's signal and the job stays cancelled", async () => {
        const { s } = store();
        let signal;
        s.start("a", (sig) => ((signal = sig), new Promise(() => {})));
        await tick();
        assert.equal(s.cancel("a", "job-1"), true);
        assert.equal(signal.aborted, true);
        assert.equal(s.get("a", "job-1").status, "cancelled");
    });

    test("a finished job is kept for the time to live and then is gone", async () => {
        const { s, advance } = store({ resultTtlMs: 1000 });
        s.start("a", async () => ({ status: 200, body: {} }));
        await tick();
        await tick();
        advance(999);
        assert.equal(s.get("a", "job-1").status, "done");
        advance(2);
        assert.equal(s.get("a", "job-1"), null);
    });

    test("the same idempotency key returns the same job and does not run the work twice", async () => {
        const { s } = store();
        let runs = 0;
        const run = () => (runs++, new Promise(() => {}));
        const first = s.start("a", run, { key: "retry-key-0001" });
        const again = s.start("a", run, { key: "retry-key-0001" });
        await tick();
        assert.equal(runs, 1);
        assert.equal(again.existing, true);
        assert.equal(again.job.id, first.job.id);
        assert.equal(s.start("b", run, { key: "retry-key-0001" }).existing, false);
    });

    test("one running job per owner, and a global limit; a bad key is refused", async () => {
        const { s } = store({ maxRunning: 2 });
        const hang = () => new Promise(() => {});
        assert.equal(s.start("a", hang).ok, true);
        assert.deepEqual(s.start("a", hang), { ok: false, code: "BUSY" });
        assert.equal(s.start("b", hang).ok, true);
        assert.deepEqual(s.start("c", hang), { ok: false, code: "BUSY" });
        assert.deepEqual(s.start("d", hang, { key: "x" }), { ok: false, code: "KEY_INVALID" });
    });

    test("a key used for a different request is refused, never answered with the first job", async () => {
        const { s } = store();
        const hang = () => new Promise(() => {});
        assert.equal(s.start("a", hang, { key: "retry-key-0001", fingerprint: "create|{1}" }).ok, true);
        assert.deepEqual(s.start("a", hang, { key: "retry-key-0001", fingerprint: "create|{2}" }), { ok: false, code: "KEY_REUSED" });
        assert.equal(s.start("a", hang, { key: "retry-key-0001", fingerprint: "create|{1}" }).existing, true);
    });

    test("a key can be used again once its job has expired", async () => {
        const { s, advance } = store({ resultTtlMs: 1000 });
        s.start("a", async () => ({ status: 200, body: {} }), { key: "retry-key-0001", fingerprint: "f" });
        await tick();
        await tick();
        advance(1001);
        const again = s.start("a", async () => ({ status: 200, body: {} }), { key: "retry-key-0001", fingerprint: "other" });
        assert.equal(again.ok, true);
        assert.equal(again.existing, false);
    });

    test("kept jobs are capped across owners, and a finished job frees its place by expiring", async () => {
        const { s, advance } = store({ maxKept: 2, maxRunning: 10, resultTtlMs: 1000 });
        const done = async () => ({ status: 200, body: {} });
        assert.equal(s.start("a", done).ok, true);
        assert.equal(s.start("b", done).ok, true);
        await tick();
        await tick();
        assert.deepEqual(s.start("c", done), { ok: false, code: "BUSY" });
        advance(1001);
        assert.equal(s.start("c", done).ok, true);
    });

    test("the late end of a cancelled job's work does not extend its life", async () => {
        const { s, advance } = store({ resultTtlMs: 1000 });
        const gate = deferred();
        s.start("a", () => gate.promise.then(() => ({ status: 200, body: {} })));
        s.cancel("a", "job-1");
        advance(900);
        gate.resolve();
        await tick();
        await tick();
        assert.equal(s.get("a", "job-1").status, "cancelled");
        advance(101);
        assert.equal(s.get("a", "job-1"), null);
    });

    test("a job that finished is not changed by a cancel", async () => {
        const { s } = store();
        s.start("a", async () => ({ status: 200, body: { ok: 1 } }));
        await tick();
        await tick();
        assert.equal(s.cancel("a", "job-1"), true);
        assert.equal(s.get("a", "job-1").status, "done");
    });
});

describe("job routes", () => {
    const inputs = {
        profile: { name: "Arta", educationLevel: null },
        structured: {
            subject: "Biologji", goal: "Provimi", planMode: "exam", difficulty: "medium", materialAmount: "Kapitujt 1-3", energy: null, sessionPreferenceMinutes: 60,
            startDate: "2026-10-15", endDate: "2026-10-16",
            weeklyAvailability: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({ day, off: false, windows: [{ start: "17:00", end: "19:00" }] })),
            commitments: [], excludedDates: [],
        },
    };

    async function boot(plan) {
        const app = createApp({
            clientDir: path.join(tmpdir(), "orari-no-client-build"),
            aiConfigured: true,
            parseNaturalLanguageRequest: async () => ({ ok: true, data: {} }),
            generateStudyPlan: plan,
            now: () => new Date("2026-10-14T10:00:00Z"),
            rateLimit: { windowMs: 60_000, limit: 100_000 },
        });
        const server = await new Promise((resolve) => {
            const s = app.listen(0, "127.0.0.1", () => resolve(s));
        });
        const base = `http://127.0.0.1:${server.address().port}`;
        const send = async (method, p, body, headers = {}) => {
            const res = await fetch(base + p, { method, headers: { "Content-Type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
            return { status: res.status, json: await res.json() };
        };
        return { send, base, close: () => new Promise((r) => server.close(r)) };
    }

    test("start answers at once with 202, the poll shows running then done with the same body the direct route gives", async () => {
        const gate = deferred();
        const sessions = [{ date: "2026-10-15", startTime: "17:00", endTime: "18:00", type: "learning", title: "Kapitulli 1", goal: "", tasks: [], material: null, difficulty: "medium" }];
        const { send, close } = await boot(async () => (await gate.promise, { ok: true, data: { strategy: "s", explanations: [], warnings: [], sessions } }));
        try {
            const start = await send("POST", "/api/jobs/create-plan", inputs);
            assert.equal(start.status, 202);
            const id = start.json.job.id;
            assert.equal((await send("GET", `/api/jobs/${id}`)).json.job.status, "running");
            gate.resolve();
            let polled;
            for (let i = 0; i < 50; i++) {
                polled = await send("GET", `/api/jobs/${id}`);
                if (polled.json.job.status !== "running") break;
                await new Promise((r) => setTimeout(r, 10));
            }
            assert.equal(polled.json.job.status, "done");
            assert.equal(polled.json.job.result.status, 200);
            assert.equal(polled.json.job.result.body.subject, "Biologji");
            assert.equal(polled.json.job.result.body.sessions.length, 1);
        } finally {
            await close();
        }
    });

    test("an invalid request becomes a failed job with the same 400 body, a second start while one runs is 429", async () => {
        const gate = deferred();
        const { send, close } = await boot(async () => (await gate.promise, { ok: false, error: "x" }));
        try {
            const bad = await send("POST", "/api/jobs/create-plan", { nope: true });
            assert.equal(bad.status, 202);
            let polled;
            for (let i = 0; i < 50; i++) {
                polled = await send("GET", `/api/jobs/${bad.json.job.id}`);
                if (polled.json.job.status !== "running") break;
                await new Promise((r) => setTimeout(r, 10));
            }
            assert.equal(polled.json.job.status, "failed");
            assert.equal(polled.json.job.result.status, 400);
            assert.equal(polled.json.job.result.body.code, "VALIDATION");

            const first = await send("POST", "/api/jobs/create-plan", inputs);
            assert.equal(first.status, 202);
            assert.equal((await send("POST", "/api/jobs/create-plan", inputs)).status, 429);
            assert.equal((await send("POST", `/api/jobs/${first.json.job.id}/cancel`, {})).status, 200);
            assert.equal((await send("GET", `/api/jobs/${first.json.job.id}`)).json.job.status, "cancelled");
            gate.resolve();
        } finally {
            await close();
        }
    });

    test("cancelling a job aborts the signal the plan generation was given, and its late answer changes nothing", async () => {
        let seen;
        const gate = deferred();
        const { send, close } = await boot(async (_args, options) => {
            seen = options.signal;
            await gate.promise;
            return { ok: false, error: "late" };
        });
        try {
            const start = await send("POST", "/api/jobs/create-plan", inputs);
            assert.equal(start.status, 202);
            for (let i = 0; i < 50 && !seen; i++) await new Promise((r) => setTimeout(r, 10));
            assert.ok(seen, "generation started");
            assert.equal(seen.aborted, false);
            assert.equal((await send("POST", `/api/jobs/${start.json.job.id}/cancel`, {})).status, 200);
            assert.equal(seen.aborted, true);
            gate.resolve();
            await new Promise((r) => setTimeout(r, 30));
            const polled = await send("GET", `/api/jobs/${start.json.job.id}`);
            assert.equal(polled.json.job.status, "cancelled");
            assert.equal(polled.json.job.result, undefined);
        } finally {
            gate.resolve();
            await close();
        }
    });

    test("the same Idempotency-Key and request gives the same job; the same key with another request is 400", async () => {
        const gate = deferred();
        const { send, close } = await boot(async () => (await gate.promise, { ok: false, error: "x" }));
        try {
            const headers = { "Idempotency-Key": "retry-key-0001" };
            const first = await send("POST", "/api/jobs/create-plan", inputs, headers);
            assert.equal(first.status, 202);
            const again = await send("POST", "/api/jobs/create-plan", inputs, headers);
            assert.equal(again.status, 200);
            assert.equal(again.json.job.id, first.json.job.id);
            const other = await send("POST", "/api/jobs/create-plan", { ...inputs, structured: { ...inputs.structured, subject: "Kimi" } }, headers);
            assert.equal(other.status, 400);
            assert.equal(other.json.code, "BAD_REQUEST");
            const badKey = await send("POST", "/api/jobs/create-plan", inputs, { "Idempotency-Key": "x" });
            assert.equal(badKey.status, 400);
        } finally {
            gate.resolve();
            await close();
        }
    });

    test("the same request with its properties in another order is still the same request; another kind is not", async () => {
        const gate = deferred();
        const { send, close } = await boot(async () => (await gate.promise, { ok: false, error: "x" }));
        try {
            const headers = { "Idempotency-Key": "retry-key-0002" };
            const first = await send("POST", "/api/jobs/create-plan", inputs, headers);
            assert.equal(first.status, 202);
            const reordered = {
                structured: Object.fromEntries(Object.entries(inputs.structured).reverse()),
                profile: { educationLevel: null, name: "Arta" },
            };
            const again = await send("POST", "/api/jobs/create-plan", reordered, headers);
            assert.equal(again.status, 200);
            assert.equal(again.json.job.id, first.json.job.id);
            // The same request for the other kind is not the same request.
            assert.equal((await send("POST", "/api/jobs/adjust-plan", inputs, headers)).status, 400);
        } finally {
            gate.resolve();
            await close();
        }
    });

    test("canonicalJson ignores key order and undefined, and keeps array order", async () => {
        const { canonicalJson } = await import("../lib/jobs.js");
        assert.equal(canonicalJson({ b: 1, a: { d: [2, 1], c: undefined } }), canonicalJson({ a: { c: undefined, d: [2, 1] }, b: 1 }));
        assert.notEqual(canonicalJson({ a: [1, 2] }), canonicalJson({ a: [2, 1] }));
    });

    test("without accounts, state-changing AI and job requests from another site are refused; this site's own and non-browser ones pass", async () => {
        const gate = deferred();
        const { base, close } = await boot(async () => (await gate.promise, { ok: false, error: "x" }));
        try {
            const post = (p, body, headers = {}) => fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
            const foreign = { Origin: "https://evil.example" };
            for (const p of ["/api/jobs/create-plan", "/api/create-plan", "/api/adjust-plan", "/api/parse"]) {
                const res = await post(p, inputs, foreign);
                assert.equal(res.status, 403, p);
                assert.equal((await res.json()).code, "FORBIDDEN_ORIGIN");
            }
            assert.equal((await post("/api/jobs/create-plan", inputs, { "Sec-Fetch-Site": "cross-site" })).status, 403);
            assert.equal((await post("/api/jobs/create-plan", inputs, { Origin: "null" })).status, 403);
            // Same host, other scheme: another origin.
            assert.equal((await post("/api/jobs/create-plan", inputs, { Origin: base.replace("http://", "https://") })).status, 403);

            // Its own origin, and a client that sends none, are accepted.
            const own = await post("/api/jobs/create-plan", inputs, { Origin: base });
            assert.equal(own.status, 202);
            const id = (await own.json()).job.id;
            assert.equal((await post(`/api/jobs/${id}/cancel`, {}, foreign)).status, 403);
            assert.equal((await post(`/api/jobs/${id}/cancel`, {})).status, 200);
            // A read is never blocked by origin.
            assert.equal((await fetch(base + `/api/jobs/${id}`, { headers: foreign })).status, 200);
        } finally {
            gate.resolve();
            await close();
        }
    });

    test("job answers are never cached", async () => {
        const gate = deferred();
        const { send, base, close } = await boot(async () => (await gate.promise, { ok: false, error: "x" }));
        try {
            const post = await fetch(base + "/api/jobs/create-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(inputs) });
            assert.equal(post.headers.get("cache-control"), "no-store");
            const id = (await post.json()).job.id;
            const get = await fetch(base + `/api/jobs/${id}`);
            assert.equal(get.headers.get("cache-control"), "no-store");
            const cancel = await fetch(base + `/api/jobs/${id}/cancel`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
            assert.equal(cancel.headers.get("cache-control"), "no-store");
            void send;
        } finally {
            gate.resolve();
            await close();
        }
    });

    test("an unknown kind and an unknown job are 404", async () => {
        const { send, close } = await boot(async () => ({ ok: true, data: {} }));
        try {
            assert.equal((await send("POST", "/api/jobs/nothing", {})).status, 404);
            assert.equal((await send("GET", "/api/jobs/does-not-exist")).status, 404);
        } finally {
            await close();
        }
    });
});
