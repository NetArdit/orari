import express from "express";
import path from "path";
import { randomUUID } from "crypto";
import helmet from "helmet";
import { rateLimit as createRateLimit } from "express-rate-limit";
import { fileURLToPath } from "url";

import { ParseRequestBody, CreatePlanBody, AdjustPlanBody, fieldErrors } from "./schema.js";
import { buildCalendarOrError, sanitizeSessions, computeStats } from "./plan.js";

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
 * @param {{windowMs:number, limit:number}} [deps.rateLimit] - AI requests allowed per client address per window
 * @param {number} [deps.maxConcurrentAi] - AI requests the whole server works on at once
 */
export function createApp({
    aiConfigured,
    parseNaturalLanguageRequest,
    generateStudyPlan,
    now = () => new Date(),
    publicDir = path.join(__dirname, "..", "public"),
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
            res.status(429).json({ error: "Ke bërë shumë kërkesa njëra pas tjetrës. Prit pak minuta dhe provo përsëri." });
        },
    });

    let aiInFlight = 0;

    function limitConcurrentAi(req, res, next) {
        if (aiInFlight >= maxConcurrentAi) {
            res.set("Retry-After", "15");
            return res.status(503).json({ error: "Shërbimi është i zënë për momentin. Provo përsëri pas pak." });
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

    /* =========================================
       MIDDLEWARE
    ========================================= */

    app.use(express.json({ limit: "100kb" }));
    app.use(express.static(publicDir));

    function requireAiConfigured(req, res, next) {
        if (!aiConfigured) {
            return res.status(503).json({ error: "AI nuk është konfiguruar ende." });
        }
        next();
    }

    /* =========================================
       ERROR -> SAFE USER MESSAGE
    ========================================= */

    function aiErrorToMessage(error) {
        const status = error?.status;

        if (status === 401) return { code: 503, message: "AI nuk është konfiguruar ende." };
        if (status === 429) return { code: 503, message: "Shërbimi AI ka arritur kufirin e përdorimit. Provo më vonë." };
        if (status === 402) return { code: 503, message: "Modeli AI nuk është i disponueshëm për momentin." };
        if (status === 400) return { code: 502, message: "AI nuk e pranoi kërkesën. Provo të riformulosh." };

        return { code: 502, message: "AI nuk mundi ta krijojë planin. Provo përsëri." };
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
                error: "Përshkrimi mungon ose është shumë i gjatë/i shkurtër.",
                fields: fieldErrors(bodyCheck.error),
            });
        }

        try {
            const result = await parseNaturalLanguageRequest(bodyCheck.data.text, now());

            if (!result.ok) {
                console.error("[parse] failed:", result.error);
                return res.status(502).json({
                    error: "AI gjeneroi një përgjigje të pavlefshme gjatë analizimit. Provo përsëri.",
                });
            }

            return res.json({ parsed: result.data });
        } catch (error) {
            console.error("[parse] AI error:", error?.message || error);
            const { code, message } = aiErrorToMessage(error);
            return res.status(code).json({ error: message });
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
                ? "1 sesion që propozoi AI u hoq sepse nuk përshtatej me kohën tënde të lirë."
                : `${dropped.length} sesione që propozoi AI u hoqën sepse nuk përshtateshin me kohën tënde të lirë.`,
        ];
    }

    const NO_USABLE_SESSIONS = "AI nuk arriti të vendosë asnjë sesion brenda kohës sate të lirë. Provo përsëri.";

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
                error: validationMessage(bodyCheck.error, "Na mungojnë disa të dhëna për ta krijuar planin."),
                fields: fieldErrors(bodyCheck.error),
            });
        }

        const { profile, structured } = bodyCheck.data;

        const calendarResult = buildCalendarOrError(structured);
        if (calendarResult.error) {
            return res.status(400).json({ error: calendarResult.error });
        }
        const { calendar } = calendarResult;

        const capacityMinutes = calendar.reduce((sum, d) => sum + d.totalMinutes, 0);
        if (capacityMinutes === 0) {
            return res.status(400).json({
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
            });

            if (!result.ok) {
                console.error("[create-plan] AI plan generation failed:", result.error);
                return res.status(502).json({
                    error: "AI gjeneroi një plan të paplotë. Provo përsëri.",
                });
            }

            const { kept, dropped } = sanitizeSessions(result.data.sessions, calendar);

            if (dropped.length > 0) {
                console.error(`[create-plan] dropped ${dropped.length} session(s):`, dropped);
            }

            if (kept.length === 0) {
                return res.status(502).json({ error: NO_USABLE_SESSIONS });
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
            console.error("[create-plan] AI error:", error?.message || error);
            const { code, message } = aiErrorToMessage(error);
            return res.status(code).json({ error: message });
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
                error: validationMessage(bodyCheck.error, "Na mungojnë disa të dhëna për ta rregulluar planin."),
                fields: fieldErrors(bodyCheck.error),
            });
        }

        const { profile, structured, progress } = bodyCheck.data;

        if (progress.today > structured.endDate) {
            return res.status(400).json({
                error: "Ky plan ka përfunduar, nuk ka më ditë për t'u rregulluar. Krijo një plan të ri.",
            });
        }

        const calendarResult = buildCalendarOrError(structured, progress.today);
        if (calendarResult.error) {
            return res.status(400).json({ error: calendarResult.error });
        }
        const { calendar } = calendarResult;

        if (calendar.every((day) => day.totalMinutes === 0)) {
            return res.status(400).json({
                error: "Nuk ka mbetur kohë e lirë deri në fund të planit. Krijo një plan të ri me afat më të gjatë ose me më shumë kohë të lirë.",
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
            });

            if (!result.ok) {
                console.error("[adjust-plan] AI plan generation failed:", result.error);
                return res.status(502).json({ error: "AI gjeneroi një plan të paplotë. Provo përsëri." });
            }

            const { kept, dropped } = sanitizeSessions(result.data.sessions, calendar);
            if (dropped.length > 0) {
                console.error(`[adjust-plan] dropped ${dropped.length} session(s):`, dropped);
            }

            if (kept.length === 0) {
                return res.status(502).json({ error: NO_USABLE_SESSIONS });
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
            console.error("[adjust-plan] AI error:", error?.message || error);
            const { code, message } = aiErrorToMessage(error);
            return res.status(code).json({ error: message });
        }
    });

    /* =========================================
       API 404
    ========================================= */

    app.use("/api", (req, res) => {
        res.status(404).json({ error: "API endpoint nuk u gjet." });
    });

    /* =========================================
       GENERIC ERROR HANDLER (never crash)
    ========================================= */

    app.use((err, req, res, next) => {
        console.error("UNHANDLED ERROR:", err?.message || err);

        if (err?.type === "entity.too.large") {
            return res.status(413).json({ error: "Kërkesa është shumë e madhe." });
        }

        if (err?.type === "entity.parse.failed") {
            return res.status(400).json({ error: "Kërkesa nuk është JSON valid." });
        }

        res.status(500).json({ error: "Ndodhi një gabim i papritur në server." });
    });

    return app;
}
