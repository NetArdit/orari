/**
 * Adjusting a plan after falling behind: what is told to the server, and how its answer is joined
 * with what the person has already done.
 */
import { uuid } from "../ids.ts";
import { byTime, minutesOf, timeOf } from "./clock.ts";
import type { Clock } from "./clock.ts";
import { sessionState } from "./progress.ts";
import type { AdjustPlanRequest, PlanAnswer } from "../api/types.ts";
import type { StoredPlan, StoredProfile, StoredSession } from "../storage/model.ts";

/** The server accepts at most this many lines in each list. */
export const MAX_SUMMARY_LINES = 50;

/**
 * What the AI is told about progress so far, one line per session.
 *  - completed: sessions marked done or partly done, with the mark, so it knows a partial needs finishing.
 *  - missed: sessions the person skipped, and unmarked ones whose day has passed.
 * When there are more than the server accepts, the most recent are kept: they say most about where the person is.
 */
export function progressSummaries(plan: Pick<StoredPlan, "sessions">, clock: Clock): { completed: string[]; missed: string[] } {
    const ordered = [...plan.sessions].sort(byTime);
    const completed: string[] = [];
    const missed: string[] = [];
    for (const session of ordered) {
        const state = sessionState(session, clock);
        if (state === "done" || state === "partial") completed.push(`${session.date} ${session.title} (${session.status})`.slice(0, 200));
        else if (state === "skipped" || state === "missed") missed.push(`${session.date} ${session.title}`.slice(0, 200));
    }
    return { completed: completed.slice(-MAX_SUMMARY_LINES), missed: missed.slice(-MAX_SUMMARY_LINES) };
}

export function buildAdjustRequest(plan: StoredPlan, profile: Pick<StoredProfile, "name" | "educationLevel">, clock: Clock): AdjustPlanRequest {
    const { completed, missed } = progressSummaries(plan, clock);
    return {
        profile: { name: profile.name, educationLevel: profile.educationLevel },
        // The inputs the plan was made from, sent back as they were stored; the server validates them again.
        structured: plan.structured as AdjustPlanRequest["structured"],
        progress: { today: clock.today, now: timeOf(clock.minutes), completedSessionSummaries: completed, missedSessionSummaries: missed, remainingMaterialNote: null },
    };
}

export interface ReplanResult {
    plan: StoredPlan;
    /** Sessions of the old plan that were replaced. */
    replaced: number;
    /** Sessions added from the server's answer. */
    added: number;
    /** New sessions dated today whose time had already ended when the answer arrived. They are kept, and the screen should say so. */
    alreadyOver: number;
}

/**
 * Joins the server's new sessions with the plan.
 *  - Kept: every session dated before today, and every session the person has marked, whatever its date.
 *  - Replaced: sessions from today onward that are still unmarked.
 *  - The plan's id, creation time and inputs stay; strategy, explanations and warnings become the new ones.
 * A new session whose id is already in the plan is given a different one rather than trusted to be unique.
 */
export function mergeReplan(plan: StoredPlan, answer: Pick<PlanAnswer, "sessions" | "strategy" | "explanations" | "warnings">, clock: Clock, newId: () => string = () => uuid()): ReplanResult {
    const kept = plan.sessions.filter((s) => s.date < clock.today || s.status !== "pending");
    const ids = new Set(kept.map((s) => s.id));

    const added: StoredSession[] = answer.sessions.map((s) => {
        let id = s.id;
        for (let attempt = 0; ids.has(id); attempt++) {
            if (attempt >= 50) throw new Error("id_generator_keeps_colliding");
            id = newId();
        }
        ids.add(id);
        return { ...s, id, status: "pending" };
    });

    const alreadyOver = added.filter((s) => s.date === clock.today && minutesOf(s.endTime) <= clock.minutes).length;

    return {
        plan: {
            ...plan,
            strategy: answer.strategy,
            explanations: answer.explanations,
            warnings: answer.warnings,
            sessions: [...kept, ...added].sort(byTime),
        },
        replaced: plan.sessions.length - kept.length,
        added: added.length,
        alreadyOver,
    };
}

/** A new plan in storage form from the server's answer and the inputs it was made from. */
export function planFromAnswer(answer: PlanAnswer, structured: Record<string, unknown>, now: Date, newId: () => string = () => uuid()): StoredPlan {
    const ids = new Set<string>();
    const sessions: StoredSession[] = answer.sessions.map((s) => {
        let id = s.id;
        for (let attempt = 0; !id || ids.has(id); attempt++) {
            if (attempt >= 50) throw new Error("id_generator_keeps_colliding");
            id = newId();
        }
        ids.add(id);
        return { ...s, id, status: "pending" };
    });
    return {
        id: newId(),
        createdAt: now.toISOString(),
        subject: answer.subject,
        startDate: answer.startDate,
        endDate: answer.endDate,
        planMode: answer.planMode,
        strategy: answer.strategy,
        explanations: answer.explanations,
        warnings: answer.warnings,
        structured,
        sessions: sessions.sort(byTime),
        state: "draft",
        publishedAt: null,
    };
}
