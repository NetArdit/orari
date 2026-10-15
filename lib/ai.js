import OpenAI from "openai";
import { ParsedRequestSchema, PlanResponseSchema } from "./schema.js";
import { weekdayOf } from "./time.js";

/* ==========================================
   AI CLIENT (OpenRouter, OpenAI-compatible)
========================================== */

let defaultClient = null;

function getDefaultClient() {
    if (!defaultClient) {
        defaultClient = new OpenAI({
            apiKey: process.env.OPENROUTER_API_KEY,
            baseURL: "https://openrouter.ai/api/v1",
            timeout: 25000, // a stalled free-tier provider must not hang the request forever
            maxRetries: 0, // we control retries/fallback ourselves
            defaultHeaders: {
                "HTTP-Referer": "http://localhost:3000",
                "X-Title": "StudyFlow",
            },
        });
    }
    return defaultClient;
}

// Free OpenRouter models sit on a shared, often-congested pool and models
// get deprecated and renamed over time: "z-ai/glm-5.2:free", the old primary
// of this list, was no longer on OpenRouter's public list on 2026-10-14. The
// list is therefore configuration (OPENROUTER_MODELS) and these are only the
// defaults. Models are tried in order, falling back on rate limits or outages
// instead of failing the whole request.
const DEFAULT_MODELS = [
    "google/gemma-4-31b-it:free",
    "dots-studio/dots-3-note-preview:free",
    "liquid/lfm-2.5-2.6b:free",
];

const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*:free$/;
const MAX_MODELS = 8;

/**
 * The models to use, from the OPENROUTER_MODELS setting (comma-separated) or the defaults.
 * Only the SHAPE is checked, locally, so that starting the server never depends on OpenRouter
 * being reachable. Every id must end in ":free": there is no paid fallback.
 * Throws an Error with a message fit to print when the setting is unusable.
 */
export function resolveModels(setting) {
    if (setting === undefined || setting.trim() === "") return [...DEFAULT_MODELS];

    const ids = setting.split(",").map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) throw new Error("OPENROUTER_MODELS is set but holds no model id.");
    if (ids.length > MAX_MODELS) throw new Error(`OPENROUTER_MODELS lists ${ids.length} models; at most ${MAX_MODELS} are allowed.`);

    for (const id of ids) {
        if (!id.endsWith(":free")) throw new Error(`OPENROUTER_MODELS: "${id}" is not a free model (its id must end in :free). Paid models are not allowed.`);
        if (!MODEL_ID.test(id)) throw new Error(`OPENROUTER_MODELS: "${id}" is not a valid model id (expected vendor/name:free).`);
    }
    if (new Set(ids).size !== ids.length) throw new Error("OPENROUTER_MODELS lists the same model twice.");
    return ids;
}

/* Which provider answers. OpenRouter is the default (free-only models, ids ending in ":free"). Groq is the
   alternative: an OpenAI-compatible API with a free tier that needs no card. Both speak the same protocol, so
   only the address, the key and the model list differ. */
const GROQ_DEFAULT_MODELS = ["openai/gpt-oss-120b", "openai/gpt-oss-20b", "qwen/qwen3.8-27b"];
const GROQ_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/-]{1,80}$/;

export function resolveProvider(env = process.env) {
    const name = (env.AI_PROVIDER || "openrouter").toLowerCase();
    if (name === "openrouter") {
        return { name, apiKey: env.OPENROUTER_API_KEY, baseURL: "https://openrouter.ai/api/v1", models: resolveModels(env.OPENROUTER_MODELS), headers: { "HTTP-Referer": "http://localhost:3000", "X-Title": "Orari" }, keyName: "OPENROUTER_API_KEY" };
    }
    if (name === "groq") {
        const ids = env.GROQ_MODELS ? env.GROQ_MODELS.split(",").map((m) => m.trim()).filter(Boolean) : GROQ_DEFAULT_MODELS;
        if (ids.length === 0 || ids.length > MAX_MODELS) throw new Error("GROQ_MODELS must list between 1 and " + MAX_MODELS + " model ids.");
        for (const id of ids) if (!GROQ_MODEL_ID.test(id)) throw new Error('GROQ_MODELS: "' + id + '" is not a valid model id.');
        if (new Set(ids).size !== ids.length) throw new Error("GROQ_MODELS lists the same model twice.");
        return { name, apiKey: env.GROQ_API_KEY, baseURL: "https://api.groq.com/openai/v1", models: ids, headers: {}, keyName: "GROQ_API_KEY" };
    }
    throw new Error('AI_PROVIDER must be "openrouter" or "groq".');
}

