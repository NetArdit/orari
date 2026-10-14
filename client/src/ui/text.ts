/** Albanian words for dates and for the session vocabulary. One place, so the wording can be reviewed together. */
import type { SessionState } from "../domain/progress.ts";
import type { SessionStatus } from "../storage/model.ts";

const WEEKDAYS = ["e diel", "e hënë", "e martë", "e mërkurë", "e enjte", "e premte", "e shtunë"] as const;
const WEEKDAYS_SHORT = ["Die", "Hën", "Mar", "Mër", "Enj", "Pre", "Sht"] as const;
const MONTHS = ["janar", "shkurt", "mars", "prill", "maj", "qershor", "korrik", "gusht", "shtator", "tetor", "nëntor", "dhjetor"] as const;

function parts(date: string): { year: number; month: number; day: number; weekday: number } {
    const [year, month, day] = date.split("-").map(Number) as [number, number, number];
    return { year, month, day, weekday: new Date(Date.UTC(year, month - 1, day)).getUTCDay() };
}

/** "E mërkurë, 14 tetor" */
export function dayLabel(date: string): string {
    const p = parts(date);
    const weekday = WEEKDAYS[p.weekday]!;
    return `${weekday.charAt(0).toUpperCase()}${weekday.slice(1)}, ${p.day} ${MONTHS[p.month - 1]}`;
}

/** "14 tetor" */
export function shortDate(date: string): string {
    const p = parts(date);
    return `${p.day} ${MONTHS[p.month - 1]}`;
}

/** "Mër" */
export function weekdayShort(date: string): string {
    return WEEKDAYS_SHORT[parts(date).weekday]!;
}

export const KIND_LABELS = {
    learning: "Mësim i ri",
    practice: "Ushtrime",
    recall: "Rikujtim",
    revision: "Përsëritje",
    assessment: "Test provues",
    project: "Projekt",
} as const;

export const STATE_LABELS: Record<SessionState, string> = {
    done: "E kryer",
    partial: "Përgjysmë",
    skipped: "E anashkaluar",
    missed: "E humbur",
    late: "Ora ka kaluar",
    now: "Tani",
    upcoming: "",
};

export const MARKS: { status: Exclude<SessionStatus, "pending">; label: string }[] = [
    { status: "completed", label: "E kreva" },
    { status: "partial", label: "Përgjysmë" },
    { status: "skipped", label: "S'e bëra" },
];

export function minutesLabel(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} orë` : `${h} orë e ${m} min`;
}
