import { describe, expect, test } from "vitest";
import { capacityNeeded, DEFAULT_CAPACITY, publish, readCapacity, validatePlan } from "./validate.ts";
import { planToIcs } from "./ics.ts";
import { todayAgenda } from "./progress.ts";
import { clockFrom } from "./clock.ts";
import type { StoredPlan, StoredSession } from "../storage/model.ts";

const s = (id: string, date: string, start: string, end: string, difficulty: StoredSession["difficulty"] = "medium"): StoredSession => ({
    id, status: "pending", date, startTime: start, endTime: end, type: "learning", title: id, goal: "", tasks: [], material: null, difficulty,
});
// 2026-10-19 is a Monday.
const plan = (sessions: StoredSession[], structured: Record<string, unknown> = {}, extra: Partial<StoredPlan> = {}): StoredPlan => ({
    id: "p", createdAt: "2026-10-15T08:00:00.000Z", subject: "JS", startDate: "2026-10-19", endDate: "2026-11-01", planMode: "general", strategy: "", explanations: [], warnings: [], structured, sessions, state: "draft", ...extra,
});
const codes = (p: StoredPlan, c = DEFAULT_CAPACITY) => validatePlan(p, c).violations.map((v) => v.code);

describe("hard constraints block publishing", () => {
    test("a good plan has no violations", () => {
        expect(validatePlan(plan([s("a", "2026-10-19", "17:00", "18:00"), s("b", "2026-10-20", "17:00", "18:00")]))).toEqual({ violations: [], warnings: [] });
    });
    test("no sessions, overlap, duration, outside the plan dates", () => {
        expect(codes(plan([]))).toEqual(["NO_SESSIONS"]);
        expect(codes(plan([s("a", "2026-10-19", "17:00", "18:00"), s("b", "2026-10-19", "17:30", "18:15")]))).toContain("OVERLAP");
        expect(codes(plan([s("a", "2026-10-19", "17:00", "17:02")]))).toContain("DURATION");
        expect(codes(plan([s("a", "2026-10-19", "18:00", "17:00")]))).toContain("DURATION");
        expect(codes(plan([s("a", "2026-10-19", "08:00", "13:00")], {}, {}), { dailyMinutes: 999, weeklyMinutes: 9999 })).toContain("DURATION");
        expect(codes(plan([s("a", "2026-12-01", "17:00", "18:00")]))).toContain("OUTSIDE_PLAN");
    });
    test("availability: closed days and windows are respected; no availability means every day is open", () => {
        const avail = { weeklyAvailability: [{ day: "fri", off: false, windows: [{ start: "17:00", end: "19:00" }] }, { day: "sat", off: true, windows: [] }] };
        expect(codes(plan([s("a", "2026-10-23", "17:00", "18:00")], avail))).toEqual([]); // Friday, inside
        expect(codes(plan([s("a", "2026-10-23", "18:30", "19:30")], avail))).toContain("OUTSIDE_AVAILABILITY");
        expect(codes(plan([s("a", "2026-10-24", "17:00", "18:00")], avail))).toContain("OUTSIDE_AVAILABILITY"); // Saturday off
        expect(codes(plan([s("a", "2026-10-21", "17:00", "18:00")], avail))).toContain("OUTSIDE_AVAILABILITY"); // Wednesday not listed
        expect(codes(plan([s("a", "2026-10-21", "03:00", "04:00")]))).toEqual([]);
    });
    test("commitments, including one that passes midnight", () => {
        const work = { commitments: [{ label: "Work", days: ["mon"], start: "09:00", end: "17:00" }] };
        expect(codes(plan([s("a", "2026-10-19", "16:30", "17:30")], work))).toContain("COMMITMENT");
        expect(codes(plan([s("a", "2026-10-19", "17:00", "18:00")], work))).toEqual([]);
        expect(codes(plan([s("a", "2026-10-20", "10:00", "11:00")], work))).toEqual([]);
        const night = { commitments: [{ label: "Night shift", days: null, start: "22:00", end: "06:00" }] };
        expect(codes(plan([s("a", "2026-10-19", "05:00", "06:30")], night))).toContain("COMMITMENT");
        expect(codes(plan([s("a", "2026-10-19", "23:00", "23:30")], night))).toContain("COMMITMENT");
        expect(codes(plan([s("a", "2026-10-19", "12:00", "13:00")], night))).toEqual([]);
        const dated = { commitments: [{ label: "Exam", days: null, dates: ["2026-10-21"], start: "09:00", end: "12:00" }] };
        expect(codes(plan([s("a", "2026-10-21", "10:00", "11:00")], dated))).toContain("COMMITMENT");
        expect(codes(plan([s("a", "2026-10-22", "10:00", "11:00")], dated))).toEqual([]);
    });
    test("daily and weekly capacity, with the limits the person set", () => {
        const three = plan([s("a", "2026-10-19", "09:00", "10:00"), s("b", "2026-10-19", "11:00", "12:00"), s("c", "2026-10-19", "13:00", "14:00")]);
        expect(codes(three)).toEqual(["DAILY_CAPACITY"]);
        expect(codes(three, { dailyMinutes: 180, weeklyMinutes: 600 })).toEqual([]);
        const week = plan(["19", "20", "21", "22", "23", "24"].flatMap((d) => [s(`a${d}`, `2026-10-${d}`, "09:00", "10:00"), s(`b${d}`, `2026-10-${d}`, "11:00", "12:00")]));
        expect(codes(week)).toEqual(["WEEKLY_CAPACITY"]);
        expect(codes(week, { dailyMinutes: 120, weeklyMinutes: 720 })).toEqual([]);
        // Sunday and the next Monday are different weeks
        const split = plan([s("a", "2026-10-25", "09:00", "10:00"), s("b", "2026-10-26", "09:00", "10:00")]);
        expect(codes(split, { dailyMinutes: 120, weeklyMinutes: 60 })).toEqual([]);
        expect(capacityNeeded(three)).toEqual({ dailyMinutes: 180, weeklyMinutes: 180 });
    });
    test("rest rules are warnings, not blocks", () => {
        const v = validatePlan(plan([s("a", "2026-10-19", "09:00", "10:00", "hard"), s("b", "2026-10-19", "10:05", "10:35", "hard")]), { dailyMinutes: 600, weeklyMinutes: 6000 });
        expect(v.violations).toEqual([]);
        expect(v.warnings.map((w) => w.code)).toEqual(["BREAK"]);
        const run = validatePlan(plan([s("a", "2026-10-19", "09:00", "09:30", "hard"), s("b", "2026-10-19", "10:00", "10:30", "hard"), s("c", "2026-10-19", "11:00", "11:30", "hard")]), { dailyMinutes: 600, weeklyMinutes: 6000 });
        expect(run.warnings.map((w) => w.code)).toEqual(["INTENSIVE_RUN"]);
    });
    test("daylight saving: dates, not clock times, decide the day and the week (the last Sunday of October)", () => {
        const p = plan([s("a", "2026-10-25", "02:30", "03:30"), s("b", "2026-10-25", "04:00", "05:00")], {}, { startDate: "2026-10-25", endDate: "2026-10-26" });
        expect(codes(p)).toEqual([]);
    });
});

