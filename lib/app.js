import express from "express";
import { canonicalJson, createJobStore, runHandlerAsJob } from "./jobs.js";
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
 * @param {ReturnType<import("./accounts/http.js").createAccounts> & { mode: string }} [deps.accounts] - when given, the account and
 *        sync routes are mounted and the AI routes require a signed-in, verified person. Absent: the old open behaviour.
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
    accounts = null,
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
            res.status(429).json({ code: "RATE_LIMITED", error: "You have made too many requests in a row. Wait a few minutes and try again." });
        },
    });

    let aiInFlight = 0;

    function limitConcurrentAi(req, res, next) {
        if (aiInFlight >= maxConcurrentAi) {
            res.set("Retry-After", "15");
            return res.status(503).json({ code: "SERVER_BUSY", error: "The service is busy right now. Try again in a moment." });
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

    // With accounts on, the AI is for signed-in people with a verified address; the check comes first so
    // that an anonymous visitor learns nothing about the server's configuration.
    // Without accounts there is no session to protect, but a page of another site must still not be able to spend
    // the shared AI quota or stop someone's work from a visitor's browser: state-changing requests have to come
    // from this site. Reads pass. A request that is not from a browser (no Origin, no Sec-Fetch-Site) passes.
    function sameOriginGuard(req, res, next) {
        if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
        const forbidden = () => res.status(403).json({ code: "FORBIDDEN_ORIGIN", error: "The request was not accepted from this page." });
        const origin = req.get("origin");
        if (origin !== undefined) {
            try {
                // The whole origin: scheme and host. Behind a TLS-terminating proxy "trust proxy" must be set
                // (as for the rate limit), or req.protocol is the proxy hop's and legitimate calls are refused.
                return new URL(origin).origin === req.protocol + "://" + req.get("host") ? next() : forbidden();
            } catch {
                return forbidden();
            }
        }
        const site = req.get("sec-fetch-site");
        if (site !== undefined && site !== "same-origin" && site !== "none") return forbidden();
        return next();
    }

    // With accounts on this is the signed-in, verified-address check, which starts with its own origin check.
    const callerAccess = accounts ? accounts.requireVerifiedAccount : [sameOriginGuard];
    const aiRoute = [...callerAccess, requireAiConfigured, aiRateLimit, limitConcurrentAi];

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
            return res.status(503).json({ code: "AI_NOT_CONFIGURED", error: "The AI is not configured yet." });
        }
        next();
    }

    /* =========================================
       Every error body is { code, error }: `code` is a stable
       name for programs (ERROR_CODES in lib/schema.js),
       `error` an English sentence for people.
    ========================================= */

    /* =========================================
       ERROR -> SAFE USER MESSAGE
    ========================================= */

    function aiErrorToMessage(error) {
        const status = error?.status;

        if (error?.code === "AI_DEADLINE") return { code: 504, errorCode: "AI_TIMEOUT", message: "The AI is taking longer than usual. Try again in a moment." };
        if (status === 401) return { code: 503, errorCode: "AI_NOT_CONFIGURED", message: "The AI is not configured yet." };
        if (status === 429) return { code: 503, errorCode: "PROVIDER_RATE_LIMITED", message: "The AI service has reached its usage limit. Try again later." };
        if (status === 402) return { code: 503, errorCode: "PROVIDER_UNAVAILABLE", message: "The AI model is not available right now." };
        if (status === 400) return { code: 502, errorCode: "AI_REJECTED_REQUEST", message: "The AI did not accept the request. Try rewording it." };

        return { code: 502, errorCode: "AI_FAILED", message: "The AI could not create the plan. Try again." };
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
       ACCOUNTS (non-production while storage is in memory)
       /api/account/status tells the page whether accounts exist at all and in which mode, so that
       it can say "not available" or "demo, lost on restart" instead of pretending.
    ========================================= */

    app.get("/api/account/status", (req, res) => {
        res.set("Cache-Control", "no-store");
        res.json({ accounts: accounts ? accounts.mode : "off" });
    });
    if (accounts) {
        app.use("/api/account", accounts.accountRouter);
        app.use("/api/sync", accounts.syncRouter);
    }

    /* =========================================
       PARSE NATURAL LANGUAGE REQUEST
       text -> structured draft (for confirmation UI)
    ========================================= */

    app.post("/api/parse", aiRoute, async (req, res) => {
        const bodyCheck = ParseRequestBody.safeParse(req.body);

        if (!bodyCheck.success) {
            return res.status(400).json({
                code: "VALIDATION",
                error: "The description is missing, too long or too short.",
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
                    error: "The AI produced an unusable answer while reading your description. Try again.",
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
                ? "1 session proposed by the AI was removed because it did not fit the time you have free."
                : `${dropped.length} sessions proposed by the AI were removed because they did not fit the time you have free.`,
        ];
    }

    const NO_USABLE_SESSIONS = "The AI could not place any session in the time you have free. Try again.";

    // A start or end date that is present but not a real date gets the date
    // message rather than the generic "something is missing" one.
    function validationMessage(zodError, fallback) {
        const badDate = zodError.issues.some(
            (issue) => ["startDate", "endDate"].includes(issue.path.at(-1)) && issue.code !== "invalid_type"
        );
        return badDate ? "The dates of the plan are not valid." : fallback;
    }

    /* =========================================
       CREATE STUDY PLAN
    ========================================= */

    const createPlanHandler = async (req, res) => {
        const bodyCheck = CreatePlanBody.safeParse(req.body);

        if (!bodyCheck.success) {
            console.error("[create-plan] validation failed:", bodyCheck.error.issues.slice(0, 5));
            return res.status(400).json({
                code: "VALIDATION",
                error: validationMessage(bodyCheck.error, "Some details are missing to create the plan."),
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
                error: "There are no free time windows in the chosen period. Check your availability and commitments.",
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
                    error: "The AI produced an incomplete plan. Try again.",
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
    };
    app.post("/api/create-plan", aiRoute, createPlanHandler);

    /* =========================================
       ADJUST PLAN (missed sessions / flex recovery)
    ========================================= */

    const adjustPlanHandler = async (req, res) => {
        const bodyCheck = AdjustPlanBody.safeParse(req.body);

        if (!bodyCheck.success) {
            console.error("[adjust-plan] validation failed:", bodyCheck.error.issues.slice(0, 5));
            return res.status(400).json({
                code: "VALIDATION",
                error: validationMessage(bodyCheck.error, "Some details are missing to rearrange the plan."),
                fields: fieldErrors(bodyCheck.error),
            });
        }

        const { profile, structured, progress } = bodyCheck.data;

        if (progress.today > structured.endDate) {
            return res.status(400).json({
                code: "PLAN_FINISHED",
                error: "This plan has finished and has no days left to rearrange. Create a new plan.",
            });
        }

        const calendarResult = buildCalendarOrError(structured, progress.today, progress.now);
        if (calendarResult.error) {
            return res.status(400).json({ code: calendarResult.code, error: calendarResult.error });
        }
        const { calendar } = calendarResult;

        if (calendar.every((day) => day.totalMinutes === 0)) {
            return res.status(400).json({
                code: "NO_FREE_TIME",
                error: "There is no free time left until the end of the plan. Extend the deadline or add more free time.",
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
                        "Redistribute only the material that remains. Do not overload the user to make up the missed sessions at once - use buffer/flexible days where it makes sense and briefly explain the rearrangement. Write all user-visible text in English.",
                },
            }, { signal: signalForRequest(res) });

            if (!result.ok) {
                console.error("[adjust-plan] AI plan generation failed:", result.error);
                return res.status(502).json({ code: "AI_UNUSABLE_ANSWER", error: "The AI produced an incomplete plan. Try again." });
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
    };
    app.post("/api/adjust-plan", aiRoute, adjustPlanHandler);

    /* =========================================
       JOBS: the same two operations, started and polled
       In-process and not durable (see lib/jobs.js): a restart loses them. They do not hold a request open, so
       they are not counted by the concurrent-AI limiter; the job store enforces its own limits per owner.
    ========================================= */

    const jobs = createJobStore();
    const jobRoute = [...callerAccess, requireAiConfigured, aiRateLimit];
    const ownerOf = (req) => (req.account?.user?.id ? "u:" + req.account.user.id : "ip:" + req.ip);
    const JOB_KINDS = { "create-plan": createPlanHandler, "adjust-plan": adjustPlanHandler };

    app.post("/api/jobs/:kind", jobRoute, (req, res) => {
        const handler = JOB_KINDS[req.params.kind];
        if (!handler) return res.status(404).json({ code: "NOT_FOUND", error: "Not found." });
        const key = req.get("Idempotency-Key") ?? undefined;
        // Two requests are the same when their validated content is: key order, a missing default or "9:00" against
        // "09:00" must not make a retried start look like a different request. An invalid body falls back to itself.
        const checked = (req.params.kind === "adjust-plan" ? AdjustPlanBody : CreatePlanBody).safeParse(req.body);
        const fingerprint = req.params.kind + "|" + canonicalJson(checked.success ? checked.data : (req.body ?? null));
        const started = jobs.start(ownerOf(req), runHandlerAsJob(handler, { body: req.body, account: req.account }), { key, fingerprint });
        if (!started.ok) {
            if (started.code === "BUSY") return res.status(429).json({ code: "BUSY", error: "A plan is already being created. Wait until it finishes." });
            return res.status(400).json({
                code: "BAD_REQUEST",
                error: started.code === "KEY_REUSED" ? "This repeat key was used for a different request." : "The repeat key is not valid.",
            });
        }
        res.set("Cache-Control", "no-store");
        return res.status(started.existing ? 200 : 202).json({ job: started.job });
    });

    app.get("/api/jobs/:id", callerAccess, (req, res) => {
        res.set("Cache-Control", "no-store");
        const job = jobs.get(ownerOf(req), req.params.id);
        return job ? res.json({ job }) : res.status(404).json({ code: "NOT_FOUND", error: "The task was not found. It may have expired or the server may have restarted." });
    });

    app.post("/api/jobs/:id/cancel", callerAccess, (req, res) => {
        res.set("Cache-Control", "no-store");
        return jobs.cancel(ownerOf(req), req.params.id) ? res.json({ ok: true }) : res.status(404).json({ code: "NOT_FOUND", error: "The task was not found." });
    });

    /* =========================================
       API 404
    ========================================= */

    app.use("/api", (req, res) => {
        res.status(404).json({ code: "NOT_FOUND", error: "API endpoint not found." });
    });

    /* =========================================
       GENERIC ERROR HANDLER (never crash)
    ========================================= */

    app.use((err, req, res, next) => {
        console.error("UNHANDLED ERROR:", err?.message || err);

        if (err?.type === "entity.too.large") {
            return res.status(413).json({ code: "BODY_TOO_LARGE", error: "The request is too large." });
        }

        if (err?.type === "entity.parse.failed") {
            return res.status(400).json({ code: "BAD_JSON", error: "The request is not valid JSON." });
        }

        // A request Express itself refused (for example an address with a broken %-escape) is the
        // sender's mistake, not a server failure.
        if (err?.status === 400) {
            return res.status(400).json({ code: "BAD_REQUEST", error: "The request is not valid." });
        }

        res.status(500).json({ code: "INTERNAL", error: "Something unexpected went wrong on the server." });
    });

    return app;
}
