/**
 * The state behind the "new plan" form, and its translation to and from what the server understands.
 *
 * One form serves both ways of starting: filled in by hand, or pre-filled from what the AI read in a
 * free-text description. Either way every value stays editable, including free time and busy time,
 * which the old page showed as text that could not be corrected.
 *
 * Checks here mirror the server's so that most mistakes are caught before a request is made, and
 * they report with the server's own field paths, so an error from either side lands on the same control.
 */
import { addDays, daysBetween } from "./clock.ts";
import type { CreatePlanRequest, FieldError, ParsedDescription, PlanInputs } from "../api/types.ts";

export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export type PlanMode = PlanInputs["planMode"];
export type Difficulty = PlanInputs["difficulty"];
export type CommitmentKind = PlanInputs["commitments"][number]["type"];
export type Energy = "high" | "medium" | "low";

export interface TimeRange {
    start: string;
    end: string;
}

export interface DayAvailability {
    /** "off": no study that day. "free": study in the listed windows. "unset": nothing said about this day. */
    mode: "unset" | "free" | "off";
    windows: TimeRange[];
}

export interface CommitmentDraft {
    label: string;
    kind: CommitmentKind;
    /** Empty means every day. */
    days: Weekday[];
    start: string;
    end: string;
}

export interface PlanFormState {
    subject: string;
    /** What is to be covered: chapters, pages, topics. */
    material: string;
    /** What the person wants to be able to do at the end. Separate from material; the old form merged the two. */
    goal: string;
    planMode: PlanMode;
    difficulty: Difficulty;
    startDate: string;
    endDate: string;
    /** Preferred session length in minutes, or null for no preference. */
    sessionMinutes: number | null;
    energy: { morning: Energy | null; afternoon: Energy | null; evening: Energy | null };
    days: Record<Weekday, DayAvailability>;
    commitments: CommitmentDraft[];
    /** Whole days without study: an exam day, a trip, a holiday. */
    unavailableDates: string[];
}

export const LIMITS = { planDays: 180, windowsPerDay: 8, commitments: 40, unavailableDates: 180, sessionMinutesMin: 10, sessionMinutesMax: 240 } as const;

const unset = (): DayAvailability => ({ mode: "unset", windows: [] });
const emptyDays = (): Record<Weekday, DayAvailability> => ({ mon: unset(), tue: unset(), wed: unset(), thu: unset(), fri: unset(), sat: unset(), sun: unset() });

export function emptyPlanForm(today: string): PlanFormState {
    return {
        subject: "", material: "", goal: "", planMode: "general", difficulty: "medium", startDate: today, endDate: "",
        sessionMinutes: null, energy: { morning: null, afternoon: null, evening: null }, days: emptyDays(), commitments: [], unavailableDates: [],
    };
}

