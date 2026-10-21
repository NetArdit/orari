/**
 * Placement and rescheduling, deterministic. The AI proposes a plan once; when sessions are missed, THIS code finds
 * new places for them: inside the person's free windows, outside their busy time and other sessions, within the daily
 * and weekly limits, with the suggested rest after long sessions. The same input always gives the same answer, and a
 * proposal changes nothing until the person confirms it. A session that cannot be placed is said so, with the
 * smallest change that would let it fit.
 */
import type { StoredPlan, StoredSession } from "../storage/model.ts";
import { DEFAULT_CAPACITY, REST, validatePlan, type Capacity } from "./validate.ts";

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const addDays = (d: string, n: number) => {
    const [y, m, day] = parts(d);
    const t = new Date(Date.UTC(y, m - 1, day + n));
    return t.toISOString().slice(0, 10);
};
const weekdayOf = (d: string) => {
    const [y, m, day] = parts(d);
    return WEEKDAYS[new Date(Date.UTC(y, m - 1, day)).getUTCDay()]!;
};
const mondayOf = (d: string) => {
    const [y, m, day] = parts(d);
    return addDays(d, -((new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7));
};
const len = (s: Pick<StoredSession, "startTime" | "endTime">) => minutes(s.endTime) - minutes(s.startTime);

interface Span {
    start: number;
    end: number;
}
interface Availability {
    day: string;
    off: boolean;
    windows: Array<{ start: string; end: string }>;
}
interface Commitment {
    days: string[] | null;
    dates?: string[] | null;
    start: string;
    end: string;
}

/** With no hours given the day is open from 07:00 to 23:00 (sleep is assumed outside it, as on the server). */
const DEFAULT_OPEN: Span = { start: 7 * 60, end: 23 * 60 };

function subtract(spans: Span[], cut: Span): Span[] {
    return spans.flatMap((s) => (cut.end <= s.start || cut.start >= s.end ? [s] : [...(cut.start > s.start ? [{ start: s.start, end: cut.start }] : []), ...(cut.end < s.end ? [{ start: cut.end, end: s.end }] : [])]));
}

/** The free spans of a date: the person's windows, minus busy time, minus the sessions that stay where they are. */
export function freeSpans(plan: Pick<StoredPlan, "structured">, date: string, fixed: readonly StoredSession[]): Span[] {
    const availability = Array.isArray(plan.structured.weeklyAvailability) ? (plan.structured.weeklyAvailability as Availability[]) : [];
    const commitments = Array.isArray(plan.structured.commitments) ? (plan.structured.commitments as Commitment[]) : [];
    let spans: Span[];
    if (availability.length === 0) spans = [DEFAULT_OPEN];
    else {
        const day = availability.find((a) => a.day === weekdayOf(date));
        spans = day && !day.off ? day.windows.map((w) => ({ start: minutes(w.start), end: minutes(w.end) })) : [];
    }
    const excluded = Array.isArray(plan.structured.excludedDates) ? (plan.structured.excludedDates as string[]) : [];
    if (excluded.includes(date)) return [];
    for (const c of commitments) {
        const applies = c.dates?.length ? c.dates.includes(date) : !c.days || c.days.includes(weekdayOf(date));
        if (!applies) continue;
        const cs = minutes(c.start);
        const ce = minutes(c.end);
        for (const cut of ce > cs ? [{ start: cs, end: ce }] : [{ start: cs, end: 1440 }, { start: 0, end: ce }]) spans = subtract(spans, cut);
    }
    for (const s of fixed.filter((x) => x.date === date)) spans = subtract(spans, { start: minutes(s.startTime), end: minutes(s.endTime) });
    return spans.filter((s) => s.end - s.start > 0).sort((a, b) => a.start - b.start);
}

export interface Place {
    date: string;
    startTime: string;
    endTime: string;
}

/**
 * The earliest place for a session of `duration` minutes, from `from` on, up to `lastDate`. Leaves the suggested rest
 * after a long session before it, and stays within the limits. Null when there is none.
 */
export function placeSession(plan: Pick<StoredPlan, "structured">, fixed: readonly StoredSession[], duration: number, from: { date: string; minute: number }, lastDate: string, capacity: Capacity): Place | null {
    const week = (d: string) => fixed.filter((s) => mondayOf(s.date) === mondayOf(d)).reduce((n, s) => n + len(s), 0);
    for (let date = from.date; date <= lastDate; date = addDays(date, 1)) {
        const dayTotal = fixed.filter((s) => s.date === date).reduce((n, s) => n + len(s), 0);
        if (dayTotal + duration > capacity.dailyMinutes || week(date) + duration > capacity.weeklyMinutes) continue;
        for (const span of freeSpans(plan, date, fixed)) {
            let start = Math.max(span.start, date === from.date ? from.minute : 0);
            // The rest after a long session just before this span is kept.
            const before = fixed.filter((s) => s.date === date && minutes(s.endTime) <= span.start && len(s) >= REST.breakAfterMinutes).sort((a, b) => minutes(b.endTime) - minutes(a.endTime))[0];
            if (before && start < minutes(before.endTime) + REST.breakMinutes) start = minutes(before.endTime) + REST.breakMinutes;
            if (start + duration <= span.end) return { date, startTime: clock(start), endTime: clock(start + duration) };
        }
    }
    return null;
}

export interface Move {
    sessionId: string;
    title: string;
    from: Place;
    to: Place;
    reason: string;
}
export interface Unplaced {
    sessionId: string;
    title: string;
    reason: string;
    /** The earlier end date that would have let it fit, found within the next 28 days. */
    fitsIfEndDate: string | null;
}
export interface Proposal {
    planId: string;
    /** What the proposal was made from: if the plan changes, a proposal with another signature is stale and thrown away. */
    signature: string;
    moves: Move[];
    unplaced: Unplaced[];
}

export const signatureOf = (plan: Pick<StoredPlan, "id" | "sessions">) =>
    plan.id + "|" + [...plan.sessions].map((s) => `${s.id}:${s.status}:${s.date}T${s.startTime}-${s.endTime}`).sort().join(",");

/** The missed sessions of a plan: still unmarked, and their time has passed. */
export const missedSessions = (plan: Pick<StoredPlan, "sessions">, now: Date) =>
    plan.sessions.filter((s) => s.status === "pending" && new Date(`${s.date}T${s.endTime}:00`).getTime() <= now.getTime());

export function proposeReschedule(plan: StoredPlan, now: Date, capacity: Capacity = DEFAULT_CAPACITY): Proposal | null {
    const missed = missedSessions(plan, now).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    if (missed.length === 0) return null;
    const missedIds = new Set(missed.map((s) => s.id));
    // Everything that is not being moved stays exactly where it is, including the sessions already marked.
    let fixed = plan.sessions.filter((s) => !missedIds.has(s.id));
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const nowMinute = Math.ceil((now.getHours() * 60 + now.getMinutes()) / 5) * 5;
    const moves: Move[] = [];
    const unplaced: Unplaced[] = [];
    for (const s of missed) {
        const duration = len(s);
        const from = { date: todayStr, minute: nowMinute };
        const place = placeSession(plan, fixed, duration, from, plan.endDate, capacity);
        if (place) {
            fixed = [...fixed, { ...s, ...place }];
            moves.push({ sessionId: s.id, title: s.title, from: { date: s.date, startTime: s.startTime, endTime: s.endTime }, to: place, reason: "It was not marked as done or skipped and its time has passed. This is the earliest free place inside your free time, your limits and your deadline." });
            continue;
        }
        const later = placeSession(plan, fixed, duration, from, addDays(plan.endDate, 28), capacity);
        unplaced.push({
            sessionId: s.id,
            title: s.title,
            reason: `There is no free place before the end date (${plan.endDate}) inside your free time and limits.`,
            fitsIfEndDate: later ? later.date : null,
        });
    }
    return { planId: plan.id, signature: signatureOf(plan), moves, unplaced };
}

/** The plan with the proposal applied, or null when it is stale (the plan changed since) or would break a hard rule. */
export function applyProposal(plan: StoredPlan, proposal: Proposal, capacity: Capacity = DEFAULT_CAPACITY): StoredPlan | null {
    if (proposal.planId !== plan.id || proposal.signature !== signatureOf(plan) || proposal.moves.length === 0) return null;
    const moved = new Map(proposal.moves.map((m) => [m.sessionId, m.to]));
    const next: StoredPlan = { ...plan, sessions: plan.sessions.map((s) => (moved.has(s.id) ? { ...s, ...moved.get(s.id)! } : s)).sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime)) };
    return validatePlan(next, capacity).violations.length === 0 ? next : null;
}

/* ---------- the loop guards, kept apart from the maths ---------- */

export const COOLDOWN_MS = 24 * 3600_000;
export interface ProposalMemory {
    /** planId -> when the person last dismissed a proposal for it */
    dismissedAt: Record<string, number>;
}
/** One proposal is shown at a time; after a dismissal the next waits a day; a proposal for a changed plan is discarded. */
export function proposalToShow(plan: StoredPlan, now: Date, capacity: Capacity, memory: ProposalMemory): Proposal | null {
    const dismissed = memory.dismissedAt[plan.id];
    if (dismissed !== undefined && now.getTime() - dismissed < COOLDOWN_MS) return null;
    return proposeReschedule(plan, now, capacity);
}
