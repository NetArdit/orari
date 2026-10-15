/** English words for dates and for the session vocabulary. One place, so the wording can be reviewed together. */
import type { SessionState } from "../domain/progress.ts";
import type { SessionStatus } from "../storage/model.ts";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"] as const;

function parts(date: string): { year: number; month: number; day: number; weekday: number } {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** "Wednesday, 14 October" */
export function dayLabel(date: string): string {
    const p = parts(date);
    return `${WEEKDAYS[p.weekday]!}, ${p.day} ${MONTHS[p.month - 1]}`;
}

/** "14 October" */
export function shortDate(date: string): string {
    const p = parts(date);
    return `${p.day} ${MONTHS[p.month - 1]}`;
}

/** "Wed" */
export function weekdayShort(date: string): string {
    return WEEKDAYS_SHORT[parts(date).weekday]!;
}

export const KIND_LABELS = {
    learning: "New material",
    practice: "Practice",
    recall: "Recall",
    revision: "Revision",
    assessment: "Practice test",
    project: "Project",
} as const;

export const STATE_LABELS: Record<SessionState, string> = {
    done: "Done",
    partial: "Partly done",
    skipped: "Skipped",
    missed: "Missed",
    late: "Time has passed",
    now: "Now",
    upcoming: "",
};

export const MARKS: { status: Exclude<SessionStatus, "pending">; label: string }[] = [
    { status: "completed", label: "Done" },
    { status: "partial", label: "Partly" },
    { status: "skipped", label: "Skipped" },
];

export function minutesLabel(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${m} min`;
}
