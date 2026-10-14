import { z } from "zod";
import { isValidDateStr, isValidTimeZone } from "./time.js";

/* ==========================================
   SHARED PRIMITIVES
========================================== */

// Upper bounds on lists. Generous for a real timetable, small enough that a
// request cannot make the calendar arithmetic or the AI prompt arbitrarily large.
export const LIMITS = {
    windowsPerDay: 8,
    commitments: 40,
    datesPerCommitment: 60,
    unavailableDates: 180, // the longest plan allowed
    sessions: 600, // what the AI may return for one plan
};

// Messages meant for the person filling in the form. Everything else gets a
// generic Albanian message in fieldErrors() below; zod's English never leaves the server.
const MESSAGES = {
    date: "Data nuk është e vlefshme.",
    time: "Shkruaje orën në formatin 08:30.",
    windowOrder: "Koha e përfundimit duhet të jetë pas kohës së fillimit.",
    timeZone: "Zona kohore nuk është e vlefshme.",
};

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, MESSAGES.date).refine(isValidDateStr, MESSAGES.date);

// "9:00" is what people type; it is accepted and stored as "09:00".
const timeStr = z
    .string()
    .trim()
    .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, MESSAGES.time)
    .transform((t) => t.padStart(5, "0"));
const weekday = z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const energyLevel = z.enum(["high", "medium", "low"]);
const difficultyLevel = z.enum(["easy", "medium", "hard"]);

const planMode = z.enum([
    "exam",
    "new_subject",
    "project",
    "assignment",
    "certification",
    "skill",
    "revision",
    "general",
]);

/* ==========================================
   NATURAL LANGUAGE PARSE OUTPUT
   (what the AI extracts from free text)
========================================== */

// A free window lies within one day, so it must end after it starts.
// (Commitments are different: a night shift may cross midnight.)
const TimeWindowSchema = z
    .object({
        start: timeStr,
        end: timeStr,
    })
    .refine((w) => w.end > w.start, { message: MESSAGES.windowOrder, path: ["end"] });

const DayAvailabilitySchema = z.object({
    day: weekday,
    off: z.boolean().default(false),
    windows: z.array(TimeWindowSchema).max(LIMITS.windowsPerDay).default([]),
});

const CommitmentSchema = z.object({
    label: z.string().min(1).max(60),
    type: z
        .enum(["work", "school", "commute", "meal", "sleep", "family", "gym", "other"])
        .default("other"),
    days: z.array(weekday).max(7).nullable().default(null),
    dates: z.array(dateStr).max(LIMITS.datesPerCommitment).nullable().default(null),
    start: timeStr,
    end: timeStr,
});

export const ParsedRequestSchema = z.object({
    startDate: dateStr.nullable().default(null),
    endDate: dateStr.nullable().default(null),
    subject: z.string().max(120).nullable().default(null),
    materialAmount: z.string().max(200).nullable().default(null),
    goal: z.string().max(300).nullable().default(null),
    planMode: planMode.nullable().default(null),
    weeklyAvailability: z.array(DayAvailabilitySchema).max(7).default([]),
    commitments: z.array(CommitmentSchema).max(LIMITS.commitments).default([]),
    sessionPreferenceMinutes: z.number().int().min(10).max(240).nullable().default(null),
    energy: z
        .object({
            morning: energyLevel.nullable().default(null),
            afternoon: energyLevel.nullable().default(null),
            evening: energyLevel.nullable().default(null),
        })
        .nullable()
        .default(null),
    difficulty: difficultyLevel.nullable().default(null),
    clarifyingQuestions: z.array(z.string().max(200)).max(3).default([]),
});

/* ==========================================
   AI STUDY PLAN OUTPUT
========================================== */

const sessionType = z.enum([
    "learning",
    "practice",
    "recall",
    "revision",
    "assessment",
    "project",
]);

const SessionSchema = z.object({
    date: dateStr,
    startTime: timeStr,
    endTime: timeStr,
    type: sessionType,
    title: z.string().min(1).max(120),
    goal: z.string().max(300).default(""),
    tasks: z.array(z.string().max(200)).max(6).default([]),
    material: z.string().max(200).nullable().default(null),
    difficulty: difficultyLevel.default("medium"),
});

export const PlanResponseSchema = z.object({
    strategy: z.string().max(600).default(""),
    explanations: z.array(z.string().max(300)).max(5).default([]),
    sessions: z.array(SessionSchema).max(LIMITS.sessions).default([]),
    warnings: z.array(z.string().max(200)).max(5).default([]),
});

