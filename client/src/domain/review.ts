/**
 * The weekly review and the suggestions drawn from it. Only recorded facts: a session counts as completed or
 * skipped only because the person marked it; a session that ended unmarked is "not marked", never "missed
 * learning" or "forgotten"; study time is the length of sessions marked completed. Nothing here says anything
 * about understanding or mastery.
 */
import type { StoredPlan, StoredSession } from "../storage/model.ts";

const parts = (d: string) => d.split("-").map(Number) as [number, number, number];
const addDays = (d: string, n: number) => {
    const [y, m, day] = parts(d);
    return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
};
export const mondayOf = (d: string) => {
    const [y, m, day] = parts(d);
    return addDays(d, -((new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7));
};
const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
const len = (s: Pick<StoredSession, "startTime" | "endTime">) => minutes(s.endTime) - minutes(s.startTime);

export interface WeekReview {
    weekStart: string;
    planned: number;
    completed: number;
    partial: number;
    skipped: number;
    /** Ended without a mark. */
    unmarked: number;
    /** Not started yet. */
    upcoming: number;
    /** Minutes of sessions marked completed. Partly done sessions are not counted: how much was done is not recorded. */
    confirmedMinutes: number;
    perPlan: Array<{ planId: string; subject: string; completed: number; planned: number }>;
}

export function reviewWeek(plans: readonly StoredPlan[], weekStart: string, now: Date): WeekReview {
    const end = addDays(weekStart, 6);
    const r: WeekReview = { weekStart, planned: 0, completed: 0, partial: 0, skipped: 0, unmarked: 0, upcoming: 0, confirmedMinutes: 0, perPlan: [] };
    for (const plan of plans) {
        if (plan.state === "draft") continue;
        let planned = 0;
        let completed = 0;
        for (const s of plan.sessions) {
            if (s.date < weekStart || s.date > end) continue;
            planned++;
            if (s.status === "completed") {
                completed++;
                r.completed++;
                r.confirmedMinutes += len(s);
            } else if (s.status === "partial") r.partial++;
            else if (s.status === "skipped") r.skipped++;
            else if (new Date(`${s.date}T${s.endTime}:00`).getTime() <= now.getTime()) r.unmarked++;
            else r.upcoming++;
        }
        r.planned += planned;
        if (planned > 0) r.perPlan.push({ planId: plan.id, subject: plan.subject, completed, planned });
    }
    return r;
}

export interface Suggestion {
    id: string;
    /** The recorded facts the suggestion rests on, in words. */
    evidence: string;
    text: string;
    /** What accepting it opens; nothing changes until the person confirms there. */
    action: "reschedule" | "limits" | "none";
}

/**
 * Suggestions for next week, only from the week just recorded and only when there is enough to say something:
 * at least 3 sessions that were due. They are offered, never applied.
 */
export function suggestionsFrom(review: WeekReview): Suggestion[] {
    const due = review.completed + review.partial + review.skipped + review.unmarked;
    if (due < 3) return [];
    const evidence = `${review.completed} of ${due} sessions marked completed${review.partial ? `, ${review.partial} partly` : ""}, ${review.skipped} skipped, ${review.unmarked} not marked`;
    const out: Suggestion[] = [];
    if (review.unmarked >= 1) out.push({ id: "reschedule-unmarked", evidence, text: "Some sessions ended without a mark. If you did not do them, you can have them moved to free places; if you did, mark them so the numbers are right.", action: "reschedule" });
    if ((review.skipped + review.unmarked) / due >= 0.5) out.push({ id: "lower-load", evidence, text: "Half or more of the sessions were skipped or not marked. You could lower your daily limit for next week. Only you know whether the plan was too much.", action: "limits" });
    if (review.completed === due && due >= 4) out.push({ id: "all-done", evidence, text: "Every session this week is marked completed. If it felt easy, you can raise your daily limit; nothing changes unless you do.", action: "limits" });
    return out;
}
