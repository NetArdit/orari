import { describe, expect, test } from "vitest";
import { DEFAULT_PREFS, inAppItems, parsePrefs, planReminders, pushSupport, snoozeIn, validLead, wording } from "./reminders.ts";
import type { StoredPlan, StoredSession } from "../storage/model.ts";

const s = (id: string, date: string, start: string, end: string, status: StoredSession["status"] = "pending"): StoredSession => ({
    id, status, date, startTime: start, endTime: end, type: "learning", title: "Secret topic " + id, goal: "", tasks: [], material: null, difficulty: "medium",
});
const plan = (sessions: StoredSession[], state: StoredPlan["state"] = "published"): StoredPlan => ({
    id: "p", createdAt: "x", subject: "Biology", startDate: "2026-10-20", endDate: "2026-10-30", planMode: "general", strategy: "", explanations: [], warnings: [], structured: {}, sessions, state,
});
const at = (date: string, time: string) => new Date(`${date}T${time}:00`);
const prefs = (extra = {}) => ({ ...DEFAULT_PREFS, leadMinutes: 15, ...extra });

describe("what is planned", () => {
    const now = at("2026-10-20", "09:00");
    test("nothing without an explicit choice: the first-time default is no reminder", () => {
        expect(DEFAULT_PREFS.leadMinutes).toBeNull();
        expect(planReminders([plan([s("a", "2026-10-21", "17:00", "18:00")])], DEFAULT_PREFS, now)).toEqual([]);
    });
    test("a reminder at the lead time before the start, with a stable key", () => {
        const r = planReminders([plan([s("a", "2026-10-21", "17:00", "18:00")])], prefs(), now);
        expect(r).toHaveLength(1);
        expect(new Date(r[0]!.fireAt).getTime()).toBe(at("2026-10-21", "16:45").getTime());
        expect(planReminders([plan([s("a", "2026-10-21", "17:00", "18:00")])], prefs(), now)[0]!.key).toBe(r[0]!.key);
    });
    test("none for a draft, a done or skipped session, a session that has started, or a time that has passed", () => {
        expect(planReminders([plan([s("a", "2026-10-21", "17:00", "18:00")], "draft")], prefs(), now)).toEqual([]);
        expect(planReminders([plan([s("a", "2026-10-21", "17:00", "18:00", "completed"), s("b", "2026-10-21", "18:00", "19:00", "skipped")])], prefs(), now)).toEqual([]);
        expect(planReminders([plan([s("a", "2026-10-20", "08:00", "09:00")])], prefs(), now)).toEqual([]);
        expect(planReminders([plan([s("a", "2026-10-20", "09:05", "10:00")])], prefs({ leadMinutes: 15 }), now)).toEqual([]);
    });
    test("a reminder in quiet hours moves to when they end, if that is before the session; otherwise it is dropped", () => {
        const early = planReminders([plan([s("a", "2026-10-21", "08:30", "09:30")])], prefs({ leadMinutes: 60 }), now); // 07:30 is quiet
        expect(new Date(early[0]!.fireAt).getTime()).toBe(at("2026-10-21", "08:00").getTime());
        expect(planReminders([plan([s("a", "2026-10-21", "07:00", "07:30")])], prefs({ leadMinutes: 15 }), now)).toEqual([]);
    });
    test("at most the daily cap, the earliest first", () => {
        const many = ["09:00", "10:00", "11:00", "12:00"].map((t, i) => s("s" + i, "2026-10-21", t, t.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, "0"))));
        const r = planReminders([plan(many)], prefs({ leadMinutes: 5, dailyCap: 2 }), now);
        expect(r.map((x) => x.sessionId)).toEqual(["s0", "s1"]);
    });
    test("lead time is validated: presets, or 1 minute to 7 days", () => {
        for (const ok of [0, 5, 10, 15, 30, 60, 1440, 1, 10080, 45]) expect(validLead(ok)).toBe(true);
        for (const bad of [-1, 10081, 1.5, "5", NaN]) expect(validLead(bad)).toBe(false);
        expect(parsePrefs({ leadMinutes: 99999, quietStart: 5000 })).toEqual(DEFAULT_PREFS);
        expect(parsePrefs(null)).toEqual(DEFAULT_PREFS);
    });
});