export function createProviderClient(provider) {
    return new OpenAI({ apiKey: provider.apiKey, baseURL: provider.baseURL, timeout: 25000, maxRetries: 0, defaultHeaders: provider.headers });
}

// One request walks several models with a 25 s timeout each and may do it
// twice, which adds up to minutes. Nobody waits that long: the whole job gets
// one deadline, after which it stops and the caller is told.
const DEFAULT_DEADLINE_MS = 75_000;

export class AiDeadlineError extends Error {
    constructor() {
        super("ai_deadline_exceeded");
        this.code = "AI_DEADLINE";
    }
}

// The caller gave up (for example the browser tab was closed).
export class AiAbortedError extends Error {
    constructor() {
        super("ai_request_aborted");
        this.code = "AI_ABORTED";
    }
}

// Waits, but returns at once if the signal fires.
function sleep(ms, signal) {
    return new Promise((resolve) => {
        if (signal?.aborted) return resolve();
        const timer = setTimeout(done, ms);
        function done() {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            resolve();
        }
        signal?.addEventListener("abort", done, { once: true });
    });
}

function retryDelayMs(err) {
    const seconds = err?.error?.metadata?.retry_after_seconds;
    if (Number.isFinite(seconds)) return Math.min(seconds, 5) * 1000;
    return 3000;
}

/**
 * Runs one chat completion, walking the model fallback list on rate
 * limits (429) or provider outages (5xx). Returns the raw completion.
 * Each model gets one short retry on a rate limit, then we move on -
 * with 3 free models in rotation, spreading attempts wide beats
 * hammering one congested model twice.
 */
async function chatCompletionWithFallback(ctx, messages, { temperature, useJsonMode, signal }) {
    let lastError;

    for (const model of ctx.models) {
        for (let retry = 0; retry < 2; retry++) {
            // Out of time, or the caller left: trying another model would only waste quota.
            if (signal.aborted) throw lastError || new AiAbortedError();

            try {
                const params = { model, messages, temperature };
                if (useJsonMode) params.response_format = { type: "json_object" };
                return await ctx.getClient().chat.completions.create(params, { signal });
            } catch (err) {
                lastError = err;

                if (useJsonMode && err?.status === 400) {
                    // This provider likely rejects response_format - retry once, same model, without it.
                    useJsonMode = false;
                    continue;
                }

                if (err?.status === 429 && retry === 0) {
                    console.error(`[AI] ${model} rate-limited, one short retry...`);
                    await ctx.sleep(retryDelayMs(err), signal);
                    continue;
                }

                if (err?.status === 401) {
                    // Invalid/missing API key - every model will fail the same way.
                    throw err;
                }

                // Anything else - 429 (still), 402 (model needs credits), 5xx, 404 (deprecated
                // model), timeout, network error - this model is a dead end, try the next one.
                console.error(`[AI] ${model} unavailable (${err?.status || err?.code || err?.message}), trying next model...`);
                break;
            }
        }
    }

    throw lastError;
}

/* ==========================================
   SAFE JSON EXTRACTION
   Never trust raw model output. Handles:
   - markdown fences
   - text before/after the JSON
   - empty / truncated responses
========================================== */