describe("publishing", () => {
    test("a valid draft is published once; publishing again changes nothing", () => {
        const draft = plan([s("a", "2026-10-19", "17:00", "18:00")]);
        const first = publish(draft, DEFAULT_CAPACITY, new Date("2026-10-16T10:00:00Z"));
        expect(first.ok && first.plan.state).toBe("published");
        expect(first.ok && first.plan.publishedAt).toBe("2026-10-16T10:00:00.000Z");
        const second = first.ok ? publish(first.plan, DEFAULT_CAPACITY, new Date("2026-10-17T10:00:00Z")) : null;
        expect(second && second.ok && second.plan).toBe(first.ok ? first.plan : null);
    });
    test("an invalid draft is refused and stays a draft", () => {
        const draft = plan([s("a", "2026-10-19", "17:00", "18:00"), s("b", "2026-10-19", "17:30", "18:30")]);
        const r = publish(draft, DEFAULT_CAPACITY, new Date());
        expect(r.ok).toBe(false);
        expect(draft.state).toBe("draft");
    });
    test("a draft is on no agenda and in no calendar file; a published plan is", () => {
        const draft = plan([s("a", "2026-10-19", "17:00", "18:00")]);
        const clock = clockFrom(new Date("2026-10-19T10:00:00"));
        expect(todayAgenda([draft], clock)).toHaveLength(0);
        expect(todayAgenda([{ ...draft, state: "published" }], clock)).toHaveLength(1);
    });
});

describe("calendar reminder (an alarm inside the file)", () => {
    const p = plan([s("a", "2026-10-19", "17:00", "18:00")], {}, { state: "published" });
    const now = new Date("2026-10-16T10:00:00Z");
    test("no reminder by default; a lead time adds one VALARM per event; at-start is PT0S", () => {
        expect(planToIcs(p, { now })).not.toContain("VALARM");
        expect(planToIcs(p, { now, reminderMinutes: 30 })).toContain("TRIGGER:-PT30M");
        expect(planToIcs(p, { now, reminderMinutes: 0 })).toContain("TRIGGER:PT0S");
        expect(planToIcs(p, { now, reminderMinutes: 1440 }).match(/BEGIN:VALARM/g)).toHaveLength(1);
        expect(planToIcs(p, { now, reminderMinutes: 15 })).toBe(planToIcs(p, { now, reminderMinutes: 15 })); // same UID: a second export updates, not duplicates
    });
});

describe("the person's limits", () => {
    const mem = (v?: string) => ({ getItem: () => v ?? null, setItem: () => undefined });
    test("defaults when nothing or junk is stored", () => {
        expect(readCapacity(null)).toEqual(DEFAULT_CAPACITY);
        expect(readCapacity(mem("not json"))).toEqual(DEFAULT_CAPACITY);
        expect(readCapacity(mem('{"dailyMinutes":-5,"weeklyMinutes":10}'))).toEqual(DEFAULT_CAPACITY);
        expect(readCapacity(mem('{"dailyMinutes":180,"weeklyMinutes":900}'))).toEqual({ dailyMinutes: 180, weeklyMinutes: 900 });
    });
});