describe("wording", () => {
    test("generic by default, from a small set, no subject and no title; details only when chosen", () => {
        const sess = s("a", "2026-10-21", "17:00", "18:00");
        const generic = wording(sess, "Biology", false);
        expect(JSON.stringify(generic)).not.toMatch(/Biology|Secret|17:00/);
        expect(wording(sess, "Biology", false)).toEqual(generic);
        const details = wording(sess, "Biology", true);
        expect(details.title).toBe("Biology at 17:00");
        expect(details.body).toContain("Secret topic");
    });
});

describe("the in-app list, which works with push off", () => {
    test("due, missed, nothing for drafts or done sessions; a snooze hides until its time", () => {
        const now = at("2026-10-21", "17:00");
        const p = plan([s("due", "2026-10-21", "17:10", "18:00"), s("missed", "2026-10-21", "08:00", "09:00"), s("later", "2026-10-22", "10:00", "11:00"), s("done", "2026-10-21", "09:00", "10:00", "completed")]);
        const items = inAppItems([p, plan([s("d", "2026-10-21", "17:05", "18:00")], "draft")], prefs(), now);
        expect(items.map((i) => [i.sessionId, i.kind])).toEqual([["missed", "missed"], ["due", "due"]]);
        const snoozed = snoozeIn({}, "due", 10, now);
        expect(snoozed.ok && inAppItems([p], prefs(), now, snoozed.state).map((i) => i.sessionId)).toEqual(["missed"]);
        expect(snoozed.ok && inAppItems([p], prefs(), at("2026-10-21", "17:11"), snoozed.state).map((i) => i.sessionId)).toContain("due");
    });
    test("a missed session is listed even with no reminder chosen; a due one is not", () => {
        const now = at("2026-10-21", "17:00");
        const items = inAppItems([plan([s("missed", "2026-10-21", "08:00", "09:00"), s("due", "2026-10-21", "17:10", "18:00")])], DEFAULT_PREFS, now);
        expect(items.map((i) => i.kind)).toEqual(["missed"]);
    });
    test("snooze: 5, 10 or 15 minutes, three times at most", () => {
        const now = new Date();
        expect(snoozeIn({}, "a", 7, now)).toEqual({ ok: false, reason: "CHOICE" });
        let state = {};
        for (let i = 0; i < 3; i++) {
            const r = snoozeIn(state, "a", 5, now);
            expect(r.ok).toBe(true);
            if (r.ok) state = r.state;
        }
        expect(snoozeIn(state, "a", 5, now)).toEqual({ ok: false, reason: "LIMIT" });
        expect(snoozeIn(state, "b", 5, now).ok).toBe(true);
    });
});

describe("what push can do on this device", () => {
    const base = { hasApis: true, permission: "default" as const, subscribed: false, serverReady: true, isIos: false, standalone: false, wasEnabled: false };
    test("every state is named", () => {
        expect(pushSupport(base)).toBe("default");
        expect(pushSupport({ ...base, hasApis: false })).toBe("unsupported");
        expect(pushSupport({ ...base, isIos: true })).toBe("needs-install");
        expect(pushSupport({ ...base, isIos: true, standalone: true })).toBe("default");
        expect(pushSupport({ ...base, serverReady: false })).toBe("not-set-up");
        expect(pushSupport({ ...base, permission: "denied" })).toBe("denied");
        expect(pushSupport({ ...base, permission: "granted", subscribed: true })).toBe("granted");
        expect(pushSupport({ ...base, permission: "granted", wasEnabled: true })).toBe("revoked");
        expect(pushSupport({ ...base, wasEnabled: true })).toBe("revoked");
    });
});
