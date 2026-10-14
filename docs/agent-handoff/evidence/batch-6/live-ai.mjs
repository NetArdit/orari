/**
 * Batch 6: the two live AI calls Codex authorised, and no more.
 *   one synthetic parse, one short synthetic plan, on one model confirmed free beforehand,
 *   no retry, no fallback to another model, no repair attempt.
 *
 *   node docs/agent-handoff/evidence/batch-6/live-ai.mjs <model-id>
 *
 * It uses the app's own prompts and validation (lib/ai.js) through a client that lets exactly one
 * request through per call and refuses any further one, so the app's retry and repair logic cannot
 * reach the provider. The key is read from .env by Node and is never printed or written.
 * Result: live-ai.json beside this file (no key, no personal data: the text is made up).
 */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import OpenAI from "openai";
import { createAi } from "../../../../lib/ai.js";
import { buildCalendar } from "../../../../lib/time.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..", "..", "..");
const MODEL = process.argv[2];
if (!MODEL || !MODEL.endsWith(":free")) throw new Error("Give one model id ending in :free.");

process.loadEnvFile(path.join(ROOT, ".env"));
if (!process.env.OPENROUTER_API_KEY) throw new Error("No key in .env.");

const real = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: 60_000,
    maxRetries: 0,
    defaultHeaders: { "HTTP-Referer": "http://localhost:3000", "X-Title": "Orari" },
});

const records = [];

/** A client that sends one request and then refuses: whatever the app's logic wants next stays local. */
function oneShot(label) {
    let used = false;
    return {
        chat: {
            completions: {
                create: async (params, options) => {
                    if (used) throw Object.assign(new Error("second request refused by the test"), { status: 0, refusedLocally: true });
                    used = true;
                    const record = { call: label, endpoint: "POST https://openrouter.ai/api/v1/chat/completions", model: params.model, startedAtUtc: new Date().toISOString(), jsonMode: Boolean(params.response_format) };
                    records.push(record);
                    const startedAt = performance.now();
                    try {
                        const completion = await real.chat.completions.create(params, options);
                        record.elapsedMs = Math.round(performance.now() - startedAt);
                        record.httpStatus = 200;
                        record.servedBy = { model: completion.model ?? null, provider: completion.provider ?? null };
                        record.usage = completion.usage ?? null;
                        record.finishReason = completion.choices?.[0]?.finish_reason ?? null;
                        record.answerChars = completion.choices?.[0]?.message?.content?.length ?? 0;
                        return completion;
                    } catch (error) {
                        record.elapsedMs = Math.round(performance.now() - startedAt);
                        record.httpStatus = error?.status ?? null;
                        record.error = String(error?.message ?? error).slice(0, 300);
                        throw error;
                    }
                },
            },
        },
    };
}

const quiet = console.error;
console.error = () => {}; // the app logs raw model output on failure; keep the terminal to our own summary

// 1. Parse. Synthetic text in the register a student in Kosovo might write.
const parseText = "Prej nesër deri më 28 tetor dua me mësu Biologji, kapitujt 1 deri në 3, se kam provim. Jam e lirë çdo ditë prej orës 17 deri në 19. Të dielave nuk mësoj.";
const parseAi = createAi({ client: oneShot("parse"), models: [MODEL], deadlineMs: 70_000, sleep: async () => {} });
let parseResult;
try {
    parseResult = await parseAi.parseNaturalLanguageRequest(parseText, "2026-10-14");
} catch (error) {
    parseResult = { ok: false, error: String(error?.message ?? error).slice(0, 200) };
}

// 2. A short plan: three days, one two-hour window each.
const availability = ["wed", "thu", "fri"].map((day) => ({ day, off: false, windows: [{ start: "17:00", end: "19:00" }] }));
const calendar = buildCalendar("2026-10-14", "2026-10-16", availability, [], []);
const planAi = createAi({ client: oneShot("plan"), models: [MODEL], deadlineMs: 70_000, sleep: async () => {} });
let planResult;
try {
    planResult = await planAi.generateStudyPlan({ subject: "Biologji", goal: "Provimi", planMode: "exam", difficulty: "medium", materialAmount: "Kapitujt 1-3", energy: null, sessionPreferenceMinutes: 60, calendar });
} catch (error) {
    planResult = { ok: false, error: String(error?.message ?? error).slice(0, 200) };
}

console.error = quiet;

const summary = {
    purpose: "Batch 6: two bounded live calls to learn real latency and whether the app's prompts and validation work against a real free model.",
    model: MODEL,
    providerRequestsMade: records.length,
    calls: records,
    parse: {
        inputSummary: "Synthetic, 3 sentences in Kosovo Albanian: subject, date range, daily free window, Sundays off. Today given as 2026-10-14.",
        acceptedByAppValidation: parseResult.ok,
        ...(parseResult.ok
            ? { extracted: { startDate: parseResult.data.startDate, endDate: parseResult.data.endDate, subject: parseResult.data.subject, materialAmount: parseResult.data.materialAmount, planMode: parseResult.data.planMode, availabilityDays: parseResult.data.weeklyAvailability.map((d) => `${d.day}:${d.off ? "off" : d.windows.map((w) => `${w.start}-${w.end}`).join(",")}`), commitments: parseResult.data.commitments.length, questions: parseResult.data.clarifyingQuestions } }
            : { failure: parseResult.error }),
    },
    plan: {
        inputSummary: "Synthetic: Biologji, exam, 3 days (2026-10-14 to 16), one free window 17:00-19:00 per day, preferred session 60 minutes.",
        acceptedByAppValidation: planResult.ok,
        ...(planResult.ok
            ? { sessions: planResult.data.sessions.map((s) => `${s.date} ${s.startTime}-${s.endTime} ${s.type}: ${s.title}`), strategyChars: planResult.data.strategy.length, explanations: planResult.data.explanations.length, warnings: planResult.data.warnings }
            : { failure: planResult.error }),
    },
};

writeFileSync(path.join(HERE, "live-ai.json"), JSON.stringify(summary, null, 2));
console.log(JSON.stringify(summary, null, 2));