/* ==========================================
   VALIDATION ERRORS -> FIELD DETAILS
   [{ path: "structured.endDate", message }]
   so the form can point at the field.
========================================== */

const OWN_MESSAGES = new Set(Object.values(MESSAGES));
const MAX_FIELD_ERRORS = 10;

function fieldMessage(issue) {
    if (OWN_MESSAGES.has(issue.message)) return issue.message;
    if (issue.code === "invalid_type" && issue.received === "undefined") return "Plotëso këtë fushë.";
    if (issue.code === "too_big") return "Vlera e dhënë e kalon kufirin e lejuar.";
    if (issue.code === "too_small") return "Vlera është nën minimumin e lejuar.";
    return "Vlera nuk është e vlefshme.";
}

export function fieldErrors(zodError) {
    return zodError.issues.slice(0, MAX_FIELD_ERRORS).map((issue) => ({
        path: issue.path.join("."),
        message: fieldMessage(issue),
    }));
}

/* ==========================================
   ERROR CODES
   The `code` of every error body. Programs
   decide by these; the Albanian `error`
   text is only for showing to people and
   may be reworded at any time.
========================================== */

export const ERROR_CODES = /** @type {const} */ ([
    "VALIDATION", // 400: the request body failed validation; `fields` says where
    "BAD_JSON", // 400
    "BAD_REQUEST", // 400: an address or request Express could not read
    "BODY_TOO_LARGE", // 413
    "INVALID_DATES", // 400
    "DATES_REVERSED", // 400: start after end
    "PERIOD_TOO_LONG", // 400: more than 180 days
    "NO_FREE_TIME", // 400: nothing left to plan in
    "PLAN_FINISHED", // 400: adjust after the plan's end date
    "RATE_LIMITED", // 429: this client sent too many requests
    "SERVER_BUSY", // 503: too many AI requests in flight; Retry-After says when
    "AI_NOT_CONFIGURED", // 503: no API key on the server
    "PROVIDER_RATE_LIMITED", // 503: the AI provider's own limit
    "PROVIDER_UNAVAILABLE", // 503: the model needs credits or is gone
    "AI_TIMEOUT", // 504: the whole-job deadline passed
    "AI_REJECTED_REQUEST", // 502
    "AI_UNUSABLE_ANSWER", // 502: not JSON, wrong shape, or empty
    "AI_NO_USABLE_SESSIONS", // 502: every proposed session was removed
    "AI_FAILED", // 502: anything else from the provider
    "NOT_FOUND", // 404
    "INTERNAL", // 500
]);

/* ==========================================
   INCOMING REQUEST BODIES (from the frontend)
========================================== */

const timeZone = z.string().max(64).refine(isValidTimeZone, MESSAGES.timeZone);

// "Today" belongs to the person, not to the server: at 00:30 in Prishtina the
// server's UTC clock still shows yesterday. Both fields are optional so that
// older clients keep working on the server's clock.
export const ParseRequestBody = z.object({
    text: z.string().min(3).max(2000),
    clientDate: dateStr.optional(),
    timeZone: timeZone.optional(),
});

export const CreatePlanBody = z.object({
    profile: z.object({
        name: z.string().min(1).max(80),
        educationLevel: z.string().max(40).nullable().optional(),
    }),
    structured: z.object({
        startDate: dateStr,
        endDate: dateStr,
        subject: z.string().min(1).max(120),
        materialAmount: z.string().max(200).nullable().optional(),
        goal: z.string().max(300).nullable().optional(),
        planMode: planMode.default("general"),
        weeklyAvailability: z.array(DayAvailabilitySchema).max(7).default([]),
        commitments: z.array(CommitmentSchema).max(LIMITS.commitments).default([]),
        unavailableDates: z.array(dateStr).max(LIMITS.unavailableDates).default([]),
        sessionPreferenceMinutes: z.number().int().min(10).max(240).nullable().optional(),
        energy: z
            .object({
                morning: energyLevel.nullable().optional(),
                afternoon: energyLevel.nullable().optional(),
                evening: energyLevel.nullable().optional(),
            })
            .nullable()
            .optional(),
        difficulty: difficultyLevel.default("medium"),
    }),
});

export const AdjustPlanBody = CreatePlanBody.extend({
    progress: z.object({
        today: dateStr,
        completedSessionSummaries: z.array(z.string().max(200)).max(50).default([]),
        missedSessionSummaries: z.array(z.string().max(200)).max(50).default([]),
        remainingMaterialNote: z.string().max(400).nullable().optional(),
    }),
});