function extractJsonPayload(raw) {
    if (!raw || typeof raw !== "string") {
        return { ok: false, error: "empty_response" };
    }

    let content = raw.trim();

    content = content
        .replace(/^```json/i, "")
        .replace(/^```/i, "")
        .replace(/```$/i, "")
        .trim();

    const firstBrace = content.indexOf("{");
    const lastBrace = content.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return { ok: false, error: "no_json_object" };
    }

    content = content.substring(firstBrace, lastBrace + 1);

    try {
        const parsed = JSON.parse(content);
        return { ok: true, data: parsed };
    } catch (err) {
        return { ok: false, error: "malformed_json", raw: content };
    }
}

/**
 * Calls the model, extracts JSON safely, validates against a Zod schema,
 * and retries once with a repair instruction if anything fails.
 */
async function callForJson(ctx, { system, user, schema, maxRetries = 1, isAcceptable, signal: callerSignal }) {
    const messages = [
        { role: "system", content: system },
        { role: "user", content: user },
    ];

    const deadline = AbortSignal.timeout(ctx.deadlineMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, deadline]) : deadline;
    const stopped = () => (callerSignal?.aborted ? new AiAbortedError() : new AiDeadlineError());

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        if (signal.aborted) throw stopped();

        let completion;

        try {
            completion = await chatCompletionWithFallback(ctx, messages, {
                temperature: attempt === 0 ? 0.3 : 0,
                useJsonMode: true,
                signal,
            });
        } catch (err) {
            if (signal.aborted) throw stopped();

            // Every model in the fallback chain failed this round (auth
            // errors excepted - those are re-thrown immediately below).
            if (err?.status === 401) throw err;

            lastError = err?.message || "all_models_failed";
            console.error(`[AI] All models failed on attempt ${attempt}: ${lastError}`);

            if (attempt < maxRetries) continue;
            return { ok: false, error: lastError };
        }

        const raw = completion?.choices?.[0]?.message?.content;
        const extracted = extractJsonPayload(raw);

        if (!extracted.ok) {
            lastError = extracted.error;
            console.error(`[AI] JSON extraction failed (attempt ${attempt}): ${extracted.error}`);
            if (raw) console.error("[AI] raw (truncated):", raw.slice(0, 500));

            messages.push({ role: "assistant", content: raw || "" });
            messages.push({
                role: "user",
                content:
                    "Your answer was not valid JSON. Return ONLY the corrected JSON object, with no other text and no ```.",
            });
            continue;
        }

        const validated = schema.safeParse(extracted.data);

        if (!validated.success) {
            lastError = "schema_validation_failed";
            console.error(`[AI] Schema validation failed (attempt ${attempt}):`, validated.error.issues.slice(0, 5));

            messages.push({ role: "assistant", content: raw });
            messages.push({
                role: "user",
                content:
                    "The JSON structure does not match the requested format. Return ONLY corrected JSON in the original format, with no extra text.",
            });
            continue;
        }

        if (isAcceptable && !isAcceptable(validated.data)) {
            lastError = "insufficient_extraction";
            console.error(`[AI] Response was schema-valid but empty/unusable (attempt ${attempt}).`);

            messages.push({ role: "assistant", content: raw });
            messages.push({
                role: "user",
                content:
                    "You extracted no useful information from the text, even though it contains concrete details. Read it again carefully and extract every date, schedule or commitment that is mentioned.",
            });
            continue;
        }

        return { ok: true, data: validated.data };
    }

    return { ok: false, error: lastError || "unknown_error" };
}

/* ==========================================
   PROMPT: NATURAL LANGUAGE -> STRUCTURED
========================================== */

