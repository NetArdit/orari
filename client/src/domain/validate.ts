/**
 * The only authority on whether a plan may be published. Pure and deterministic: no clock, no network, and nothing
 * here asks the AI to do arithmetic. Violations block publishing; warnings are shown and do not.
 */
import type { StoredPlan, StoredSession } from "../storage/model.ts";

export interface Capacity {
    /** Longest study time on one day, in minutes. */
    dailyMinutes: number;
    /** Longest study time in one calendar week (Monday to Sunday), in minutes. */
    weeklyMinutes: number;
}

/** Used when the person has set nothing; shown as "suggested defaults" and editable. */
export const DEFAULT_CAPACITY: Capacity = { dailyMinutes: 120, weeklyMinutes: 600 };
export const REST = { breakAfterMinutes: 50, breakMinutes: 10, maxConsecutiveIntensive: 2 } as const;
export const SESSION_MINUTES = { min: 5, max: 240 } as const;

export interface Issue {
    code: "OVERLAP" | "DURATION" | "OUTSIDE_PLAN" | "OUTSIDE_AVAILABILITY" | "COMMITMENT" | "DAILY_CAPACITY" | "WEEKLY_CAPACITY" | "NO_SESSIONS" | "BREAK" | "INTENSIVE_RUN";
    message: string;
    sessionIds: string[];
}
export interface Validation {
    violations: Issue[];
    warnings: Issue[];
}

const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const weekdayOf = (date: string) => {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
};
/** The Monday of the week a date falls in (UTC arithmetic: a calendar date has no zone and no DST). */
function weekStart(date: string): string {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
    return t.toISOString().slice(0, 10);
}
const length = (s: Pick<StoredSession, "startTime" | "endTime">) => minutes(s.endTime) - minutes(s.startTime);

interface Window {
    start: string;
    end: string;
}
interface Availability {
    day: string;
    off: boolean;
    windows: Window[];
}
interface Commitment {
    label: string;
    days: string[] | null;
    dates?: string[] | null;
    start: string;
    end: string;
}

export function validatePlan(plan: Pick<StoredPlan, "startDate" | "endDate" | "sessions" | "structured">, capacity: Capacity = DEFAULT_CAPACITY): Validation {
    const violations: Issue[] = [];
    const warnings: Issue[] = [];
    const sessions = [...plan.sessions].sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
    if (sessions.length === 0) violations.push({ code: "NO_SESSIONS", message: "The plan has no sessions.", sessionIds: [] });

    const availability = Array.isArray(plan.structured.weeklyAvailability) ? (plan.structured.weeklyAvailability as Availability[]) : [];
    const commitments = Array.isArray(plan.structured.commitments) ? (plan.structured.commitments as Commitment[]) : [];
    const label = (s: StoredSession) => `"${s.title}" (${s.date} ${s.startTime}–${s.endTime})`;

    for (const s of sessions) {
        const len = length(s);
        if (len < SESSION_MINUTES.min || len > SESSION_MINUTES.max) {
            violations.push({ code: "DURATION", message: `${label(s)} lasts ${len} minutes; a session must be ${SESSION_MINUTES.min} to ${SESSION_MINUTES.max} minutes and end after it starts.`, sessionIds: [s.id] });
        }
        if (s.date < plan.startDate || s.date > plan.endDate) {
            violations.push({ code: "OUTSIDE_PLAN", message: `${label(s)} is outside the dates of the plan (${plan.startDate} to ${plan.endDate}).`, sessionIds: [s.id] });
        }

        // With no day set every day is open; once any day is set, the others are closed.
        if (availability.length > 0) {
            const day = availability.find((a) => a.day === weekdayOf(s.date));
            const fits = day && !day.off && day.windows.some((w) => minutes(w.start) <= minutes(s.startTime) && minutes(s.endTime) <= minutes(w.end));
            if (!fits) violations.push({ code: "OUTSIDE_AVAILABILITY", message: `${label(s)} is not inside the time you said you are free.`, sessionIds: [s.id] });
        }
        for (const c of commitments) {
            const applies = c.dates?.length ? c.dates.includes(s.date) : !c.days || c.days.includes(weekdayOf(s.date));
            if (!applies) continue;
            const cs = minutes(c.start);
            const ce = minutes(c.end);
            const a = minutes(s.startTime);
            const b = minutes(s.endTime);
            // A commitment may pass midnight (a night shift): it then covers the evening and the early morning.
            const hit = ce > cs ? a < ce && cs < b : a < ce || cs < b;
            if (hit) violations.push({ code: "COMMITMENT", message: `${label(s)} overlaps "${c.label}", which you marked as busy.`, sessionIds: [s.id] });
        }
    }

    for (let i = 1; i < sessions.length; i++) {
        const p = sessions[i - 1]!;
        const s = sessions[i]!;
        if (p.date === s.date && minutes(s.startTime) < minutes(p.endTime)) {
            violations.push({ code: "OVERLAP", message: `${label(p)} overlaps ${label(s)}.`, sessionIds: [p.id, s.id] });
        }
    }

    const perDay = new Map<string, StoredSession[]>();
    const perWeek = new Map<string, number>();
    for (const s of sessions) {
        perDay.set(s.date, [...(perDay.get(s.date) ?? []), s]);
        perWeek.set(weekStart(s.date), (perWeek.get(weekStart(s.date)) ?? 0) + Math.max(0, length(s)));
    }
    for (const [date, list] of perDay) {
        const total = list.reduce((sum, s) => sum + Math.max(0, length(s)), 0);
        if (total > capacity.dailyMinutes) {
            violations.push({ code: "DAILY_CAPACITY", message: `${date} has ${total} minutes of study; your daily limit is ${capacity.dailyMinutes}.`, sessionIds: list.map((s) => s.id) });
        }
        // Rest rules are soft: shown, not blocking.
        for (let i = 1; i < list.length; i++) {
            const p = list[i - 1]!;
            const s = list[i]!;
            const gap = minutes(s.startTime) - minutes(p.endTime);
            if (length(p) >= REST.breakAfterMinutes && gap >= 0 && gap < REST.breakMinutes) {
                warnings.push({ code: "BREAK", message: `Only ${gap} minutes of rest after ${label(p)}; ${REST.breakMinutes} are suggested after ${REST.breakAfterMinutes}+ minutes.`, sessionIds: [p.id, s.id] });
            }
        }
        let run = 0;
        for (const s of list) {
            run = s.difficulty === "hard" ? run + 1 : 0;
            if (run > REST.maxConsecutiveIntensive) warnings.push({ code: "INTENSIVE_RUN", message: `${date} has more than ${REST.maxConsecutiveIntensive} hard sessions in a row.`, sessionIds: [s.id] });
        }
    }
    for (const [week, total] of perWeek) {
        if (total > capacity.weeklyMinutes) {
            violations.push({ code: "WEEKLY_CAPACITY", message: `The week of ${week} has ${total} minutes of study; your weekly limit is ${capacity.weeklyMinutes}.`, sessionIds: [] });
        }
    }
    return { violations, warnings };
}

