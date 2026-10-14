import express from "express";
import path from "path";
import { existsSync } from "fs";
import { randomUUID } from "crypto";
import helmet from "helmet";
import { rateLimit as createRateLimit } from "express-rate-limit";
import { fileURLToPath } from "url";

import { ParseRequestBody, CreatePlanBody, AdjustPlanBody, fieldErrors } from "./schema.js";
import { buildCalendarOrError, sanitizeSessions, computeStats } from "./plan.js";
import { localDateInZone } from "./time.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Builds the Express app. The two AI functions are passed in so that tests can
 * run every route against a fake instead of a live provider.
 *
 * @param {object} deps
 * @param {boolean} deps.aiConfigured - whether an API key is present
 * @param {Function} deps.parseNaturalLanguageRequest - (text, today) => {ok, data|error}
 * @param {Function} deps.generateStudyPlan - (input) => {ok, data|error}
 * @param {Function} [deps.now] - clock, replaceable in tests
 * @param {string} [deps.publicDir] - folder served as static files
 * @param {string} [deps.clientDir] - build of the new client (client/dist), served at /app when it exists
 * @param {{windowMs:number, limit:number}} [deps.rateLimit] - AI requests allowed per client address per window
 * @param {number} [deps.maxConcurrentAi] - AI requests the whole server works on at once
 */
