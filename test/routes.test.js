import { test, describe, before, after, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

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
        ...options,
    });
    return new Promise((resolve) => {
        const server = app.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
    });
}

const stop = (server) => new Promise((resolve) => server.close(resolve));

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
        assert.deepEqual(await res.json(), { error: "API endpoint nuk u gjet." });
    });

    test("malformed JSON answers 400", async () => {
        const { status, json } = await post(base, "/api/parse", "{bad", true);
        assert.equal(status, 400);
        assert.deepEqual(json, { error: "Kërkesa nuk është JSON valid." });
    });

    test("a body over 100 kB answers 413", async () => {
        const { status, json } = await post(base, "/api/parse", { text: "a".repeat(150_000) });
        assert.equal(status, 413);
        assert.deepEqual(json, { error: "Kërkesa është shumë e madhe." });
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
            assert.deepEqual(json, { error: "AI nuk është konfiguruar ende." }, path);
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
        assert.deepEqual(fake.parseCalls, [["Du me msu JavaScript", FIXED_NOW]]);
    });

    test("invalid bodies answer 400 without calling the AI", async () => {
        for (const body of [{}, { text: "ab" }, { text: "a".repeat(2001) }, { text: 5 }]) {
            const { status, json } = await post(base, "/api/parse", body);
            assert.equal(status, 400);
            assert.deepEqual(json, { error: "Përshkrimi mungon ose është shumë i gjatë/i shkurtër." });
        }
        assert.equal(fake.parseCalls.length, 0);
    });

    test("an unusable AI answer gives 502 with a safe message", async () => {
        fake.parse = async () => ({ ok: false, error: "malformed_json" });
        const { status, json } = await post(base, "/api/parse", { text: "abc def" });
        assert.equal(status, 502);
        assert.deepEqual(json, { error: "AI gjeneroi një përgjigje të pavlefshme gjatë analizimit. Provo përsëri." });
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
            assert.deepEqual(json, { error: expectedMessage }, String(providerStatus));
        }
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
        assert.deepEqual(json.warnings, ["Kujdes", "Disa sesione u rregulluan për t'iu përshtatur kohës së lirë."]);
    });

    test("invalid bodies answer 400 without calling the AI", async () => {
        const missingSubject = createBody();
        delete missingSubject.structured.subject;
        for (const body of [{}, missingSubject, createBody({ weeklyAvailability: [{ day: "mon", windows: [{ start: "9:00", end: "10:00" }] }] })]) {
            const { status, json } = await post(base, "/api/create-plan", body);
            assert.equal(status, 400);
            assert.deepEqual(json, { error: "Na mungojnë disa të dhëna për ta krijuar planin." });
        }
        assert.equal(fake.planCalls.length, 0);
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
            assert.deepEqual(json, { error: message });
        }
        assert.equal(fake.planCalls.length, 0);
    });

    test("31 February is refused and never reaches the AI", async () => {
        const { status, json } = await post(base, "/api/create-plan", createBody({ startDate: "2026-02-31", endDate: "2026-03-04" }));
        assert.equal(status, 400);
        assert.deepEqual(json, { error: "Datat e planit nuk janë valide." });
        assert.equal(fake.planCalls.length, 0);
    });

    test("no free time at all answers 400 without calling the AI", async () => {
        const body = createBody({ weeklyAvailability: [{ day: "wed", off: true }, { day: "thu", off: true }] });
        const { status, json } = await post(base, "/api/create-plan", body);
        assert.equal(status, 400);
        assert.deepEqual(json, { error: "Nuk gjenden dritare kohore të lira në periudhën e zgjedhur. Kontrollo disponueshmërinë dhe angazhimet." });
        assert.equal(fake.planCalls.length, 0);
    });

    test("an unusable AI answer gives 502; a provider error is mapped", async () => {
        fake.plan = async () => ({ ok: false, error: "schema_validation_failed" });
        let res = await post(base, "/api/create-plan", createBody());
        assert.equal(res.status, 502);
        assert.deepEqual(res.json, { error: "AI gjeneroi një plan të paplotë. Provo përsëri." });

        fake.plan = async () => {
            throw Object.assign(new Error("rate limited upstream"), { status: 429 });
        };
        res = await post(base, "/api/create-plan", createBody());
        assert.equal(res.status, 503);
        assert.deepEqual(res.json, { error: "Shërbimi AI ka arritur kufirin e përdorimit. Provo më vonë." });
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
            assert.deepEqual(json, { error: "Na mungojnë disa të dhëna për ta rregulluar planin." });
        }
        assert.equal(fake.planCalls.length, 0);
    });

    test("an unusable AI answer gives 502; a provider error is mapped", async () => {
        fake.plan = async () => ({ ok: false, error: "insufficient_extraction" });
        let res = await post(base, "/api/adjust-plan", adjustBody());
        assert.equal(res.status, 502);
        assert.deepEqual(res.json, { error: "AI gjeneroi një plan të paplotë. Provo përsëri." });

        fake.plan = async () => {
            throw Object.assign(new Error("no credits"), { status: 402 });
        };
        res = await post(base, "/api/adjust-plan", adjustBody());
        assert.equal(res.status, 503);
        assert.deepEqual(res.json, { error: "Modeli AI nuk është i disponueshëm për momentin." });
    });
});

