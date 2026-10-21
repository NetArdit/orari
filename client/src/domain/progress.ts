/**
 * What has happened to a plan's sessions, in one set of definitions used everywhere.
 *
 * PROPOSED RULES, not yet product policy (see the Batch 4 report). The old page counts differently
 * in different places: its dashboard counts a partly done session as completed while its plan card
 * does not; "missed" there means skipped plus overdue together; its streak is broken by any day
 * without study, rest days included. Each rule below is one named function so it can be changed
 * without touching a screen.
 */
import { addDays, byTime, durationMinutes, minutesOf } from "./clock.ts";
import type { Clock } from "./clock.ts";
import type { StoredPlan, StoredSession } from "../storage/model.ts";

/**
 * Where a session stands right now.
 *  - done / partial / skipped: what the person marked. Their mark always wins over the clock.
 *  - missed: still unmarked and its day has passed.
 *  - late: unmarked, today, and its time has already ended. The day is not over, so it is not missed yet.
 *  - now: unmarked and in progress.
 *  - upcoming: unmarked and still ahead.
 */
export type SessionState = "done" | "partial" | "skipped" | "missed" | "late" | "now" | "upcoming";

export function sessionState(session: Pick<StoredSession, "status" | "date" | "startTime" | "endTime">, clock: Clock): SessionState {
    if (session.status === "completed") return "done";
    if (session.status === "partial") return "partial";
    if (session.status === "skipped") return "skipped";
    if (session.date < clock.today) return "missed";
    if (session.date > clock.today) return "upcoming";
    if (minutesOf(session.endTime) <= clock.minutes) return "late";
    if (minutesOf(session.startTime) <= clock.minutes) return "now";
    return "upcoming";
}

export interface Progress {
    total: number;
    /** Marked done. A partly done session is NOT counted here. */
    done: number;
    partial: number;
    /** The person decided not to do it. */
    skipped: number;
    /** Unmarked and its day has passed: nobody decided anything. */
    missed: number;
    /** Unmarked and still possible: late, now or upcoming. */
    remaining: number;
    /** Planned minutes of every session. */
    minutesPlanned: number;
    /** Full length of done sessions plus half the length of partly done ones. */
    minutesStudied: number;
    /** done plus half of partial, over total; 0 for an empty plan. Between 0 and 1. */
    completion: number;
}

export function progressOf(sessions: readonly StoredSession[], clock: Clock): Progress {
    const result: Progress = { total: sessions.length, done: 0, partial: 0, skipped: 0, missed: 0, remaining: 0, minutesPlanned: 0, minutesStudied: 0, completion: 0 };
    for (const session of sessions) {
        const minutes = durationMinutes(session);
        result.minutesPlanned += minutes;
        const state = sessionState(session, clock);
        if (state === "done") {
            result.done++;
            result.minutesStudied += minutes;
        } else if (state === "partial") {
            result.partial++;
            result.minutesStudied += Math.round(minutes / 2);
        } else if (state === "skipped") result.skipped++;
        else if (state === "missed") result.missed++;
        else result.remaining++;
    }
    result.completion = result.total === 0 ? 0 : (result.done + result.partial / 2) / result.total;
    return result;
}

/** A plan can be adjusted while it has days left and something to make up for. */
export function needsReplan(plan: Pick<StoredPlan, "endDate" | "sessions">, clock: Clock): boolean {
    return plan.endDate >= clock.today && plan.sessions.some((s) => sessionState(s, clock) === "missed");
}

export function isActive(plan: Pick<StoredPlan, "startDate" | "endDate">, clock: Clock): boolean {
    return plan.endDate >= clock.today;
}

/**
 * Days in a row with study, counted back from today.
 *  - A day counts if at least one session of any plan on that day is done or partly done.
 *  - A day with sessions planned and none of them done ends the streak.
 *  - A day with nothing planned (a rest day, or before any plan) neither counts nor ends it.
 *  - Today does not end the streak while it is still going: if nothing is done yet today, counting starts from yesterday.
 * The count is the number of days with study, not the span of the calendar.
 */
export function streakDays(sessions: readonly StoredSession[], clock: Clock): number {
    const studied = new Set<string>();
    const planned = new Set<string>();
    let earliest = clock.today;
    for (const session of sessions) {
        if (session.date > clock.today) continue;
        planned.add(session.date);
        if (session.status === "completed" || session.status === "partial") studied.add(session.date);
        if (session.date < earliest) earliest = session.date;
    }

    let streak = 0;
    let day = clock.today;
    if (!studied.has(day)) day = addDays(day, -1);
    while (day >= earliest) {
        if (studied.has(day)) streak++;
        else if (planned.has(day)) break;
        day = addDays(day, -1);
    }
    return streak;
}

export interface AgendaItem {
    planId: string;
    subject: string;
    session: StoredSession;
    state: SessionState;
}

const itemsOf = (plans: readonly StoredPlan[], clock: Clock): AgendaItem[] =>
    plans.filter((plan) => plan.state !== "draft").flatMap((plan) => plan.sessions.map((session) => ({ planId: plan.id, subject: plan.subject, session, state: sessionState(session, clock) })));

/** Everything dated today, across all plans, in time order, whatever its state. */
export function todayAgenda(plans: readonly StoredPlan[], clock: Clock): AgendaItem[] {
    return itemsOf(plans, clock)
        .filter((item) => item.session.date === clock.today)
        .sort((a, b) => byTime(a.session, b.session));
}

/**
 * The session to show as "next": the one in progress if there is one, otherwise the earliest that has
 * not started yet, today or later. A session whose time has already ended today is not "next"; it is
 * shown in today's list as late. (The old page skipped the session in progress.)
 */
export function nextSession(plans: readonly StoredPlan[], clock: Clock): AgendaItem | null {
    const candidates = itemsOf(plans, clock)
        .filter((item) => item.state === "now" || item.state === "upcoming")
        .sort((a, b) => byTime(a.session, b.session));
    return candidates.find((item) => item.state === "now") ?? candidates[0] ?? null;
}

/** The plan to put first: among plans that have not ended, the most recently created. Null if all have ended. */
export function currentPlan<T extends Pick<StoredPlan, "endDate" | "createdAt">>(plans: readonly T[], clock: Clock): T | null {
    return [...plans].filter((plan) => plan.endDate >= clock.today).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