export function createApp({
    aiConfigured,
    parseNaturalLanguageRequest,
    generateStudyPlan,
    now = () => new Date(),
    publicDir = path.join(__dirname, "..", "public"),
    clientDir = path.join(__dirname, "..", "client", "dist"),
    rateLimit = { windowMs: 10 * 60 * 1000, limit: 30 },
    maxConcurrentAi = 4,
}) {
    const app = express();

    /* =========================================
       SECURITY HEADERS
       The page loads its own script and stylesheet
       plus Google Fonts, and sets some inline
       style attributes. HSTS is left to whatever
       terminates HTTPS in front of this server,
       so that plain http://localhost keeps working.
    ========================================= */

    app.use(
        helmet({
            hsts: false,
            contentSecurityPolicy: {
                useDefaults: false,
                directives: {
                    defaultSrc: ["'self'"],
                    scriptSrc: ["'self'"],
                    styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
                    fontSrc: ["'self'", "https://fonts.gstatic.com"],
                    imgSrc: ["'self'", "data:"],
                    connectSrc: ["'self'"],
                    objectSrc: ["'none'"],
                    baseUri: ["'self'"],
                    formAction: ["'self'"],
                    frameAncestors: ["'none'"],
                },
            },
        })
    );

    /* =========================================
       PROTECTING THE SHARED AI QUOTA
       Every visitor spends the same free allowance,
       so one client may not take it all. Counters
       live in this process: they reset on restart
       and are not shared between several instances.
       Behind a reverse proxy, Express "trust proxy"
       must be set or all visitors count as one.
    ========================================= */

    const aiRateLimit = createRateLimit({
        windowMs: rateLimit.windowMs,
        limit: rateLimit.limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({ code: "RATE_LIMITED", error: "Ke bërë shumë kërkesa njëra pas tjetrës. Prit pak minuta dhe provo përsëri." });
        },
    });

    let aiInFlight = 0;

    function limitConcurrentAi(req, res, next) {
        if (aiInFlight >= maxConcurrentAi) {
            res.set("Retry-After", "15");
            return res.status(503).json({ code: "SERVER_BUSY", error: "Shërbimi është i zënë për momentin. Provo përsëri pas pak." });
        }

        aiInFlight++;
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            aiInFlight--;
        };
        // "finish" when the answer was sent, "close" when the client went away first.
        res.on("finish", release);
        res.on("close", release);
        next();
    }

    const aiRoute = [requireAiConfigured, aiRateLimit, limitConcurrentAi];

    // If the browser gives up (tab closed, request cancelled), the AI work stops with it.
    function signalForRequest(res) {
        const controller = new AbortController();
        res.on("close", () => {
            if (!res.writableEnded) controller.abort();
        });
        return controller.signal;
    }

    // Answers with a safe message, or not at all when nobody is listening any more.
    function sendAiError(res, tag, error) {
        if (error?.code === "AI_ABORTED") return;
        console.error(`[${tag}] AI error:`, error?.message || error);
        const { code, errorCode, message } = aiErrorToMessage(error);
        return res.status(code).json({ code: errorCode, error: message });
    }

    /* =========================================
       MIDDLEWARE
    ========================================= */

    app.use(express.json({ limit: "100kb" }));
    app.use(express.static(publicDir));

    /* =========================================
       THE NEW CLIENT, BESIDE THE OLD PAGE
       While both exist, the old page stays at /
       and the build of client/ is served at /app.
       The client does its own routing, so every
       address under /app gets its index.html,
       except files that should exist and do not.
    ========================================= */

    const clientIndex = path.join(clientDir, "index.html");

    if (existsSync(clientIndex)) {
        // File names under assets/ carry a hash of their content, so they can be cached for good.
        app.use("/app/assets", express.static(path.join(clientDir, "assets"), { immutable: true, maxAge: "1y" }));
        app.use("/app/assets", (req, res) => res.status(404).type("text/plain").send("Not found"));
        app.use("/app", express.static(clientDir, { index: false }));
        app.get(["/app", "/app/{*path}"], (req, res) => {
            res.set("Cache-Control", "no-cache");
            res.sendFile(clientIndex);
        });
    }

    function requireAiConfigured(req, res, next) {
        if (!aiConfigured) {
            return res.status(503).json({ code: "AI_NOT_CONFIGURED", error: "AI nuk është konfiguruar ende." });
        }
        next();
    }

    /* =========================================
       Every error body is { code, error }: `code` is a stable
       name for programs (ERROR_CODES in lib/schema.js),
       `error` an Albanian sentence for people.
    ========================================= */

    /* =========================================
       ERROR -> SAFE USER MESSAGE
    ========================================= */

    function aiErrorToMessage(error) {
        const status = error?.status;

        if (error?.code === "AI_DEADLINE") return { code: 504, errorCode: "AI_TIMEOUT", message: "AI po vonon më shumë se zakonisht. Provo përsëri pas pak." };
        if (status === 401) return { code: 503, errorCode: "AI_NOT_CONFIGURED", message: "AI nuk është konfiguruar ende." };
        if (status === 429) return { code: 503, errorCode: "PROVIDER_RATE_LIMITED", message: "Shërbimi AI ka arritur kufirin e përdorimit. Provo më vonë." };
        if (status === 402) return { code: 503, errorCode: "PROVIDER_UNAVAILABLE", message: "Modeli AI nuk është i disponueshëm për momentin." };
        if (status === 400) return { code: 502, errorCode: "AI_REJECTED_REQUEST", message: "AI nuk e pranoi kërkesën. Provo të riformulosh." };

        return { code: 502, errorCode: "AI_FAILED", message: "AI nuk mundi ta krijojë planin. Provo përsëri." };
    }

    /* =========================================
       HEALTH CHECK
    ========================================= */

    app.get("/api/health", (req, res) => {
        res.json({
            success: true,
            message: "StudyFlow server is running.",
            aiConfigured: aiConfigured,
        });
    });

    /* =========================================
       PARSE NATURAL LANGUAGE REQUEST
       text -> structured draft (for confirmation UI)
    ========================================= */

    app.post("/api/parse", aiRoute, async (req, res) => {
        const bodyCheck = ParseRequestBody.safeParse(req.body);

        if (!bodyCheck.success) {
            return res.status(400).json({
                code: "VALIDATION",
                error: "Përshkrimi mungon ose është shumë i gjatë/i shkurtër.",
                fields: fieldErrors(bodyCheck.error),
            });
        }

        try {
            // The person's own date if the client sent it; otherwise today in their
            // time zone; otherwise the server's clock, as before.
            const { text, clientDate, timeZone } = bodyCheck.data;
            const today = clientDate ?? (timeZone ? localDateInZone(timeZone, now()) : now());

            const result = await parseNaturalLanguageRequest(text, today, { signal: signalForRequest(res) });

            if (!result.ok) {
                console.error("[parse] failed:", result.error);
                return res.status(502).json({
                    code: "AI_UNUSABLE_ANSWER",
                    error: "AI gjeneroi një përgjigje të pavlefshme gjatë analizimit. Provo përsëri.",
                });
            }

            return res.json({ parsed: result.data });
        } catch (error) {
            return sendAiError(res, "parse", error);
        }
    });

    // Session ids must stay unique for the whole life of a plan: the client keeps
    // old sessions when a plan is adjusted, so a counter restarted per request would collide.
    function withIds(sessions) {
        return sessions.map((s) => ({ id: randomUUID(), status: "pending", ...s }));
    }

    // Told to the learner whenever sessions proposed by the AI were removed.
    function droppedWarning(dropped) {
        if (dropped.length === 0) return [];
        return [
            dropped.length === 1
                ? "1 seancë e propozuar nga AI u hoq, sepse nuk përshtatej me kohën që ke të lirë."
                : `${dropped.length} seanca të propozuara nga AI u hoqën, sepse nuk përshtateshin me kohën që ke të lirë.`,
        ];
    }

    const NO_USABLE_SESSIONS = "AI nuk arriti të vendoste asnjë seancë në kohën që ke të lirë. Provo përsëri.";

    // A start or end date that is present but not a real date gets the date
    // message rather than the generic "something is missing" one.
    function validationMessage(zodError, fallback) {
        const badDate = zodError.issues.some(
            (issue) => ["startDate", "endDate"].includes(issue.path.at(-1)) && issue.code !== "invalid_type"
        );
        return badDate ? "Datat e planit nuk janë valide." : fallback;
    }

    /* =========================================
       CREATE STUDY PLAN
    ========================================= */

    app.post("/api/create-plan", aiRoute, async (req, res) => {
        const bodyCheck = CreatePlanBody.safeParse(req.body);

        if (!bodyCheck.success) {
            console.error("[create-plan] validation failed:", bodyCheck.error.issues.slice(0, 5));
            return res.status(400).json({
                code: "VALIDATION",
                error: validationMessage(bodyCheck.error, "Na mungojnë disa të dhëna për ta krijuar planin."),
                fields: fieldErrors(bodyCheck.error),
            });
        }

        const { profile, structured } = bodyCheck.data;

        const calendarResult = buildCalendarOrError(structured);
        if (calendarResult.error) {
            return res.status(400).json({ code: calendarResult.code, error: calendarResult.error });
        }
        const { calendar } = calendarResult;

        const capacityMinutes = calendar.reduce((sum, d) => sum + d.totalMinutes, 0);
        if (capacityMinutes === 0) {
            return res.status(400).json({
                code: "NO_FREE_TIME",
                error: "Nuk gjenden dritare kohore të lira në periudhën e zgjedhur. Kontrollo disponueshmërinë dhe angazhimet.",
            });
        }

        try {
            const result = await generateStudyPlan({
                subject: structured.subject,
                goal: structured.goal,
                planMode: structured.planMode,
                difficulty: structured.difficulty,
                materialAmount: structured.materialAmount,
                energy: structured.energy,
                sessionPreferenceMinutes: structured.sessionPreferenceMinutes,
                calendar,
            }, { signal: signalForRequest(res) });

            if (!result.ok) {
                console.error("[create-plan] AI plan generation failed:", result.error);
                return res.status(502).json({
                    code: "AI_UNUSABLE_ANSWER",
                    error: "AI gjeneroi një plan të paplotë. Provo përsëri.",
                });
            }

            const { kept, dropped } = sanitizeSessions(result.data.sessions, calendar);

            if (dropped.length > 0) {
                console.error(`[create-plan] dropped ${dropped.length} session(s):`, dropped);
            }

            if (kept.length === 0) {
                return res.status(502).json({ code: "AI_NO_USABLE_SESSIONS", error: NO_USABLE_SESSIONS });
            }

            const stats = computeStats(kept);

            return res.json({
                profile: { name: profile.name },
                subject: structured.subject,
                startDate: structured.startDate,
                endDate: structured.endDate,
                planMode: structured.planMode,
                strategy: result.data.strategy,
                explanations: result.data.explanations,
                warnings: [...result.data.warnings, ...droppedWarning(dropped)],
                stats,
                sessions: withIds(kept),
            });
        } catch (error) {
            return sendAiError(res, "create-plan", error);
        }
    });

    /* =========================================
       ADJUST PLAN (missed sessions / flex recovery)
    ========================================= */

    app.post("/api/adjust-plan", aiRoute, async (req, res) => {
        const bodyCheck = AdjustPlanBody.safeParse(req.body);

        if (!bodyCheck.success) {
            console.error("[adjust-plan] validation failed:", bodyCheck.error.issues.slice(0, 5));
            return res.status(400).json({
                code: "VALIDATION",
                error: validationMessage(bodyCheck.error, "Na mungojnë disa të dhëna për ta rregulluar planin."),
                fields: fieldErrors(bodyCheck.error),
            });
        }

        const { profile, structured, progress } = bodyCheck.data;

        if (progress.today > structured.endDate) {
            return res.status(400).json({
                code: "PLAN_FINISHED",
                error: "Ky plan ka përfunduar dhe nuk ka më ditë për ta rregulluar. Krijo një plan të ri.",
            });
        }

        const calendarResult = buildCalendarOrError(structured, progress.today);
        if (calendarResult.error) {
            return res.status(400).json({ code: calendarResult.code, error: calendarResult.error });
        }
        const { calendar } = calendarResult;

        if (calendar.every((day) => day.totalMinutes === 0)) {
            return res.status(400).json({
                code: "NO_FREE_TIME",
                error: "Nuk ka mbetur kohë e lirë deri në fund të planit. Zgjate afatin ose shto më shumë kohë të lirë.",
            });
        }

        try {
            const result = await generateStudyPlan({
                subject: structured.subject,
                goal: structured.goal,
                planMode: structured.planMode,
                difficulty: structured.difficulty,
                materialAmount: structured.materialAmount,
                energy: structured.energy,
                sessionPreferenceMinutes: structured.sessionPreferenceMinutes,
                calendar,
                adaptation: {
                    completed: progress.completedSessionSummaries,
                    missed: progress.missedSessionSummaries,
                    remainingMaterialNote: progress.remainingMaterialNote || null,
                    instruction:
                        "Rishpërndaj vetëm materialin e mbetur. Mos e mbingarko përdoruesin për t'u zëvendësuar seancat e humbura menjëherë - përdor ditë buffer/fleksibël kur ka kuptim dhe shpjego shkurt rregullimin.",
                },
            }, { signal: signalForRequest(res) });

            if (!result.ok) {
                console.error("[adjust-plan] AI plan generation failed:", result.error);
                return res.status(502).json({ code: "AI_UNUSABLE_ANSWER", error: "AI gjeneroi një plan të paplotë. Provo përsëri." });
            }

            const { kept, dropped } = sanitizeSessions(result.data.sessions, calendar);
            if (dropped.length > 0) {
                console.error(`[adjust-plan] dropped ${dropped.length} session(s):`, dropped);
            }

            if (kept.length === 0) {
                return res.status(502).json({ code: "AI_NO_USABLE_SESSIONS", error: NO_USABLE_SESSIONS });
            }

            const stats = computeStats(kept);

            return res.json({
                profile: { name: profile.name },
                subject: structured.subject,
                startDate: progress.today,
                endDate: structured.endDate,
                planMode: structured.planMode,
                strategy: result.data.strategy,
                explanations: result.data.explanations,
                warnings: [...result.data.warnings, ...droppedWarning(dropped)],
                stats,
                sessions: withIds(kept),
            });
        } catch (error) {
            return sendAiError(res, "adjust-plan", error);
        }
    });

    /* =========================================
       API 404
    ========================================= */

    app.use("/api", (req, res) => {
        res.status(404).json({ code: "NOT_FOUND", error: "API endpoint nuk u gjet." });
    });

    /* =========================================
       GENERIC ERROR HANDLER (never crash)
    ========================================= */

    app.use((err, req, res, next) => {
        console.error("UNHANDLED ERROR:", err?.message || err);

        if (err?.type === "entity.too.large") {
            return res.status(413).json({ code: "BODY_TOO_LARGE", error: "Kërkesa është shumë e madhe." });
        }

        if (err?.type === "entity.parse.failed") {
            return res.status(400).json({ code: "BAD_JSON", error: "Kërkesa nuk është JSON valid." });
        }

        // A request Express itself refused (for example an address with a broken %-escape) is the
        // sender's mistake, not a server failure.
        if (err?.status === 400) {
            return res.status(400).json({ code: "BAD_REQUEST", error: "Kërkesa nuk është e vlefshme." });
        }

        res.status(500).json({ code: "INTERNAL", error: "Ndodhi një gabim i papritur në server." });
    });

    return app;
}
