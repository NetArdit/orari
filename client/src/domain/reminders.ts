/**
 * Reminders, as pure functions: what to remind about and when, what is due or missed right now for the in-app list,
 * and the wording. Real session data only: no invented progress, no guilt. The wording is generic unless the
 * person chose to see details, and it is chosen from a small local set (no AI call per notification).
 */
import type { StoredPlan, StoredSession } from "../storage/model.ts";

export const LEAD_PRESETS = [0, 5, 10, 15, 30, 60, 1440] as const;
export const LEAD_CUSTOM = { min: 1, max: 7 * 24 * 60 } as const;
export const SNOOZE_CHOICES = [5, 10, 15] as const;
export const MAX_SNOOZES = 3;

export interface ReminderPrefs {
    /** Minutes before the start; null = no reminder (the first-time default: nothing is switched on silently). */
    leadMinutes: number | null;
    /** Whether the notification text shows the subject and time. Off by default: a lock screen shows generic text. */
    showDetails: boolean;
    /** Quiet hours, minutes after midnight (22:00 to 08:00 by default). */
    quietStart: number;
    quietEnd: number;
    /** Most push notifications a day. */
    dailyCap: number;
}
export const DEFAULT_PREFS: ReminderPrefs = { leadMinutes: null, showDetails: false, quietStart: 22 * 60, quietEnd: 8 * 60, dailyCap: 5 };

export function validLead(minutes: unknown): minutes is number {
    return typeof minutes === "number" && Number.isInteger(minutes) && ((LEAD_PRESETS as readonly number[]).includes(minutes) || (minutes >= LEAD_CUSTOM.min && minutes <= LEAD_CUSTOM.max));
}

export function parsePrefs(value: unknown): ReminderPrefs {
    const v = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
    const minute = (n: unknown, d: number) => (typeof n === "number" && Number.isInteger(n) && n >= 0 && n < 1440 ? n : d);
    return {
        leadMinutes: v.leadMinutes === null || v.leadMinutes === undefined ? null : validLead(v.leadMinutes) ? v.leadMinutes : null,
        showDetails: v.showDetails === true,
        quietStart: minute(v.quietStart, DEFAULT_PREFS.quietStart),
        quietEnd: minute(v.quietEnd, DEFAULT_PREFS.quietEnd),
        dailyCap: typeof v.dailyCap === "number" && Number.isInteger(v.dailyCap) && v.dailyCap >= 1 && v.dailyCap <= 50 ? v.dailyCap : DEFAULT_PREFS.dailyCap,
    };
}

