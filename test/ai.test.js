import { test, describe, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";

import { createAi, resolveModels, DEFAULT_MODELS, DEFAULT_DEADLINE_MS, MAX_MODELS } from "../lib/ai.js";

/* The model walk, the retries and the repair loop, against a scripted fake client.
   No network: the fake stands in for the OpenAI SDK object. */

const MODELS = ["model-a", "model-b", "model-c"];

const reply = (content) => ({ choices: [{ message: { content } }] });
const httpError = (status, extra = {}) => Object.assign(new Error(`provider said ${status}`), { status, ...extra });

const VALID_PLAN = JSON.stringify({
    strategy: "Strategjia",
    explanations: ["Sepse"],
    warnings: [],
    sessions: [{ date: "2026-10-14", startTime: "08:00", endTime: "09:00", type: "learning", title: "Hyrje" }],
});

const PLAN_INPUT = {
    subject: "Matematikë",
    goal: "Provimi",
    planMode: "exam",
    difficulty: "hard",
    materialAmount: null,
    energy: null,
    sessionPreferenceMinutes: 60,
    calendar: [
        { date: "2026-10-14", weekday: "wed", windows: [{ start: "08:00", end: "10:00", minutes: 120 }], totalMinutes: 120 },
        { date: "2026-10-15", weekday: "thu", windows: [], totalMinutes: 0 },
    ],
};

/** A client whose answers are taken from a script: each entry is a reply, an Error to throw, or a function. */
function scripted(script) {
    const calls = [];
    const client = {
        chat: {
            completions: {
                create: async (params, options) => {
                    calls.push({ params: structuredClone(params), options });
                    const step = script.length > 1 ? script.shift() : script[0];
                    if (typeof step === "function") return step(params, options);
                    if (step instanceof Error) throw step;
                    return step;
                },
            },
        },
    };
    return { client, calls };
}

function build(script, options = {}) {
    const { client, calls } = scripted(script);
    const sleeps = [];
    const ai = createAi({ client, models: MODELS, sleep: async (ms) => sleeps.push(ms), ...options });
    return { ai, calls, sleeps };
}

const modelsCalled = (calls) => calls.map((c) => c.params.model);

beforeEach(() => {
    mock.method(console, "error", () => {});
});

describe("defaults", () => {
    test("free models only, without the one OpenRouter no longer lists, and a 75 second deadline", () => {
        assert.deepEqual(DEFAULT_MODELS, ["google/gemma-4-31b-it:free", "dots-studio/dots-3-note-preview:free", "liquid/lfm-2.5-2.6b:free"]);
        assert.ok(DEFAULT_MODELS.every((m) => m.endsWith(":free")));
        assert.equal(DEFAULT_MODELS.includes("z-ai/glm-5.2:free"), false);
        assert.equal(DEFAULT_DEADLINE_MS, 75_000);
    });
});

describe("the model list is configuration, checked locally", () => {
    test("nothing set, or only blanks: the defaults, as a copy", () => {
        assert.deepEqual(resolveModels(undefined), DEFAULT_MODELS);
        assert.deepEqual(resolveModels("  "), DEFAULT_MODELS);
        resolveModels(undefined).push("x");
        assert.equal(DEFAULT_MODELS.length, 3);
    });

    test("a comma-separated list is used in the order given, with spaces and empty items tolerated", () => {
        assert.deepEqual(resolveModels(" meta/llama-5:free ,, google/gemma-4-31b-it:free "), ["meta/llama-5:free", "google/gemma-4-31b-it:free"]);
    });

    test("a model that is not free is refused: there is no paid fallback", () => {
        for (const bad of ["openai/gpt-5", "anthropic/claude-sonnet-5-5", "google/gemma-4-31b-it", "google/gemma-4-31b-it:free,openai/gpt-5", "vendor/model:free-trial"]) {
            assert.throws(() => resolveModels(bad), /not a free model/, bad);
        }
    });

    test("ids that are not of the form vendor/name:free, an empty list, repeats and too many are refused with a message", () => {
        assert.throws(() => resolveModels("gemma:free"), /not a valid model id/);
        assert.throws(() => resolveModels("a b/c:free"), /not a valid model id/);
        assert.throws(() => resolveModels("/x:free"), /not a valid model id/);
        assert.throws(() => resolveModels("../x:free"), /not a valid model id/);
        assert.throws(() => resolveModels(",,"), /holds no model id/);
        assert.throws(() => resolveModels("a/b:free,a/b:free"), /same model twice/);
        const many = Array.from({ length: MAX_MODELS + 1 }, (_, i) => `v/m${i}:free`).join(",");
        assert.throws(() => resolveModels(many), /at most 8/);
        assert.equal(resolveModels(many.split(",").slice(0, MAX_MODELS).join(",")).length, MAX_MODELS);
    });

    test("resolving the list makes no network request", () => {
        const before = globalThis.fetch;
        globalThis.fetch = () => {
            throw new Error("network used");
        };
        try {
            assert.equal(resolveModels(undefined).length, 3);
            assert.equal(resolveModels("a/b:free").length, 1);
        } finally {
            globalThis.fetch = before;
        }
    });
});

describe("a clean answer", () => {
    test("uses the first model once, in JSON mode, and returns the validated data with defaults filled in", async () => {
        const { ai, calls, sleeps } = build([reply(VALID_PLAN)]);

        const result = await ai.generateStudyPlan(PLAN_INPUT);

        assert.equal(result.ok, true);
        assert.deepEqual(result.data.sessions[0], {
            date: "2026-10-14", startTime: "08:00", endTime: "09:00", type: "learning", title: "Hyrje",
            goal: "", tasks: [], material: null, difficulty: "medium",
        });
        assert.deepEqual(modelsCalled(calls), ["model-a"]);
        assert.deepEqual(calls[0].params.response_format, { type: "json_object" });
        assert.equal(calls[0].params.temperature, 0.3);
        assert.ok(calls[0].options.signal instanceof AbortSignal);
        assert.deepEqual(sleeps, []);
    });

    test("the plan request sends only days that have free time, in compact form", async () => {
        const { ai, calls } = build([reply(VALID_PLAN)]);
        await ai.generateStudyPlan(PLAN_INPUT);

        const [system, user] = calls[0].params.messages;
        assert.equal(system.role, "system");
        assert.match(system.content, /^Ti je StudyFlow/);
        assert.deepEqual(JSON.parse(user.content), {
            subject: "Matematikë", goal: "Provimi", planMode: "exam", difficulty: "hard",
            materialAmount: null, energy: null, sessionPreferenceMinutes: 60,
            calendar: [{ date: "2026-10-14", wd: "wed", free: ["08:00-10:00"] }],
        });
    });

    test("the parse request tells the model today's date and passes the text through untouched", async () => {
        const { ai, calls } = build([reply(JSON.stringify({ subject: "JavaScript" }))]);

        const result = await ai.parseNaturalLanguageRequest("Du me msu JavaScript", new Date("2026-10-14T10:00:00Z"));

        assert.equal(result.ok, true);
        assert.equal(result.data.subject, "JavaScript");
        const [system, user] = calls[0].params.messages;
        assert.match(system.content, /Sot është 2026-10-14 \(Wednesday\)/);
        assert.equal(user.content, "Du me msu JavaScript");
    });

    test("P1-13: given the person's date as text, the weekday is computed from that date, not from the server's clock", async () => {
        const { ai, calls } = build([reply(JSON.stringify({ subject: "JavaScript" }))]);
        await ai.parseNaturalLanguageRequest("Du me msu JavaScript", "2026-10-18");
        assert.match(calls[0].params.messages[0].content, /Sot është 2026-10-18 \(Sunday\)/);
    });

    test("JSON wrapped in a code fence or in prose is still read", async () => {
        const { ai } = build([reply("Ja plani:\n```json\n" + VALID_PLAN + "\n```")]);
        assert.equal((await ai.generateStudyPlan(PLAN_INPUT)).ok, true);
    });
});

describe("walking the models", () => {
    test("a rate limit gets one short wait and one retry on the same model, then the next model", async () => {
        const { ai, calls, sleeps } = build([httpError(429), httpError(429), reply(VALID_PLAN)]);

        const result = await ai.generateStudyPlan(PLAN_INPUT);

        assert.equal(result.ok, true);
        assert.deepEqual(modelsCalled(calls), ["model-a", "model-a", "model-b"]);
        assert.deepEqual(sleeps, [3000]);
    });

    test("the wait follows the provider's hint, capped at five seconds", async () => {
        const hint = (seconds) => httpError(429, { error: { metadata: { retry_after_seconds: seconds } } });
        const short = build([hint(2), reply(VALID_PLAN)]);
        await short.ai.generateStudyPlan(PLAN_INPUT);
        assert.deepEqual(short.sleeps, [2000]);

        const long = build([hint(120), reply(VALID_PLAN)]);
        await long.ai.generateStudyPlan(PLAN_INPUT);
        assert.deepEqual(long.sleeps, [5000]);
    });

    test("an outage, a missing model, no credits or a network error move straight to the next model", async () => {
        for (const failure of [httpError(500), httpError(404), httpError(402), Object.assign(new Error("socket hang up"), { code: "ECONNRESET" })]) {
            const { ai, calls, sleeps } = build([failure, reply(VALID_PLAN)]);
            const result = await ai.generateStudyPlan(PLAN_INPUT);
            assert.equal(result.ok, true);
            assert.deepEqual(modelsCalled(calls), ["model-a", "model-b"]);
            assert.deepEqual(sleeps, []);
        }
    });

    test("a rejected key stops everything at once and is thrown to the caller", async () => {
        const { ai, calls } = build([httpError(401)]);
        await assert.rejects(ai.generateStudyPlan(PLAN_INPUT), { status: 401 });
        assert.equal(calls.length, 1);
    });

    test("a model that refuses JSON mode is retried once without it", async () => {
        const { ai, calls } = build([httpError(400), reply(VALID_PLAN)]);

        const result = await ai.generateStudyPlan(PLAN_INPUT);

        assert.equal(result.ok, true);
        assert.deepEqual(modelsCalled(calls), ["model-a", "model-a"]);
        assert.deepEqual(calls[0].params.response_format, { type: "json_object" });
        assert.equal("response_format" in calls[1].params, false);
    });

    test("when every model fails, the whole walk is done twice and the result is a failure, not an exception", async () => {
        const { ai, calls } = build([httpError(500)]);

        const result = await ai.generateStudyPlan(PLAN_INPUT);

        assert.equal(result.ok, false);
        assert.equal(result.error, "provider said 500");
        assert.deepEqual(modelsCalled(calls), [...MODELS, ...MODELS]);
    });
});

describe("repairing a bad answer", () => {
    test("text that is not JSON is sent back with a repair instruction, at temperature 0", async () => {
        const { ai, calls } = build([reply("Më vjen keq, nuk mundem."), reply(VALID_PLAN)]);

        const result = await ai.generateStudyPlan(PLAN_INPUT);

        assert.equal(result.ok, true);
        assert.equal(calls.length, 2);
        assert.equal(calls[1].params.temperature, 0);
        const messages = calls[1].params.messages;
        assert.deepEqual(messages.map((m) => m.role), ["system", "user", "assistant", "user"]);
        assert.equal(messages[2].content, "Më vjen keq, nuk mundem.");
        assert.match(messages[3].content, /nuk ishte JSON valid/);
    });

    test("JSON of the wrong shape gets the shape instruction; two bad answers give up", async () => {
        const wrongShape = JSON.stringify({ sessions: [{ date: "14 tetor", startTime: "8", endTime: "9", type: "x", title: "" }] });
        const { ai, calls } = build([reply(wrongShape)]);

        const result = await ai.generateStudyPlan(PLAN_INPUT);

        assert.deepEqual(result, { ok: false, error: "schema_validation_failed" });
        assert.equal(calls.length, 2);
        assert.match(calls[1].params.messages[3].content, /Struktura e JSON nuk përputhet/);
    });

    test("a date that does not exist counts as the wrong shape", async () => {
        const impossible = VALID_PLAN.replace("2026-10-14", "2026-02-31");
        const { ai } = build([reply(impossible), reply(VALID_PLAN)]);
        const result = await ai.generateStudyPlan(PLAN_INPUT);
        assert.equal(result.ok, true);
        assert.equal(result.data.sessions[0].date, "2026-10-14");
    });

    test("a valid but empty plan is asked for again and then reported as insufficient", async () => {
        const { ai, calls } = build([reply(JSON.stringify({ sessions: [] }))]);
        const result = await ai.generateStudyPlan(PLAN_INPUT);
        assert.deepEqual(result, { ok: false, error: "insufficient_extraction" });
        assert.equal(calls.length, 2);
    });

    test("an empty or missing answer is reported, not thrown", async () => {
        for (const empty of [reply(""), reply(null), {}]) {
            const { ai } = build([empty]);
            assert.deepEqual(await ai.generateStudyPlan(PLAN_INPUT), { ok: false, error: "empty_response" });
        }
    });

    test("a parse that extracts nothing at all is asked again", async () => {
        const { ai, calls } = build([reply("{}"), reply(JSON.stringify({ clarifyingQuestions: ["Kur fillon?"] }))]);
        const result = await ai.parseNaturalLanguageRequest("hmm", new Date("2026-10-14T10:00:00Z"));
        assert.equal(result.ok, true);
        assert.deepEqual(result.data.clarifyingQuestions, ["Kur fillon?"]);
        assert.match(calls[1].params.messages[3].content, /Nuk nxore asnjë informacion/);
    });
});

describe("P1-1: one deadline for the whole job", () => {
    // A provider call that never answers until it is told to stop, like a stalled connection.
    const stalls = (params, { signal }) =>
        new Promise((resolve, reject) => {
            signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
        });

    test("a stalled provider is cut off at the deadline and no further model is tried", async () => {
        const { ai, calls } = build([stalls], { deadlineMs: 40 });
        const started = Date.now();

        await assert.rejects(ai.generateStudyPlan(PLAN_INPUT), { code: "AI_DEADLINE" });

        assert.equal(calls.length, 1);
        assert.ok(Date.now() - started < 1000);
    });

    test("the deadline also ends a rate-limit wait, and nothing more is sent afterwards", async () => {
        const { client, calls } = scripted([httpError(429)]);
        // Real, abortable sleep: the 3 s wait must end when the 40 ms deadline fires.
        const ai = createAi({ client, models: MODELS, deadlineMs: 40 });
        const started = Date.now();

        await assert.rejects(ai.generateStudyPlan(PLAN_INPUT), { code: "AI_DEADLINE" });

        assert.equal(calls.length, 1);
        assert.ok(Date.now() - started < 1000);
    });

    test("when the caller gives up, the work stops with AI_ABORTED and the provider call receives the abort", async () => {
        const { ai, calls } = build([stalls]);
        const caller = new AbortController();

        const pending = ai.generateStudyPlan(PLAN_INPUT, { signal: caller.signal });
        await new Promise((r) => setTimeout(r, 10));
        caller.abort();

        await assert.rejects(pending, { code: "AI_ABORTED" });
        assert.equal(calls.length, 1);
        assert.equal(calls[0].options.signal.aborted, true);
    });

    test("a caller that has already given up costs no provider call", async () => {
        const { ai, calls } = build([reply(VALID_PLAN)]);
        await assert.rejects(ai.generateStudyPlan(PLAN_INPUT, { signal: AbortSignal.abort() }), { code: "AI_ABORTED" });
        assert.equal(calls.length, 0);
    });

    test("work that finishes in time is not affected by the deadline", async () => {
        const { ai } = build([reply(VALID_PLAN)], { deadlineMs: 5000 });
        assert.equal((await ai.generateStudyPlan(PLAN_INPUT)).ok, true);
    });
});