const PARSE_SYSTEM_PROMPT = `You are the StudyFlow module that turns free text (English, Albanian or any other language, any dialect) into structured JSON for study planning.

Rules:
- Extract ONLY what is stated or clearly implied. Do not invent dates, times or commitments.
- Weekdays: mon,tue,wed,thu,fri,sat,sun.
- Time format: HH:MM (24h). Date format: YYYY-MM-DD.
- "commitments" are busy blocks of time (work, school, sleep, meals, commuting, family, gym, other) - including recovery/decompression time the user explicitly mentions (e.g. "1 hour of rest after work").
- "weeklyAvailability": if the user gives a study schedule that is NOT tied to specific days (e.g. "I am free 8-10 in the morning and 20-21:30 in the evening", with no day names), apply that window to ALL 7 days of the week (create 7 entries, mon to sun, with the same windows) - EXCEPT days that are explicitly excluded (e.g. "I don't study on Sunday" -> set off:true for that day). If the user names specific days (e.g. "I am freer on Saturday"), use only those days with their own hours. If a day is named as free but with no hours, give it an empty "windows" list. If there is no schedule information at all, leave it empty.
- NEVER work out yourself which weekday a specific date falls on (e.g. do not write "24 August = Wednesday") - the system does that automatically. You only identify the weekday names the user mentions explicitly (e.g. "Saturday", "Sunday"); do not tie them to concrete dates yourself.
- If something CRITICAL is missing (start/end date, or any kind of availability/schedule), add up to 3 short clarifying questions to "clarifyingQuestions". Do not invent answers. The questions are written in the user's own language.
- Today is {TODAY} ({WEEKDAY}). Use it to understand relative dates (e.g. "next week").
- Return ONLY JSON, with no code fences and no extra text, in this structure:

{"startDate":"YYYY-MM-DD"|null,"endDate":"YYYY-MM-DD"|null,"subject":"string"|null,"materialAmount":"string"|null,"goal":"string"|null,"planMode":"exam|new_subject|project|assignment|certification|skill|revision|general"|null,"weeklyAvailability":[{"day":"mon","off":false,"windows":[{"start":"08:00","end":"10:00"}]}],"commitments":[{"label":"string","type":"work|school|commute|meal|sleep|family|gym|other","days":["mon"]|null,"dates":null,"start":"10:00","end":"18:00"}],"sessionPreferenceMinutes":60|null,"energy":{"morning":"high|medium|low"|null,"afternoon":"..."|null,"evening":"..."|null}|null,"difficulty":"easy|medium|hard"|null,"clarifyingQuestions":[]}

Example: the text "I am free 8-10 in the morning, I don't study on Sunday" -> weeklyAvailability has 7 entries (mon,tue,wed,thu,fri,sat with windows 08:00-10:00, and sun with off:true) - NOT just 1-2 arbitrarily chosen days.`;

const WEEKDAY_NAMES = {
    mon: "Monday", tue: "Tuesday", wed: "Wednesday", thu: "Thursday", fri: "Friday", sat: "Saturday", sun: "Sunday",
};

async function parseWith(ctx, text, today, { signal } = {}) {
    // `today` is the person's own calendar date ("YYYY-MM-DD") when the client sent
    // one. A Date is the older form: the server's clock, whose UTC date and local
    // weekday can disagree with each other and with the person around midnight.
    const todayIsDateString = typeof today === "string";
    const dateText = todayIsDateString ? today : today.toISOString().slice(0, 10);
    const weekdayName = todayIsDateString
        ? WEEKDAY_NAMES[weekdayOf(today)]
        : today.toLocaleDateString("en-US", { weekday: "long" });
    const system = PARSE_SYSTEM_PROMPT.replace("{TODAY}", dateText).replace("{WEEKDAY}", weekdayName);

    return callForJson(ctx, {
        system,
        user: text,
        schema: ParsedRequestSchema,
        maxRetries: 1,
        signal,
        isAcceptable: (data) =>
            Boolean(
                data.startDate ||
                    data.endDate ||
                    data.subject ||
                    data.commitments.length > 0 ||
                    data.weeklyAvailability.length > 0 ||
                    data.clarifyingQuestions.length > 0
            ),
    });
}

/* ==========================================
   PROMPT: STRUCTURED + CALENDAR -> PLAN
========================================== */