export function inQuiet(minutes: number, start: number, end: number): boolean {
    return start === end ? false : start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

const GENERIC = [
    ["Study time", "A study session starts soon."],
    ["A session is coming up", "Your next study session is about to begin."],
    ["Time to study", "A planned session is coming up."],
] as const;

const hash = (text: string) => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

export function wording(session: Pick<StoredSession, "id" | "title" | "startTime">, subject: string, showDetails: boolean): { title: string; body: string } {
    const [title, body] = GENERIC[hash(session.id) % GENERIC.length]!;
    return showDetails ? { title: `${subject} at ${session.startTime}`, body: session.title.slice(0, 120) } : { title, body };
}

export interface PlannedReminder {
    key: string;
    sessionId: string;
    planId: string;
    fireAt: string;
    title: string;
    body: string;
}

/** The session's start as an instant, in the zone of the device (a plan's times are the person's own wall-clock times). */
export const startOf = (s: Pick<StoredSession, "date" | "startTime">) => new Date(`${s.date}T${s.startTime}:00`);
export const endOf = (s: Pick<StoredSession, "date" | "endTime">) => new Date(`${s.date}T${s.endTime}:00`);
const minuteOfDay = (d: Date) => d.getHours() * 60 + d.getMinutes();
const dayOf = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * What the server should send, from the published plans only. A draft is on no schedule; a session that is done or
 * skipped has no reminder; one that has started has none either. A reminder that falls in quiet hours moves to when
 * they end, if that is still before the session; otherwise it is dropped (the in-app list still shows the session).
 * At most `dailyCap` a day, the earliest first.
 */
export function planReminders(plans: readonly StoredPlan[], prefs: ReminderPrefs, now: Date): PlannedReminder[] {
    if (prefs.leadMinutes === null) return [];
    const out: PlannedReminder[] = [];
    for (const plan of plans) {
        if (plan.state === "draft") continue;
        for (const s of plan.sessions) {
            if (s.status === "completed" || s.status === "skipped") continue;
            const start = startOf(s);
            let fire = new Date(start.getTime() - prefs.leadMinutes * 60_000);
            if (inQuiet(minuteOfDay(fire), prefs.quietStart, prefs.quietEnd)) {
                const moved = new Date(fire);
                moved.setHours(Math.floor(prefs.quietEnd / 60), prefs.quietEnd % 60, 0, 0);
                if (moved.getTime() < fire.getTime()) moved.setDate(moved.getDate() + 1);
                fire = moved;
            }
            if (fire.getTime() <= now.getTime() || fire.getTime() >= start.getTime()) continue;
            const w = wording(s, plan.subject, prefs.showDetails);
            out.push({ key: `${s.id}|${prefs.leadMinutes}|${s.date}T${s.startTime}`, sessionId: s.id, planId: plan.id, fireAt: fire.toISOString(), ...w });
        }
    }
    out.sort((a, b) => a.fireAt.localeCompare(b.fireAt));
    const perDay = new Map<string, number>();
    return out.filter((r) => {
        const d = dayOf(new Date(r.fireAt));
        const n = perDay.get(d) ?? 0;
        perDay.set(d, n + 1);
        return n < prefs.dailyCap;
    });
}

export interface SnoozeState {
    [sessionId: string]: { count: number; until: string };
}

export interface InAppItem {
    kind: "due" | "missed";
    planId: string;
    sessionId: string;
    subject: string;
    session: StoredSession;
    snoozes: number;
}

/**
 * What the app lists when it opens, with push on or off: sessions that are due now (the reminder time has passed and
 * the session has not ended) and sessions that ended without being marked. A snoozed session is hidden until its time.
 */
export function inAppItems(plans: readonly StoredPlan[], prefs: ReminderPrefs, now: Date, snoozed: SnoozeState = {}): InAppItem[] {
    const out: InAppItem[] = [];
    for (const plan of plans) {
        if (plan.state === "draft") continue;
        for (const s of plan.sessions) {
            if (s.status !== "pending") continue;
            const snooze = snoozed[s.id];
            if (snooze && new Date(snooze.until).getTime() > now.getTime()) continue;
            const ended = endOf(s).getTime() <= now.getTime();
            const lead = prefs.leadMinutes;
            const due = lead !== null && startOf(s).getTime() - lead * 60_000 <= now.getTime() && !ended;
            if (ended) out.push({ kind: "missed", planId: plan.id, sessionId: s.id, subject: plan.subject, session: s, snoozes: snooze?.count ?? 0 });
            else if (due) out.push({ kind: "due", planId: plan.id, sessionId: s.id, subject: plan.subject, session: s, snoozes: snooze?.count ?? 0 });
        }
    }
    return out.sort((a, b) => (a.session.date + a.session.startTime).localeCompare(b.session.date + b.session.startTime));
}

/** Snoozing again is refused after the third time. */
export function snoozeIn(state: SnoozeState, sessionId: string, minutes: number, now: Date): { ok: true; state: SnoozeState } | { ok: false; reason: "LIMIT" | "CHOICE" } {
    if (!(SNOOZE_CHOICES as readonly number[]).includes(minutes)) return { ok: false, reason: "CHOICE" };
    const count = state[sessionId]?.count ?? 0;
    if (count >= MAX_SNOOZES) return { ok: false, reason: "LIMIT" };
    return { ok: true, state: { ...state, [sessionId]: { count: count + 1, until: new Date(now.getTime() + minutes * 60_000).toISOString() } } };
}

/** What push can do on this device, and what the person should be told: never "guaranteed". */
export type PushSupport = "unsupported" | "needs-install" | "not-set-up" | "default" | "granted" | "denied" | "revoked";
export function pushSupport(env: { hasApis: boolean; permission: "default" | "granted" | "denied"; subscribed: boolean; serverReady: boolean; isIos: boolean; standalone: boolean; wasEnabled: boolean }): PushSupport {
    if (env.isIos && !env.standalone) return "needs-install";
    if (!env.hasApis) return "unsupported";
    if (!env.serverReady) return "not-set-up";
    if (env.permission === "denied") return "denied";
    if (env.permission === "granted") return env.subscribed ? "granted" : env.wasEnabled ? "revoked" : "default";
    return env.wasEnabled ? "revoked" : "default";
}