describe("logging", () => {
    test("validation failures and dropped sessions are logged on the server", async () => {
        await post(base, "/api/create-plan", {});
        assert.equal(errorLog.mock.calls.length, 1);
        assert.equal(errorLog.mock.calls[0].arguments[0], "[create-plan] validation failed:");
    });
});

describe("KNOWN DEFECTS, to be reversed in Phase 1", () => {
    test("KNOWN DEFECT P1-4: when every session is dropped, create-plan still answers 200 with an empty plan", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-14", "03:00", "04:00")]) });
        const { status, json } = await post(base, "/api/create-plan", createBody());
        assert.equal(status, 200);
        assert.deepEqual(json.sessions, []);
        assert.deepEqual(json.stats, { totalSessions: 0, totalMinutes: 0, totalHours: 0 });
    });

    test("KNOWN DEFECT P1-4: adjust-plan drops sessions without telling the user, and accepts an empty result", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-15", "03:00", "04:00")]) });
        const body = { ...createBody({ startDate: "2026-10-10", endDate: "2026-10-16" }), progress: { today: "2026-10-15" } };
        const { status, json } = await post(base, "/api/adjust-plan", body);
        assert.equal(status, 200);
        assert.deepEqual(json.sessions, []);
        assert.deepEqual(json.warnings, ["Kujdes"]);
    });

    test("KNOWN DEFECT P1-4: adjust-plan calls the AI even when no free time is left", async () => {
        const body = {
            ...createBody({ startDate: "2026-10-10", endDate: "2026-10-16", weeklyAvailability: [{ day: "thu", off: true }, { day: "fri", off: true }] }),
            progress: { today: "2026-10-15" },
        };
        await post(base, "/api/adjust-plan", body);
        assert.equal(fake.planCalls.length, 1);
        assert.equal(fake.planCalls[0][0].calendar.every((d) => d.windows.length === 0), true);
    });

    test("KNOWN DEFECT P1-3: overlapping sessions are both returned", async () => {
        fake.plan = async () => ({ ok: true, data: planData([planSession("2026-10-14", "08:00", "10:00"), planSession("2026-10-14", "09:00", "11:00")]) });
        const { json } = await post(base, "/api/create-plan", createBody());
        assert.equal(json.sessions.length, 2);
        assert.equal(json.stats.totalMinutes, 240);
    });

    test("KNOWN DEFECT P1-6: a finished plan is refused with a message about the start date", async () => {
        const body = { ...createBody({ startDate: "2026-10-01", endDate: "2026-10-05" }), progress: { today: "2026-10-14" } };
        const { status, json } = await post(base, "/api/adjust-plan", body);
        assert.equal(status, 400);
        assert.deepEqual(json, { error: "Data e fillimit duhet të jetë para datës së mbarimit." });
    });
});