/** The form pre-filled with what the AI understood. Nothing the AI left out is invented. */
export function formFromParsed(parsed: ParsedDescription, today: string): PlanFormState {
    const form = emptyPlanForm(today);
    const days = emptyDays();
    for (const entry of parsed.weeklyAvailability) {
        days[entry.day] = entry.off ? { mode: "off", windows: [] } : { mode: "free", windows: entry.windows.map((w) => ({ ...w })) };
    }
    return {
        ...form,
        subject: parsed.subject ?? "",
        material: parsed.materialAmount ?? "",
        goal: parsed.goal ?? "",
        planMode: parsed.planMode ?? "general",
        difficulty: parsed.difficulty ?? "medium",
        startDate: parsed.startDate ?? today,
        endDate: parsed.endDate ?? "",
        sessionMinutes: parsed.sessionPreferenceMinutes,
        energy: { morning: parsed.energy?.morning ?? null, afternoon: parsed.energy?.afternoon ?? null, evening: parsed.energy?.evening ?? null },
        days,
        commitments: parsed.commitments.map((c) => ({ label: c.label, kind: c.type, days: [...(c.days ?? [])], start: c.start, end: c.end })),
    };
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRealDate(value: string): boolean {
    if (!DATE.test(value)) return false;
    const [y, m, d] = value.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** "9:00", " 09:00 " and "09.00" as people type them, to "09:00"; null if it is not a time of day. */
export function normaliseTime(input: string): string | null {
    const match = input.trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if (!match) return null;
    const time = `${match[1]!.padStart(2, "0")}:${match[2]}`;
    return TIME.test(time) ? time : null;
}

export type BuildResult = { ok: true; structured: CreatePlanRequest["structured"] } | { ok: false; errors: FieldError[] };

const MESSAGES = {
    required: "Fill in this field.",
    date: "The date is not valid.",
    order: "The end date must be after the start date.",
    tooLong: "A plan can last at most 180 days.",
    time: "Write the time like 08:30.",
    windowOrder: "The end time must be after the start time.",
    sameTime: "The start and the end cannot be the same time.",
    overlap: "This time overlaps another one on the same day.",
    tooMany: "You added more than is allowed.",
    minutes: "Choose a length from 10 to 240 minutes.",
    noFreeDay: "At least one day must be left for study.",
    noStudyDate: "No day is left for study in this period. Change the dates, the free days or the days without study.",
} as const;

const WEEKDAY_OF_UTC_DAY: readonly Weekday[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function weekdayOf(date: string): Weekday {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    return WEEKDAY_OF_UTC_DAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
}

/**
 * The dates of the plan on which study is possible at all, going by the days set and the days without
 * study. It does not subtract busy time: a date counted here can still turn out full once commitments
 * and sleep are taken off, which only the server works out. Zero here means certainly nothing to plan.
 */
export function studyDatesIn(form: Pick<PlanFormState, "startDate" | "endDate" | "days" | "unavailableDates">): number {
    const anyDaySet = WEEKDAYS.some((day) => form.days[day].mode !== "unset");
    const span = daysBetween(form.startDate, form.endDate);
    let count = 0;
    for (let i = 0; i <= span && i < LIMITS.planDays; i++) {
        const date = addDays(form.startDate, i);
        if (form.unavailableDates.includes(date)) continue;
        const mode = form.days[weekdayOf(date)].mode;
        // The server's rule: with no day set every day is open; once any day is set, the others are closed.
        if (mode === "free" || (mode === "unset" && !anyDaySet)) count++;
    }
    return count;
}

/** How long a plan runs when the person gave no end: long enough to be a real plan, short enough to hold. */
export const DEFAULT_PLAN_DAYS = 28;

/**
 * What the person did not say, filled in with reasonable choices, so that a short description is enough to get a
 * plan: the plan starts today, runs four weeks when no end was given, and a day named as free without hours gets an
 * evening window as long as the session (two hours when no length was given). Nothing the person did say is changed.
 */
export function applyPlanDefaults(form: PlanFormState, today: string): PlanFormState {
    const startDate = isRealDate(form.startDate) ? form.startDate : today;
    const endDate = isRealDate(form.endDate) ? form.endDate : addDays(startDate, DEFAULT_PLAN_DAYS - 1);
    const minutes = form.sessionMinutes ?? 120;
    const endMinutes = Math.min(17 * 60 + Math.max(minutes, 60), 23 * 60);
    const windowEnd = `${String(Math.floor(endMinutes / 60)).padStart(2, "0")}:${String(endMinutes % 60).padStart(2, "0")}`;
    const days = structuredClone(form.days);
    for (const day of WEEKDAYS) {
        if (days[day].mode === "free" && days[day].windows.length === 0) days[day] = { mode: "free", windows: [{ start: "17:00", end: windowEnd }] };
    }
    return { ...form, startDate, endDate, days };
}

/**
 * Checks the form and, if everything holds, gives the plan inputs to send.
 * Every problem is reported at once, each with the path of its control.
 */
export function buildPlanInputs(form: PlanFormState): BuildResult {
    const errors: FieldError[] = [];
    const fail = (path: string, message: string) => errors.push({ path: `structured.${path}`, message });

    const subject = form.subject.trim();
    if (!subject) fail("subject", MESSAGES.required);

    const startOk = isRealDate(form.startDate);
    const endOk = isRealDate(form.endDate);
    if (!form.startDate) fail("startDate", MESSAGES.required);
    else if (!startOk) fail("startDate", MESSAGES.date);
    if (!form.endDate) fail("endDate", MESSAGES.required);
    else if (!endOk) fail("endDate", MESSAGES.date);
    if (startOk && endOk) {
        const span = daysBetween(form.startDate, form.endDate);
        if (span < 0) fail("endDate", MESSAGES.order);
        else if (span + 1 > LIMITS.planDays) fail("endDate", MESSAGES.tooLong);
    }

    if (form.sessionMinutes !== null && (!Number.isInteger(form.sessionMinutes) || form.sessionMinutes < LIMITS.sessionMinutesMin || form.sessionMinutes > LIMITS.sessionMinutesMax)) {
        fail("sessionPreferenceMinutes", MESSAGES.minutes);
    }

    // Free time. Days left "unset" are simply not sent; the server then treats them as it always has:
    // open if no day at all is specified, closed if some are.
    const weeklyAvailability: CreatePlanRequest["structured"]["weeklyAvailability"] = [];
    for (const day of WEEKDAYS) {
        const entry = form.days[day];
        if (entry.mode === "unset") continue;
        const index = weeklyAvailability.length;
        if (entry.mode === "off") {
            weeklyAvailability.push({ day, off: true, windows: [] });
            continue;
        }
        if (entry.windows.length > LIMITS.windowsPerDay) fail(`weeklyAvailability.${index}.windows`, MESSAGES.tooMany);
        const windows: TimeRange[] = [];
        entry.windows.forEach((window, w) => {
            const start = normaliseTime(window.start);
            const end = normaliseTime(window.end);
            if (!start) fail(`weeklyAvailability.${index}.windows.${w}.start`, window.start.trim() ? MESSAGES.time : MESSAGES.required);
            if (!end) fail(`weeklyAvailability.${index}.windows.${w}.end`, window.end.trim() ? MESSAGES.time : MESSAGES.required);
            if (!start || !end) return;
            if (end <= start) return fail(`weeklyAvailability.${index}.windows.${w}.end`, MESSAGES.windowOrder);
            if (windows.some((other) => start < other.end && other.start < end)) return fail(`weeklyAvailability.${index}.windows.${w}.start`, MESSAGES.overlap);
            windows.push({ start, end });
        });
        if (entry.windows.length === 0) fail(`weeklyAvailability.${index}.windows`, MESSAGES.required);
        weeklyAvailability.push({ day, off: false, windows: windows.sort((a, b) => a.start.localeCompare(b.start)) });
    }
    if (WEEKDAYS.every((day) => form.days[day].mode === "off")) fail("weeklyAvailability", MESSAGES.noFreeDay);

    // Busy time. A commitment may run past midnight (a night shift), so end before start is allowed; equal is not.
    if (form.commitments.length > LIMITS.commitments) fail("commitments", MESSAGES.tooMany);
    const commitments: CreatePlanRequest["structured"]["commitments"] = [];
    form.commitments.forEach((draft, i) => {
        const label = draft.label.trim();
        const start = normaliseTime(draft.start);
        const end = normaliseTime(draft.end);
        if (!label) fail(`commitments.${i}.label`, MESSAGES.required);
        if (!start) fail(`commitments.${i}.start`, draft.start.trim() ? MESSAGES.time : MESSAGES.required);
        if (!end) fail(`commitments.${i}.end`, draft.end.trim() ? MESSAGES.time : MESSAGES.required);
        if (start && end && start === end) fail(`commitments.${i}.end`, MESSAGES.sameTime);
        if (!label || !start || !end || start === end) return;
        const days = WEEKDAYS.filter((day) => draft.days.includes(day));
        commitments.push({ label: label.slice(0, 60), type: draft.kind, days: days.length === 0 || days.length === 7 ? null : days, dates: null, start, end });
    });

    if (form.unavailableDates.length > LIMITS.unavailableDates) fail("unavailableDates", MESSAGES.tooMany);
    const unavailableDates: string[] = [];
    form.unavailableDates.forEach((date, i) => {
        if (!isRealDate(date)) fail(`unavailableDates.${i}`, MESSAGES.date);
        else if (!unavailableDates.includes(date)) unavailableDates.push(date);
    });

    // A form can be valid field by field and still leave no day to study on: a two-day plan whose
    // only free weekday falls outside it, or every date marked as a day without study. The server would
    // answer "no free time" after a round trip; it is said here, on the availability control.
    if (errors.length === 0 && studyDatesIn(form) === 0) fail("weeklyAvailability", MESSAGES.noStudyDate);

    if (errors.length > 0) return { ok: false, errors };

    const energy = form.energy.morning || form.energy.afternoon || form.energy.evening ? form.energy : null;
    return {
        ok: true,
        structured: {
            startDate: form.startDate,
            endDate: form.endDate,
            subject: subject.slice(0, 120),
            materialAmount: form.material.trim().slice(0, 200) || null,
            goal: form.goal.trim().slice(0, 300) || null,
            planMode: form.planMode,
            weeklyAvailability,
            commitments,
            unavailableDates: unavailableDates.sort(),
            sessionPreferenceMinutes: form.sessionMinutes,
            energy,
            difficulty: form.difficulty,
        },
    };
}

/** The errors that belong to one control: its own path and anything beneath it. */
export function errorsAt(errors: readonly FieldError[], path: string): string[] {
    const full = `structured.${path}`;
    return errors.filter((e) => e.path === full || e.path.startsWith(full + ".")).map((e) => e.message);
}
