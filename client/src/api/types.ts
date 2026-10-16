/**
 * The shapes the server accepts and returns, taken from the server's own zod schemas so the two cannot
 * drift apart. Type-only: nothing from lib/ is bundled into the client.
 */
import type { z } from "zod";
import type * as schema from "../../../lib/schema.js";

/** What the client sends (before the server fills in defaults). */
export type ParseRequest = z.input<typeof schema.ParseRequestBody>;
export type CreatePlanRequest = z.input<typeof schema.CreatePlanBody>;
export type AdjustPlanRequest = z.input<typeof schema.AdjustPlanBody>;

/** The plan inputs as the server stores and echoes them (defaults applied, times zero-padded). */
export type PlanInputs = z.output<typeof schema.CreatePlanBody>["structured"];

/** What the AI read from a free-text description. */
export type ParsedDescription = z.output<typeof schema.ParsedRequestSchema>;

type AiPlan = z.output<typeof schema.PlanResponseSchema>;
export type SessionKind = AiPlan["sessions"][number]["type"];

/** A session as the server returns it: always pending, with an id unique for the life of the plan. */
export type PlannedSession = AiPlan["sessions"][number] & { id: string; status: "pending" };

export interface PlanStats {
    totalSessions: number;
    totalMinutes: number;
    totalHours: number;
}

/** The answer of /api/create-plan and /api/adjust-plan. */
export interface PlanAnswer {
    profile: { name: string };
    subject: string;
    startDate: string;
    endDate: string;
    planMode: PlanInputs["planMode"];
    strategy: string;
    explanations: string[];
    warnings: string[];
    stats: PlanStats;
    sessions: PlannedSession[];
}

export interface HealthAnswer {
    success: boolean;
    message: string;
    aiConfigured: boolean;
}

export interface AccountUser {
    id: string;
    email: string;
    name: string;
    emailVerified: boolean;
}

export interface AccountSession {
    id: string;
    device: string;
    createdAt: string;
    lastSeenAt: string;
    current: boolean;
}

/** The stable name of an error, from the server's own list. The English text beside it is only for display. */
export type ErrorCode = (typeof schema.ERROR_CODES)[number];

/** One field the server refused, e.g. { path: "structured.endDate", message: "The date is not valid." }. */
export interface FieldError {
    path: string;
    message: string;
}
