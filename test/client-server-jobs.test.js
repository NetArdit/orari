// The real API client (client/src/api/client.ts, run as it is) against the real Express app with a fake
// plan generator: start, poll, done, failure, abort and cancel meet over a real socket. What this does not
// show: a real AI provider, a browser, a proxy, restart durability.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import path from "node:path";

import { createApp } from "../lib/app.js";
import { createApiClient } from "../client/src/api/client.ts";

const input = {
    profile: { name: "Arta", educationLevel: null },
    structured: {
        subject: "Biologji", goal: "Provimi", planMode: "exam", difficulty: "medium", materialAmount: "Kapitujt 1-3", energy: null, sessionPreferenceMinutes: 60,
        startDate: "2026-10-15", endDate: "2026-10-16",
        weeklyAvailability: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({ day, off: false, windows: [{ start: "17:00", end: "19:00" }] })),
        commitments: [], excludedDates: [],
    },
};
const sessions = [{ date: "2026-10-15", startTime: "17:00", endTime: "18:00", type: "learning", title: "Kapitulli 1", goal: "", tasks: [], material: null, difficulty: "medium" }];

async function boot(generateStudyPlan, { trustProxy = 0 } = {}) {
    const app = createApp({
        clientDir: path.join(tmpdir(), "orari-no-client-build"),
        aiConfigured: true,
        parseNaturalLanguageRequest: async () => ({ ok: true, data: {} }),
        generateStudyPlan,
        now: () => new Date("2026-10-14T10:00:00Z"),
        rateLimit: { windowMs: 60_000, limit: 100_000 },
    });
    if (trustProxy) app.set("trust proxy", trustProxy);
    const server = await new Promise((resolve) => {
        const s = app.listen(0, "127.0.0.1", () => resolve(s));
    });
    const base = `http://127.0.0.1:${server.address().port}`;
    return { base, close: () => new Promise((r) => server.close(r)), client: createApiClient({ baseUrl: base, pollMs: 20, aiTimeoutMs: 5000 }) };
}

describe("API client against the real server (fake generator)", () => {
    test("a plan arrives through start, poll and done", async () => {
        const { client, close } = await boot(async () => ({ ok: true, data: { strategy: "s", explanations: [], warnings: [], sessions } }));
        try {
            const r = await client.createPlan(input);
            assert.equal(r.ok, true, JSON.stringify(r));
            assert.equal(r.data.sessions.length, 1);
        } finally { await close(); }
    });

    test("a failing generator is a failure the client names, not a plan", async () => {
        const { client, close } = await boot(async () => ({ ok: false, status: 502, error: "AI nuk u përgjigj" }));
        try {
            const r = await client.createPlan(input);
            assert.equal(r.ok, false);
            assert.notEqual(r.kind, "aborted");
        } finally { await close(); }
    });

    test("abort mid-run: the client returns aborted and the generator's signal is aborted", async () => {
        let seen;
        let started;
        const startedP = new Promise((r) => (started = r));
        const { client, close } = await boot((_args, options) => {
            seen = options.signal;
            started();
            return new Promise((resolve) => options.signal.addEventListener("abort", () => resolve({ ok: false, status: 499, error: "x" })));
        });
        try {
            const ctrl = new AbortController();
            const pending = client.createPlan(input, { signal: ctrl.signal });
            await startedP;
            ctrl.abort();
            const r = await pending;
            assert.equal(r.ok, false);
            assert.equal(r.kind, "aborted");
            for (let i = 0; i < 50 && !seen?.aborted; i++) await new Promise((r2) => setTimeout(r2, 20));
            assert.equal(seen?.aborted, true);
        } finally { await close(); }
    });

    test("a request from another origin is refused before any work starts", async () => {
        let calls = 0;
        const { base, close } = await boot(async () => (calls++, { ok: true, data: { strategy: "", explanations: [], warnings: [], sessions } }));
        try {
            const res = await fetch(base + "/api/jobs/create-plan", {
                method: "POST", headers: { "Content-Type": "application/json", Origin: "https://evil.example" }, body: JSON.stringify(input),
            });
            assert.equal(res.status, 403);
            assert.equal(calls, 0);
        } finally { await close(); }
    });

    describe("behind a TLS-terminating proxy", () => {
        const post = (base, headers) => fetch(base + "/api/jobs/create-plan", { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(input) });
        const ok = async () => ({ ok: true, data: { strategy: "", explanations: [], warnings: [], sessions } });

        test("with trust proxy set, the public https origin is accepted and another is refused", async () => {
            const { base, close } = await boot(ok, { trustProxy: 1 });
            try {
                const host = new URL(base).host;
                const proxied = { "X-Forwarded-Proto": "https" };
                assert.equal((await post(base, { ...proxied, Origin: "https://" + host })).status, 202);
                assert.equal((await post(base, { ...proxied, Origin: "http://" + host })).status, 403);
                assert.equal((await post(base, { ...proxied, Origin: "https://evil.example" })).status, 403);
            } finally { await close(); }
        });

        test("without trust proxy the forwarded scheme is ignored: the https origin is refused (fails closed)", async () => {
            const { base, close } = await boot(ok);
            try {
                const host = new URL(base).host;
                assert.equal((await post(base, { "X-Forwarded-Proto": "https", Origin: "https://" + host })).status, 403);
            } finally { await close(); }
        });
    });
});