const PLAN_SYSTEM_PROMPT = `You are StudyFlow, an intelligent study planner. You receive the free windows (already calculated exactly) and create realistic study sessions INSIDE them.

Principles:
- Do NOT optimise for maximum hours. Optimise for a schedule that a real person can follow.
- Every session must fall ENTIRELY inside a free window given for that date (respect start/end exactly or stay within them).
- Do not fill every free minute - leave free/recovery time where it makes sense.
- Put hard cognitive work (new concepts) in high-energy periods; easy practice/revision in low-energy periods (e.g. evenings after work).
- Adapt the session type ("type") to the nature of the subject:
  programming: learning->practice->revision, periodic projects;
  mathematics: concept->worked examples->exercises->hard problems->error review;
  languages: vocabulary/grammar/listening/speaking + frequent "recall" (spaced repetition);
  history/biology: reading->active recall->questions->revision;
  other: adapt it logically.
- Allowed types: learning, practice, recall, revision, assessment, project.
- Distribute the material logically across the available days, not in a forced uniform way.
- Add periodic revision (revision/recall), not only new material.
- If the person left things out (how long, how often, what level), decide sensibly yourself as a good teacher would: work out a sensible progression for the subject, an appropriate level (assume a beginner when it is not stated) and sensible session lengths, and say briefly in "explanations" what you assumed.
- "explanations": 2-4 very short sentences explaining why you made the main decisions this way (conversational, not technical).
- "warnings": mention if the available time is too little for the goal, or any important compromise.
- All user-visible texts (title, goal, tasks, strategy, explanations) are written in English.
- Return ONLY JSON, with no code fences, in this structure:

{"strategy":"string","explanations":["..."],"sessions":[{"date":"YYYY-MM-DD","startTime":"HH:MM","endTime":"HH:MM","type":"learning","title":"string","goal":"string","tasks":["..."],"material":"string"|null,"difficulty":"easy|medium|hard"}],"warnings":["..."]}`;

async function planWith(ctx, { subject, goal, planMode, difficulty, materialAmount, energy, sessionPreferenceMinutes, calendar, adaptation }, { signal } = {}) {
    // Compact calendar: only dates that actually have free time.
    const compactCalendar = calendar
        .filter((d) => d.windows.length > 0)
        .map((d) => ({
            date: d.date,
            wd: d.weekday,
            free: d.windows.map((w) => `${w.start}-${w.end}`),
        }));

    const userPayload = {
        subject,
        goal: goal || null,
        planMode,
        difficulty,
        materialAmount: materialAmount || null,
        energy: energy || null,
        sessionPreferenceMinutes: sessionPreferenceMinutes || null,
        calendar: compactCalendar,
        adaptation: adaptation || undefined,
    };

    return callForJson(ctx, {
        system: PLAN_SYSTEM_PROMPT,
        user: JSON.stringify(userPayload),
        schema: PlanResponseSchema,
        maxRetries: 1,
        signal,
        isAcceptable: (data) => data.sessions.length > 0,
    });
}

/* ==========================================
   PUBLIC API
   createAi() exists so tests can pass a fake
   client, a short deadline and a sleep that
   does not wait. The server uses the defaults.
   Both functions take an optional { signal }
   and throw AiDeadlineError / AiAbortedError
   when stopped.
========================================== */

export function createAi({ client, models = DEFAULT_MODELS, deadlineMs = DEFAULT_DEADLINE_MS, sleep: sleepFn = sleep } = {}) {
    const ctx = {
        getClient: client ? () => client : getDefaultClient,
        models,
        deadlineMs,
        sleep: sleepFn,
    };

    return {
        parseNaturalLanguageRequest: (text, today, options) => parseWith(ctx, text, today, options),
        generateStudyPlan: (input, options) => planWith(ctx, input, options),
    };
}


export { extractJsonPayload, DEFAULT_MODELS, DEFAULT_DEADLINE_MS, MAX_MODELS };
