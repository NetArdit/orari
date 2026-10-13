import express from "express";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

import { buildCalendar, fitsInWindow, dateRange, isValidDateStr } from "./lib/time.js";
import { ParseRequestBody, CreatePlanBody, AdjustPlanBody } from "./lib/schema.js";
import { parseNaturalLanguageRequest, generateStudyPlan } from "./lib/ai.js";

dotenv.config();

/* =========================================
   CONFIG
========================================= */

const app = express();
const PORT = process.env.PORT || 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const AI_CONFIGURED = Boolean(process.env.OPENROUTER_API_KEY);

if (!AI_CONFIGURED) {
    // We do NOT exit here - the server should still boot so the frontend
    // loads and can show a clear "AI not configured" message instead of
    // the whole app being unreachable.
    console.error("WARNING: OPENROUTER_API_KEY mungon në .env - funksionet AI do të kthejnë gabim.");
}

/* =========================================
   MIDDLEWARE
========================================= */

app.use(express.json({ limit: "100kb" }));
app.use(express.static(path.join(__dirname, "public")));

function requireAiConfigured(req, res, next) {
    if (!AI_CONFIGURED) {
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
        aiConfigured: AI_CONFIGURED,
    });
});

/* =========================================
   PARSE NATURAL LANGUAGE REQUEST
   text -> structured draft (for confirmation UI)
========================================= */

app.post("/api/parse", requireAiConfigured, async (req, res) => {
    const bodyCheck = ParseRequestBody.safeParse(req.body);

    if (!bodyCheck.success) {
        return res.status(400).json({ error: "Përshkrimi mungon ose është shumë i gjatë/i shkurtër." });
    }

    try {
        const result = await parseNaturalLanguageRequest(bodyCheck.data.text, new Date());

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

/* =========================================
   BUILD CALENDAR (shared by create/adjust)
========================================= */

function buildCalendarOrError(structured, fromDate) {
    const start = fromDate || structured.startDate;

    if (!isValidDateStr(start) || !isValidDateStr(structured.endDate)) {
        return { error: "Datat e planit nuk janë valide." };
    }

    if (dateRange(start, structured.endDate).length === 0) {
        return { error: "Data e fillimit duhet të jetë para datës së mbarimit." };
    }

    if (dateRange(start, structured.endDate).length > 180) {
        return { error: "Periudha e planit është shumë e gjatë (maksimumi ~6 muaj)." };
    }

    const calendar = buildCalendar(
        start,
        structured.endDate,
        structured.weeklyAvailability,
        structured.commitments,
        structured.unavailableDates || []
    );

    return { calendar };
}

/* =========================================
   VALIDATE / SANITIZE AI SESSIONS
   Deterministic safety net: an AI-proposed
   session that falls outside the computed
   free windows is clipped or dropped, never
   trusted blindly.
========================================= */

function sanitizeSessions(sessions, calendar) {
    const kept = [];
    const dropped = [];

    for (const session of sessions) {
        if (fitsInWindow(session.date, session.startTime, session.endTime, calendar)) {
            kept.push(session);
        } else {
            dropped.push(`${session.date} ${session.startTime}-${session.endTime}`);
        }
    }

    return { kept, dropped };
}

function computeStats(sessions) {
    let totalMinutes = 0;
    for (const s of sessions) {
        const [sh, sm] = s.startTime.split(":").map(Number);
        const [eh, em] = s.endTime.split(":").map(Number);
        totalMinutes += eh * 60 + em - (sh * 60 + sm);
    }
    return {
        totalSessions: sessions.length,
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    };
}

/* =========================================
   CREATE STUDY PLAN
========================================= */

app.post("/api/create-plan", requireAiConfigured, async (req, res) => {
    const bodyCheck = CreatePlanBody.safeParse(req.body);

    if (!bodyCheck.success) {
        console.error("[create-plan] validation failed:", bodyCheck.error.issues.slice(0, 5));
        return res.status(400).json({ error: "Na mungojnë disa të dhëna për ta krijuar planin." });
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
            console.error(`[create-plan] dropped ${dropped.length} out-of-window session(s):`, dropped);
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
            warnings: [
                ...result.data.warnings,
                ...(dropped.length > 0 ? ["Disa sesione u rregulluan për t'iu përshtatur kohës së lirë."] : []),
            ],
            stats,
            sessions: kept.map((s, i) => ({ id: `s${i + 1}`, status: "pending", ...s })),
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

app.post("/api/adjust-plan", requireAiConfigured, async (req, res) => {
    const bodyCheck = AdjustPlanBody.safeParse(req.body);

    if (!bodyCheck.success) {
        console.error("[adjust-plan] validation failed:", bodyCheck.error.issues.slice(0, 5));
        return res.status(400).json({ error: "Na mungojnë disa të dhëna për ta rregulluar planin." });
    }

    const { profile, structured, progress } = bodyCheck.data;

    const calendarResult = buildCalendarOrError(structured, progress.today);
    if (calendarResult.error) {
        return res.status(400).json({ error: calendarResult.error });
    }
    const { calendar } = calendarResult;

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
            console.error(`[adjust-plan] dropped ${dropped.length} out-of-window session(s):`, dropped);
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
            warnings: result.data.warnings,
            stats,
            sessions: kept.map((s, i) => ({ id: `a${i + 1}`, status: "pending", ...s })),
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

/* =========================================
   START SERVER
========================================= */

const server = app.listen(PORT, () => {
    console.log(`StudyFlow running at http://localhost:${PORT}`);
    if (!AI_CONFIGURED) {
        console.log("-> AI features are disabled until OPENROUTER_API_KEY is set in .env");
    }
});

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`Porti ${PORT} është duke u përdorur.`);
        process.exit(1);
    }
    console.error("SERVER ERROR:", error);
});

process.on("SIGINT", () => {
    console.log("\nDuke mbyllur StudyFlow...");
    server.close(() => {
        console.log("StudyFlow u mbyll.");
        process.exit(0);
    });
});
