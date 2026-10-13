import { z } from "zod";

/* ==========================================
   SHARED PRIMITIVES
========================================== */

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const timeStr = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
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

const TimeWindowSchema = z.object({
    start: timeStr,
    end: timeStr,
});

const DayAvailabilitySchema = z.object({
    day: weekday,
    off: z.boolean().default(false),
    windows: z.array(TimeWindowSchema).default([]),
});

const CommitmentSchema = z.object({
    label: z.string().min(1).max(60),
    type: z
        .enum(["work", "school", "commute", "meal", "sleep", "family", "gym", "other"])
        .default("other"),
    days: z.array(weekday).nullable().default(null),
    dates: z.array(dateStr).nullable().default(null),
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
    weeklyAvailability: z.array(DayAvailabilitySchema).default([]),
    commitments: z.array(CommitmentSchema).default([]),
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
    sessions: z.array(SessionSchema).default([]),
    warnings: z.array(z.string().max(200)).max(5).default([]),
});

/* ==========================================
   INCOMING REQUEST BODIES (from the frontend)
========================================== */

export const ParseRequestBody = z.object({
    text: z.string().min(3).max(2000),
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
        weeklyAvailability: z.array(DayAvailabilitySchema).default([]),
        commitments: z.array(CommitmentSchema).default([]),
        unavailableDates: z.array(dateStr).default([]),
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
