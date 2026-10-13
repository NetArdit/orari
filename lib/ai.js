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
// get deprecated/renamed over time. We try a primary model built for
// quality, and fall back to alternates on rate limits or outages instead
// of failing the whole request.
const DEFAULT_MODELS = [
    "z-ai/glm-5.2:free",
    "google/gemma-4-31b-it:free",
    "dots-studio/dots-3-note-preview:free",
    "liquid/lfm-2.5-2.6b:free",
];

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
            if (signal.aborted) throw lastError || new AiAbortedError();

            try {
                const params = { model, messages, temperature };
                if (useJsonMode) params.response_format = { type: "json_object" };
                return await ctx.getClient().chat.completions.create(params, { signal });
            } catch (err) {
                lastError = err;

                // Out of time, or the caller left: trying the next model would only waste quota.
                if (signal.aborted) throw err;

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
                    "Përgjigjja jote nuk ishte JSON valid. Kthe VETËM objektin JSON të korrigjuar, pa asnjë tekst tjetër, pa ```.",
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
                    "Struktura e JSON nuk përputhet me formatin e kërkuar. Kthe VETËM JSON të korrigjuar sipas formatit origjinal, pa tekst shtesë.",
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
                    "Nuk nxore asnjë informacion të dobishëm nga teksti, edhe pse ai përmban të dhëna konkrete. Rilexoje me kujdes dhe nxirr çdo datë, orar apo detyrim që përmendet.",
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

const PARSE_SYSTEM_PROMPT = `Ti je moduli i StudyFlow që kthen tekst të lirë (shqip/anglisht, çdo dialekt) në JSON të strukturuar për planifikim studimi.

Rregulla:
- Nxirr VETËM çka përmendet ose nënkuptohet qartë. Mos shpik data, orë apo detyrime.
- Ditët e javës: mon,tue,wed,thu,fri,sat,sun.
- Format orësh: HH:MM (24h). Format datash: YYYY-MM-DD.
- "commitments" janë blloqe kohe të zëna (punë, shkollë, gjumë, ushqim, rrugë/komutim, familje, palestër, tjetër) - përfshi edhe kohë rikuperimi/dekompresimi që përdoruesi i përmend shprehimisht (p.sh. "1 orë pushim pas punës").
- "weeklyAvailability": nëse përdoruesi jep një orar studimi PA e lidhur me ditë specifike (p.sh. "jam i lirë 8-10 në mëngjes dhe 20-21:30 në mbrëmje", pa përmendur emra ditësh), apliko atë dritare për TË GJITHA 7 ditët e javës (krijo 7 zëra, mon deri sun, me të njëjtat windows) - PËRVEÇ ditëve që përjashtohen shprehimisht (p.sh. "të dielën nuk studioj" -> atë ditë vendos off:true). Nëse përdoruesi përmend ditë të caktuara me emër (p.sh. "të shtunën jam më i lirë"), përdor vetëm ato dite specifike me orarin e vet. Nëse nuk ka fare informacion orari, lëre bosh.
- KURRË mos llogarit vetë se çfarë dite jave bie një datë specifike (p.sh. mos vendos "24 gusht = e mërkurë") - ky llogaritje bëhet automatikisht nga sistemi. Ti identifikon VETËM emrat e ditëve të javës që përdoruesi i përmend shprehimisht (p.sh. "e shtunë", "e diel"); mos i lidh me data konkrete vetë.
- Nëse mungon diçka KRITIKE (data fillimi/mbarimi, ose çdo lloj disponueshmërie/orari), shto deri në 3 pyetje të shkurtra sqaruese në "clarifyingQuestions". Mos shpik përgjigje.
- Sot është {TODAY} ({WEEKDAY}). Përdore për të kuptuar data relative (p.sh. "javën tjetër").
- Kthe VETËM JSON, pa \`\`\`, pa tekst shtesë, sipas kësaj strukture:

{"startDate":"YYYY-MM-DD"|null,"endDate":"YYYY-MM-DD"|null,"subject":"string"|null,"materialAmount":"string"|null,"goal":"string"|null,"planMode":"exam|new_subject|project|assignment|certification|skill|revision|general"|null,"weeklyAvailability":[{"day":"mon","off":false,"windows":[{"start":"08:00","end":"10:00"}]}],"commitments":[{"label":"string","type":"work|school|commute|meal|sleep|family|gym|other","days":["mon"]|null,"dates":null,"start":"10:00","end":"18:00"}],"sessionPreferenceMinutes":60|null,"energy":{"morning":"high|medium|low"|null,"afternoon":"..."|null,"evening":"..."|null}|null,"difficulty":"easy|medium|hard"|null,"clarifyingQuestions":[]}

Shembull: teksti "jam i lirë 8-10 në mëngjes, të dielën nuk studioj" -> weeklyAvailability ka 7 zëra (mon,tue,wed,thu,fri,sat me windows 08:00-10:00, dhe sun me off:true) - JO vetëm 1-2 ditë të zgjedhura arbitrarisht.`;

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

const PLAN_SYSTEM_PROMPT = `Ti je StudyFlow, planifikues inteligjent studimi. Merr dritaret e lira (të llogaritura tashmë saktësisht) dhe krijon sesione studimi realiste BRENDA tyre.

Parime:
- MOS optimizo për maksimum orësh. Optimizo për një orar që një njeri i vërtetë mund ta ndjekë.
- Çdo sesion duhet të bjerë PLOTËSISHT brenda një dritareje të lirë të dhënë për atë datë (respekto start/end saktësisht ose brenda tyre).
- Mos mbush çdo minutë të lirë - lër kohë të lirë/rikuperimi kur ka kuptim.
- Puno kognitive e vështirë (koncepte të reja) në periudha me energji të lartë; ushtrime/përsëritje kollaj në periudha me energji të ulët (p.sh. mbrëmje pas pune).
- Përshtat llojin e sesionit ("type") sipas natyrës së lëndës:
  programim: learning->practice->revision, projekte periodike;
  matematikë: koncept->shembuj të zgjidhur->ushtrime->probleme të vështira->rishikim gabimesh;
  gjuhë: fjalor/gramatikë/dëgjim/të folur + "recall" (spaced repetition) shpesh;
  histori/biologji: lexim->recall aktiv->pyetje->revision;
  tjetër: përshtate logjikisht.
- Llojet e lejuara: learning, practice, recall, revision, assessment, project.
- Shpërndaj materialin logjikisht nëpër ditët e disponueshme, jo në mënyrë të njëtrajtshme të detyruar.
- Shto rishikim (revision/recall) periodik, jo vetëm material të ri.
- "explanations": 2-4 fjali shumë të shkurtra shpjegim pse i vendose kështu vendimet kryesore (shqip, biseduese, jo teknike).
- "warnings": përmend nëse koha e disponueshme është shumë pak për qëllimin, ose ndonjë kompromis i rëndësishëm.
- Të gjitha tekstet e dukshme për përdoruesin (title, goal, tasks, strategy, explanations) në shqip.
- Kthe VETËM JSON, pa \`\`\`, sipas strukturës:

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

export const { parseNaturalLanguageRequest, generateStudyPlan } = createAi();

export { extractJsonPayload, DEFAULT_MODELS, DEFAULT_DEADLINE_MS };