/** The smallest limits that would let the plan through: offered when capacity is the only thing in the way. */
export function capacityNeeded(plan: Pick<StoredPlan, "sessions">): Capacity {
    const day = new Map<string, number>();
    const week = new Map<string, number>();
    for (const s of plan.sessions) {
        day.set(s.date, (day.get(s.date) ?? 0) + length(s));
        week.set(weekStart(s.date), (week.get(weekStart(s.date)) ?? 0) + length(s));
    }
    return { dailyMinutes: Math.max(0, ...day.values()), weeklyMinutes: Math.max(0, ...week.values()) };
}

const CAPACITY_KEY = "orari.capacity";
type Store = Pick<Storage, "getItem" | "setItem">;

/** The person's limits, or the suggested defaults. Never throws: storage can be blocked or hold junk. */
export function readCapacity(storage: Store | null): Capacity {
    try {
        const v = JSON.parse(storage?.getItem(CAPACITY_KEY) ?? "null") as Partial<Capacity> | null;
        const ok = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 15 && n <= 24 * 60 * 7;
        if (v && ok(v.dailyMinutes) && ok(v.weeklyMinutes)) return { dailyMinutes: v.dailyMinutes, weeklyMinutes: v.weeklyMinutes };
    } catch {
        /* defaults */
    }
    return { ...DEFAULT_CAPACITY };
}
export function writeCapacity(storage: Store | null, capacity: Capacity): void {
    try {
        storage?.setItem(CAPACITY_KEY, JSON.stringify(capacity));
    } catch {
        /* blocked or full: the choice holds for this visit only */
    }
}

/** Publishing is the only way a draft reaches the schedule. Publishing a published plan changes nothing, so a double tap or a retry cannot publish twice. */
export function publish(plan: StoredPlan, capacity: Capacity, now: Date): { ok: true; plan: StoredPlan } | { ok: false; violations: Issue[] } {
    if (plan.state !== "draft") return { ok: true, plan };
    const { violations } = validatePlan(plan, capacity);
    if (violations.length > 0) return { ok: false, violations };
    return { ok: true, plan: { ...plan, state: "published", publishedAt: now.toISOString() } };
}
