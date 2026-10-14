import { describe, expect, test } from "vitest";
import { addDays, clockFrom, daysBetween, durationMinutes, minutesOf } from "./clock.ts";
import type { Clock } from "./clock.ts";
import { currentPlan, needsReplan, nextSession, progressOf, sessionState, streakDays, todayAgenda } from "./progress.ts";
import { buildAdjustRequest, mergeReplan, planFromAnswer, progressSummaries } from "./replan.ts";
import { buildPlanInputs, emptyPlanForm, errorsAt, formFromParsed, normaliseTime, studyDatesIn } from "./planForm.ts";
import type { PlanFormState } from "./planForm.ts";
import { escapeText, foldLine, icsFileName, planToIcs, uidFor } from "./ics.ts";
import type { ParsedDescription, PlanAnswer } from "../api/types.ts";
import type { StoredPlan, StoredSession } from "../storage/model.ts";

// Wednesday 14 October 2026, 12:00.
const NOON: Clock = { today: "2026-10-14", minutes: 720 };
const at = (time: string, today = "2026-10-14"): Clock => ({ today, minutes: minutesOf(time) });

let counter = 0;
const session = (date: string, startTime: string, endTime: string, status: StoredSession["status"] = "pending", title = "Seancë"): StoredSession => ({
    id: `s${++counter}`, status, date, startTime, endTime, type: "learning", title, goal: "", tasks: [], material: null, difficulty: "medium",
});

const plan = (sessions: StoredSession[], overrides: Partial<StoredPlan> = {}): StoredPlan => ({
    id: "p1", createdAt: "2026-10-01T08:00:00.000Z", subject: "Matematikë", startDate: "2026-10-10", endDate: "2026-10-30", planMode: "exam",
    strategy: "E vjetra", explanations: [], warnings: [], structured: { startDate: "2026-10-10", endDate: "2026-10-30", subject: "Matematikë" }, sessions, ...overrides,
});

describe("clock", () => {
    test("the date and minute come from the device's local time, not from UTC", () => {
        // Built from local parts, so the test holds in any time zone.
        expect(clockFrom(new Date(2026, 9, 14, 0, 5))).toEqual({ today: "2026-10-14", minutes: 5 });
        expect(clockFrom(new Date(2026, 9, 14, 23, 59))).toEqual({ today: "2026-10-14", minutes: 1439 });
        expect(clockFrom(new Date(2026, 0, 1, 0, 0))).toEqual({ today: "2026-01-01", minutes: 0 });
    });

    test("durations, and date arithmetic across months, years and leap days", () => {
        expect(durationMinutes({ startTime: "08:00", endTime: "09:30" })).toBe(90);
        expect(durationMinutes({ startTime: "09:00", endTime: "08:00" })).toBe(0);
        expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
        expect(addDays("2027-01-01", -1)).toBe("2026-12-31");
        expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
        expect(daysBetween("2026-10-14", "2026-10-14")).toBe(0);
        expect(daysBetween("2026-10-14", "2026-11-14")).toBe(31);
        expect(daysBetween("2026-10-14", "2026-10-13")).toBe(-1);
        // Across the change to winter time on 25 October 2026 a day is still one day.
        expect(daysBetween("2026-10-24", "2026-10-26")).toBe(2);
    });
});

describe("where a session stands", () => {
    test("the person's mark always wins over the clock", () => {
        for (const date of ["2026-10-01", "2026-10-14", "2026-10-20"]) {
            expect(sessionState(session(date, "08:00", "09:00", "completed"), NOON)).toBe("done");
            expect(sessionState(session(date, "08:00", "09:00", "partial"), NOON)).toBe("partial");
            expect(sessionState(session(date, "08:00", "09:00", "skipped"), NOON)).toBe("skipped");
        }
    });

    test("an unmarked session: missed after its day, upcoming before it", () => {
        expect(sessionState(session("2026-10-13", "23:00", "23:30"), at("00:00"))).toBe("missed");
        expect(sessionState(session("2026-10-15", "00:00", "00:30"), at("23:59"))).toBe("upcoming");
    });

    test("an unmarked session today moves from upcoming to now to late by the minute", () => {
        const s = session("2026-10-14", "17:30", "18:30");
        expect(sessionState(s, at("17:29"))).toBe("upcoming");
        expect(sessionState(s, at("17:30"))).toBe("now");
        expect(sessionState(s, at("18:29"))).toBe("now");
        expect(sessionState(s, at("18:30"))).toBe("late");
        expect(sessionState(s, at("23:59"))).toBe("late");
        // Only once the day is over does it become missed.
        expect(sessionState(s, at("00:00", "2026-10-15"))).toBe("missed");
    });
});

describe("progress of a plan", () => {
    test("each session is counted in exactly one place", () => {
        const sessions = [
            session("2026-10-10", "08:00", "09:00", "completed"),
            session("2026-10-11", "08:00", "09:00", "partial"),
            session("2026-10-12", "08:00", "09:00", "skipped"),
            session("2026-10-13", "08:00", "09:00"), // missed
            session("2026-10-14", "08:00", "09:00"), // late: today, already over
            session("2026-10-14", "11:30", "12:30"), // now
            session("2026-10-16", "08:00", "09:30"), // upcoming
        ];
        const p = progressOf(sessions, NOON);
        expect(p).toMatchObject({ total: 7, done: 1, partial: 1, skipped: 1, missed: 1, remaining: 3 });
        expect(p.done + p.partial + p.skipped + p.missed + p.remaining).toBe(p.total);
    });

    test("minutes: done counts in full, partly done counts half, nothing else counts", () => {
        const sessions = [session("2026-10-10", "08:00", "09:00", "completed"), session("2026-10-11", "08:00", "08:45", "partial"), session("2026-10-12", "08:00", "09:00", "skipped"), session("2026-10-20", "08:00", "09:00")];
        const p = progressOf(sessions, NOON);
        expect([p.minutesPlanned, p.minutesStudied]).toEqual([225, 83]); // 60 + round(22.5)
    });

    test("completion is done plus half of partial over all sessions; an empty plan is 0, not NaN", () => {
        expect(progressOf([], NOON).completion).toBe(0);
        const sessions = [session("2026-10-10", "08:00", "09:00", "completed"), session("2026-10-11", "08:00", "09:00", "partial"), session("2026-10-20", "08:00", "09:00"), session("2026-10-21", "08:00", "09:00")];
        expect(progressOf(sessions, NOON).completion).toBe(0.375);
        expect(progressOf([session("2026-10-10", "08:00", "09:00", "completed")], NOON).completion).toBe(1);
    });

    test("a plan needs adjusting only if it has days left and an unmarked session whose day has passed", () => {
        const missed = session("2026-10-13", "08:00", "09:00");
        expect(needsReplan(plan([missed]), NOON)).toBe(true);
        expect(needsReplan(plan([missed], { endDate: "2026-10-14" }), NOON)).toBe(true); // last day
        expect(needsReplan(plan([missed], { endDate: "2026-10-13" }), NOON)).toBe(false); // over
        expect(needsReplan(plan([session("2026-10-13", "08:00", "09:00", "skipped")]), NOON)).toBe(false); // a decision, not a lapse
        expect(needsReplan(plan([session("2026-10-14", "08:00", "09:00")]), NOON)).toBe(false); // late today is not missed yet
    });
});

describe("streak", () => {
    const done = (date: string) => session(date, "08:00", "09:00", "completed");
    const open = (date: string) => session(date, "08:00", "09:00");

    test("no sessions, or nothing done: zero", () => {
        expect(streakDays([], NOON)).toBe(0);
        expect(streakDays([open("2026-10-13"), open("2026-10-14")], NOON)).toBe(0);
    });

    test("days in a row with study, counting partly done days too", () => {
        expect(streakDays([done("2026-10-12"), session("2026-10-13", "08:00", "09:00", "partial"), done("2026-10-14")], NOON)).toBe(3);
    });

    test("today does not break the streak while it is still going", () => {
        expect(streakDays([done("2026-10-12"), done("2026-10-13"), open("2026-10-14")], NOON)).toBe(2);
        expect(streakDays([done("2026-10-12"), done("2026-10-13")], NOON)).toBe(2);
    });

    test("a day with sessions planned and none done ends it", () => {
        expect(streakDays([done("2026-10-11"), open("2026-10-12"), done("2026-10-13"), done("2026-10-14")], NOON)).toBe(2);
        expect(streakDays([done("2026-10-11"), session("2026-10-12", "08:00", "09:00", "skipped"), done("2026-10-13")], NOON)).toBe(1);
    });

    test("a rest day with nothing planned neither counts nor ends it", () => {
        // Sunday the 11th is free: Saturday and Monday still join up.
        expect(streakDays([done("2026-10-09"), done("2026-10-10"), done("2026-10-12"), done("2026-10-13")], NOON)).toBe(4);
    });

    test("one done session is enough for a day; future sessions are ignored", () => {
        expect(streakDays([done("2026-10-14"), open("2026-10-14"), done("2026-10-15")], NOON)).toBe(1);
    });

    test("yesterday missed and nothing done today: zero", () => {
        expect(streakDays([done("2026-10-12"), open("2026-10-13"), open("2026-10-14")], NOON)).toBe(0);
    });
});

describe("today and next", () => {
    test("today's agenda holds everything dated today from every plan, in time order, with its state", () => {
        const a = plan([session("2026-10-14", "17:30", "18:30", "pending", "Derivatet"), session("2026-10-15", "08:00", "09:00")], { id: "a", subject: "Matematikë" });
        const b = plan([session("2026-10-14", "08:00", "08:45", "completed", "Formulat"), session("2026-10-14", "11:30", "12:30", "pending", "Lexim")], { id: "b", subject: "Kimi" });

        expect(todayAgenda([a, b], NOON).map((i) => [i.subject, i.session.title, i.state])).toEqual([
            ["Kimi", "Formulat", "done"],
            ["Kimi", "Lexim", "now"],
            ["Matematikë", "Derivatet", "upcoming"],
        ]);
        expect(todayAgenda([a, b], at("12:00", "2026-10-20"))).toEqual([]);
    });

    test("next is the session in progress if there is one", () => {
        const p = plan([session("2026-10-14", "11:30", "12:30", "pending", "Tani"), session("2026-10-14", "17:30", "18:30", "pending", "Më vonë")]);
        expect(nextSession([p], NOON)?.session.title).toBe("Tani");
    });

    test("otherwise the earliest that has not started, today or on a later day, across plans", () => {
        const a = plan([session("2026-10-14", "08:00", "09:00", "pending", "Vonë sot"), session("2026-10-16", "08:00", "09:00", "pending", "Të premten")], { id: "a" });
        const b = plan([session("2026-10-15", "07:00", "08:00", "pending", "Nesër herët")], { id: "b" });
        expect(nextSession([a, b], NOON)?.session.title).toBe("Nesër herët");
        expect(nextSession([a], NOON)?.session.title).toBe("Të premten");
    });

    test("marked sessions and ones already over are never next; nothing left gives null", () => {
        const p = plan([session("2026-10-14", "13:00", "14:00", "completed"), session("2026-10-14", "15:00", "16:00", "skipped"), session("2026-10-14", "08:00", "09:00"), session("2026-10-13", "08:00", "09:00")]);
        expect(nextSession([p], NOON)).toBeNull();
        expect(nextSession([], NOON)).toBeNull();
    });

    test("the current plan is the newest one that has not ended", () => {
        const ended = plan([], { id: "ended", endDate: "2026-10-13", createdAt: "2026-10-09T00:00:00.000Z" });
        const older = plan([], { id: "older", createdAt: "2026-10-01T00:00:00.000Z" });
        const newer = plan([], { id: "newer", createdAt: "2026-10-05T00:00:00.000Z" });
        expect(currentPlan([ended, older, newer], NOON)?.id).toBe("newer");
        expect(currentPlan([ended], NOON)).toBeNull();
    });
});

describe("adjusting a plan", () => {
    const answer = (sessions: StoredSession[]): Pick<PlanAnswer, "sessions" | "strategy" | "explanations" | "warnings"> => ({
        sessions: sessions.map((s) => ({ ...s, status: "pending" as const })), strategy: "E reja", explanations: ["Sepse"], warnings: ["Kujdes"],
    });

    test("the server is told what was done and what was missed, oldest first, with dates and marks", () => {
        const p = plan([
            session("2026-10-13", "08:00", "09:00", "pending", "E humbur"),
            session("2026-10-10", "08:00", "09:00", "completed", "E kryer"),
            session("2026-10-11", "08:00", "09:00", "partial", "Përgjysmë"),
            session("2026-10-12", "08:00", "09:00", "skipped", "E anashkaluar"),
            session("2026-10-14", "08:00", "09:00", "pending", "Vonë sot"),
            session("2026-10-16", "08:00", "09:00", "pending", "Në pritje"),
        ]);
        expect(progressSummaries(p, NOON)).toEqual({
            completed: ["2026-10-10 E kryer (completed)", "2026-10-11 Përgjysmë (partial)"],
            missed: ["2026-10-12 E anashkaluar", "2026-10-13 E humbur"],
        });
    });

    test("more lines than the server accepts: the 50 most recent are sent", () => {
        const many = Array.from({ length: 60 }, (_, i) => session(addDays("2026-08-01", i), "08:00", "09:00", "completed", `Nr ${i}`));
        const { completed } = progressSummaries(plan(many), NOON);
        expect(completed).toHaveLength(50);
        expect([completed[0], completed[49]]).toEqual(["2026-08-11 Nr 10 (completed)", "2026-09-29 Nr 59 (completed)"]);
    });

    test("the request carries the plan's own inputs, the profile and today", () => {
        const p = plan([session("2026-10-13", "08:00", "09:00")]);
        const request = buildAdjustRequest(p, { name: "Arta", educationLevel: "university" }, NOON);
        expect(request.profile).toEqual({ name: "Arta", educationLevel: "university" });
        expect(request.structured).toBe(p.structured);
        expect(request.progress).toMatchObject({ today: "2026-10-14", completedSessionSummaries: [], remainingMaterialNote: null });
    });

    test("merge: the past and everything marked is kept, unmarked sessions from today on are replaced", () => {
        const keep = [
            session("2026-10-10", "08:00", "09:00", "completed", "E kaluar, e kryer"),
            session("2026-10-13", "08:00", "09:00", "pending", "E kaluar, e humbur"),
            session("2026-10-14", "08:00", "09:00", "completed", "Sot, e kryer"),
            session("2026-10-14", "09:00", "10:00", "partial", "Sot, përgjysmë"),
            session("2026-10-14", "10:00", "11:00", "skipped", "Sot, e anashkaluar"),
            session("2026-10-17", "08:00", "09:00", "completed", "E ardhshme, e kryer para kohe"),
        ];
        const replace = [session("2026-10-14", "20:00", "21:00", "pending", "Sot, në pritje"), session("2026-10-16", "08:00", "09:00", "pending", "E ardhshme")];
        const fresh = [session("2026-10-15", "08:00", "09:00", "pending", "E re 1"), session("2026-10-14", "22:00", "22:30", "pending", "E re 2")];
        const before = plan([...keep, ...replace]);
        const frozen = structuredClone(before);

        const result = mergeReplan(before, answer(fresh), NOON);

        expect(result.plan.sessions.map((s) => s.title)).toEqual([
            "E kaluar, e kryer", "E kaluar, e humbur", "Sot, e kryer", "Sot, përgjysmë", "Sot, e anashkaluar", "E re 2", "E re 1", "E ardhshme, e kryer para kohe",
        ]);
        expect([result.replaced, result.added, result.alreadyOver]).toEqual([2, 2, 0]);
        expect(result.plan.sessions.filter((s) => keep.some((k) => k.id === s.id))).toEqual(keep);
        expect([result.plan.id, result.plan.createdAt, result.plan.structured, result.plan.strategy, result.plan.warnings]).toEqual(["p1", before.createdAt, before.structured, "E reja", ["Kujdes"]]);
        expect(before).toEqual(frozen); // the original is not changed
    });

    test("merge: new sessions always arrive unmarked, whatever the answer says", () => {
        const sneaky = { ...session("2026-10-15", "08:00", "09:00"), status: "completed" } as unknown as PlanAnswer["sessions"][number];
        const result = mergeReplan(plan([]), { sessions: [sneaky], strategy: "", explanations: [], warnings: [] }, NOON);
        expect(result.plan.sessions[0]?.status).toBe("pending");
    });

    test("merge: a new session whose id is already in the plan gets another id, so ticking one never ticks the other", () => {
        const kept = session("2026-10-10", "08:00", "09:00", "completed", "E vjetër");
        const clash = { ...session("2026-10-15", "08:00", "09:00", "pending", "E re"), id: kept.id };
        const offers = [kept.id, "fresh"];
        const result = mergeReplan(plan([kept]), answer([clash]), NOON, () => offers.shift() ?? "exhausted");
        expect(result.plan.sessions.map((s) => [s.title, s.id])).toEqual([["E vjetër", kept.id], ["E re", "fresh"]]);
    });

    test("merge: new sessions today that are already over are kept and counted, so the screen can say so", () => {
        const fresh = [session("2026-10-14", "08:00", "09:00"), session("2026-10-14", "11:00", "12:00"), session("2026-10-14", "12:00", "13:00"), session("2026-10-15", "08:00", "09:00")];
        expect(mergeReplan(plan([]), answer(fresh), NOON).alreadyOver).toBe(2);
    });

    test("a new plan from the server's answer: own id and time, sessions unmarked and in order, inputs kept", () => {
        const sessions = [session("2026-10-15", "08:00", "09:00"), session("2026-10-14", "08:00", "09:00")];
        const serverAnswer: PlanAnswer = {
            profile: { name: "Arta" }, subject: "Kimi", startDate: "2026-10-14", endDate: "2026-10-20", planMode: "exam", strategy: "S", explanations: ["E"], warnings: [],
            stats: { totalSessions: 2, totalMinutes: 120, totalHours: 2 }, sessions: sessions.map((s) => ({ ...s, status: "pending" as const })),
        };
        const inputs = { subject: "Kimi" };
        let n = 0;
        const made = planFromAnswer(serverAnswer, inputs, new Date("2026-10-14T10:00:00.000Z"), () => `id-${++n}`);

        expect(made).toMatchObject({ id: "id-1", createdAt: "2026-10-14T10:00:00.000Z", subject: "Kimi", startDate: "2026-10-14", endDate: "2026-10-20", planMode: "exam", strategy: "S", structured: inputs });
        expect(made.sessions.map((s) => s.date)).toEqual(["2026-10-14", "2026-10-15"]);
        expect("stats" in made).toBe(false);
    });
});

describe("the plan form", () => {
    const filled = (): PlanFormState => ({
        ...emptyPlanForm("2026-10-14"),
        subject: "  Matematikë ", material: "Kapitujt 3–5", goal: "Ta kaloj provimin", planMode: "exam", difficulty: "hard", endDate: "2026-10-30", sessionMinutes: 60,
    });
    const build = (change: (form: PlanFormState) => void) => {
        const form = filled();
        change(form);
        return buildPlanInputs(form);
    };
    const errorsOf = (change: (form: PlanFormState) => void) => {
        const result = build(change);
        return result.ok ? [] : result.errors;
    };

    test("an empty form starts today with nothing assumed", () => {
        const form = emptyPlanForm("2026-10-14");
        expect([form.startDate, form.endDate, form.planMode, form.difficulty, form.sessionMinutes]).toEqual(["2026-10-14", "", "general", "medium", null]);
        expect(Object.values(form.days).every((d) => d.mode === "unset" && d.windows.length === 0)).toBe(true);
    });

    test("a filled form becomes plan inputs; material and goal stay two separate things", () => {
        const result = buildPlanInputs(filled());
        expect(result).toEqual({
            ok: true,
            structured: {
                startDate: "2026-10-14", endDate: "2026-10-30", subject: "Matematikë", materialAmount: "Kapitujt 3–5", goal: "Ta kaloj provimin", planMode: "exam",
                weeklyAvailability: [], commitments: [], unavailableDates: [], sessionPreferenceMinutes: 60, energy: null, difficulty: "hard",
            },
        });
    });

    test("what is missing is said for each field at once, with the server's own paths", () => {
        const result = buildPlanInputs(emptyPlanForm("2026-10-14"));
        expect(result).toEqual({ ok: false, errors: [{ path: "structured.subject", message: "Plotëso këtë fushë." }, { path: "structured.endDate", message: "Plotëso këtë fushë." }] });
    });

    test("dates: impossible, reversed, and longer than 180 days", () => {
        expect(errorsOf((f) => (f.endDate = "2026-02-31"))).toEqual([{ path: "structured.endDate", message: "Data nuk është e vlefshme." }]);
        expect(errorsOf((f) => (f.endDate = "2026-10-13"))).toEqual([{ path: "structured.endDate", message: "Data e mbarimit duhet të jetë pas datës së fillimit." }]);
        expect(build((f) => (f.endDate = "2026-10-14")).ok).toBe(true); // one day
        expect(build((f) => (f.endDate = addDays("2026-10-14", 179))).ok).toBe(true); // exactly 180 days
        expect(errorsOf((f) => (f.endDate = addDays("2026-10-14", 180)))).toEqual([{ path: "structured.endDate", message: "Plani mund të zgjasë më së shumti 180 ditë." }]);
    });

    test("session length: 10 to 240 whole minutes, or no preference", () => {
        for (const ok of [10, 240, null]) expect(build((f) => (f.sessionMinutes = ok)).ok).toBe(true);
        for (const bad of [9, 241, 45.5]) expect(errorsOf((f) => (f.sessionMinutes = bad))[0]?.path).toBe("structured.sessionPreferenceMinutes");
    });

    test("free time: days set are sent, days left alone are not; times are tidied and windows sorted", () => {
        const result = build((f) => {
            f.days.mon = { mode: "free", windows: [{ start: "20:00", end: "21.30" }, { start: " 8:00", end: "10:00 " }] };
            f.days.sun = { mode: "off", windows: [{ start: "08:00", end: "09:00" }] };
        });
        expect(result.ok && result.structured.weeklyAvailability).toEqual([
            { day: "mon", off: false, windows: [{ start: "08:00", end: "10:00" }, { start: "20:00", end: "21:30" }] },
            { day: "sun", off: true, windows: [] },
        ]);
    });

    test("free time: each mistake is pinned to its own window", () => {
        const errors = errorsOf((f) => {
            f.days.mon = { mode: "free", windows: [{ start: "08:00", end: "10:00" }, { start: "abc", end: "" }, { start: "12:00", end: "11:00" }, { start: "09:00", end: "09:30" }] };
            f.days.tue = { mode: "free", windows: [] };
        });
        expect(errors).toEqual([
            { path: "structured.weeklyAvailability.0.windows.1.start", message: "Shkruaje orën në formatin 08:30." },
            { path: "structured.weeklyAvailability.0.windows.1.end", message: "Plotëso këtë fushë." },
            { path: "structured.weeklyAvailability.0.windows.2.end", message: "Koha e përfundimit duhet të jetë pas kohës së fillimit." },
            { path: "structured.weeklyAvailability.0.windows.3.start", message: "Kjo kohë mbivendoset me një tjetër në të njëjtën ditë." },
            { path: "structured.weeklyAvailability.1.windows", message: "Plotëso këtë fushë." },
        ]);
    });

    test("free time: windows that touch are fine; every day off leaves nothing to plan in", () => {
        expect(build((f) => (f.days.mon = { mode: "free", windows: [{ start: "08:00", end: "09:00" }, { start: "09:00", end: "10:00" }] })).ok).toBe(true);
        const errors = errorsOf((f) => {
            for (const day of Object.keys(f.days) as (keyof typeof f.days)[]) f.days[day] = { mode: "off", windows: [] };
        });
        expect(errors).toEqual([{ path: "structured.weeklyAvailability", message: "Të paktën një ditë duhet të mbetet për mësim." }]);
    });

    test("busy time: a night shift may cross midnight; days are chosen, not typed; every day means no day list", () => {
        const result = build((f) => {
            f.commitments = [
                { label: " Ndërrimi i natës ", kind: "work", days: ["tue", "mon"], start: "22:00", end: "6:00" },
                { label: "Gjumi", kind: "sleep", days: [], start: "23:00", end: "07:00" },
                { label: "Drekë", kind: "meal", days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], start: "12:00", end: "13:00" },
            ];
        });
        expect(result.ok && result.structured.commitments).toEqual([
            { label: "Ndërrimi i natës", type: "work", days: ["mon", "tue"], dates: null, start: "22:00", end: "06:00" },
            { label: "Gjumi", type: "sleep", days: null, dates: null, start: "23:00", end: "07:00" },
            { label: "Drekë", type: "meal", days: null, dates: null, start: "12:00", end: "13:00" },
        ]);
    });

    test("busy time: a half-filled row is an error, not something dropped in silence", () => {
        const errors = errorsOf((f) => (f.commitments = [{ label: "", kind: "other", days: [], start: "9", end: "09:00" }, { label: "Punë", kind: "work", days: [], start: "09:00", end: "09:00" }]));
        expect(errors).toEqual([
            { path: "structured.commitments.0.label", message: "Plotëso këtë fushë." },
            { path: "structured.commitments.0.start", message: "Shkruaje orën në formatin 08:30." },
            { path: "structured.commitments.1.end", message: "Fillimi dhe mbarimi nuk mund të jenë e njëjta orë." },
        ]);
    });

    test("days without study: real dates only, repeated ones once, sorted", () => {
        const result = build((f) => (f.unavailableDates = ["2026-10-20", "2026-10-16", "2026-10-20"]));
        expect(result.ok && result.structured.unavailableDates).toEqual(["2026-10-16", "2026-10-20"]);
        expect(errorsOf((f) => (f.unavailableDates = ["2026-10-16", "nesër"]))).toEqual([{ path: "structured.unavailableDates.1", message: "Data nuk është e vlefshme." }]);
    });

    test("a form that is valid field by field but leaves no day to study on is refused, on the availability control", () => {
        const noStudy = [{ path: "structured.weeklyAvailability", message: "Në këtë periudhë nuk mbetet asnjë ditë për mësim. Ndrysho datat, ditët e lira ose ditët pa mësim." }];
        const freeOn = (f: PlanFormState, day: "mon" | "sat") => (f.days[day] = { mode: "free", windows: [{ start: "08:00", end: "10:00" }] });

        // Wednesday 14 to Thursday 15 October, but only Saturday is free.
        expect(errorsOf((f) => { f.endDate = "2026-10-15"; freeOn(f, "sat"); })).toEqual(noStudy);
        // Every date of the plan is marked as a day without study.
        expect(errorsOf((f) => { f.endDate = "2026-10-16"; f.unavailableDates = ["2026-10-14", "2026-10-15", "2026-10-16"]; })).toEqual(noStudy);
        // The only free weekday in range is also a day without study.
        expect(errorsOf((f) => { f.endDate = "2026-10-20"; freeOn(f, "sat"); f.unavailableDates = ["2026-10-17"]; })).toEqual(noStudy);
        // The two days in range are both off.
        expect(errorsOf((f) => { f.endDate = "2026-10-15"; f.days.wed = { mode: "off", windows: [] }; f.days.thu = { mode: "off", windows: [] }; })).toEqual(noStudy);

        // One day left is enough.
        expect(build((f) => { f.endDate = "2026-10-17"; freeOn(f, "sat"); }).ok).toBe(true);
        expect(build((f) => { f.endDate = "2026-10-16"; f.unavailableDates = ["2026-10-14", "2026-10-15"]; }).ok).toBe(true);
    });

    test("counting possible study dates follows the server's rule for days that were not set", () => {
        const form = filled(); // 14 to 30 October: 17 dates
        expect(studyDatesIn(form)).toBe(17);
        form.days.sun = { mode: "off", windows: [] }; // one day set, so the unset ones are closed
        expect(studyDatesIn(form)).toBe(0);
        form.days.mon = { mode: "free", windows: [{ start: "08:00", end: "09:00" }] }; // Mondays 19 and 26
        expect(studyDatesIn(form)).toBe(2);
        form.unavailableDates = ["2026-10-19"];
        expect(studyDatesIn(form)).toBe(1);
    });

    test("the server agrees: the same inputs are refused there with NO_FREE_TIME", async () => {
        const { buildCalendarOrError } = await import("../../../lib/plan.js");
        // What the form would have sent for "only Saturday free, plan Wednesday to Thursday".
        const { calendar } = buildCalendarOrError({ startDate: "2026-10-14", endDate: "2026-10-15", weeklyAvailability: [{ day: "sat", off: false, windows: [{ start: "08:00", end: "10:00" }] }], commitments: [], unavailableDates: [] });
        expect(calendar?.every((day: { totalMinutes: number }) => day.totalMinutes === 0)).toBe(true);
    });

    test("energy is sent only if something was chosen", () => {
        const result = build((f) => (f.energy.morning = "high"));
        expect(result.ok && result.structured.energy).toEqual({ morning: "high", afternoon: null, evening: null });
    });

    test("limits: too many windows, commitments or dates are refused", () => {
        const window = { start: "08:00", end: "08:20" };
        expect(errorsOf((f) => (f.days.mon = { mode: "free", windows: Array.from({ length: 9 }, (_, i) => ({ start: `${String(8 + i).padStart(2, "0")}:00`, end: `${String(8 + i).padStart(2, "0")}:20` })) }))[0]).toEqual({ path: "structured.weeklyAvailability.0.windows", message: "Ke shtuar më shumë se sa lejohet." });
        expect(errorsOf((f) => (f.commitments = Array(41).fill({ label: "x", kind: "other", days: [], start: window.start, end: window.end })))[0]?.path).toBe("structured.commitments");
        expect(errorsOf((f) => (f.unavailableDates = Array.from({ length: 181 }, (_, i) => addDays("2026-10-14", i))))[0]?.path).toBe("structured.unavailableDates");
    });

    test("what the form produces is accepted by the server's own schema", async () => {
        const { CreatePlanBody } = await import("../../../lib/schema.js");
        const result = build((f) => {
            f.days.mon = { mode: "free", windows: [{ start: "8:00", end: "10:00" }] };
            f.days.sun = { mode: "off", windows: [] };
            f.commitments = [{ label: "Punë", kind: "work", days: ["mon"], start: "22:00", end: "06:00" }];
            f.unavailableDates = ["2026-10-20"];
            f.energy.evening = "low";
        });
        if (!result.ok) throw new Error("form should be valid");
        const parsed = CreatePlanBody.safeParse({ profile: { name: "Arta" }, structured: result.structured });
        expect(parsed.success).toBe(true);
        // And nothing is changed by the server's own normalisation: the form already sends the final shape.
        expect(parsed.success && parsed.data.structured).toEqual(result.structured);
    });

    test("pre-filled from what the AI read: everything it found is editable form state, nothing is invented", () => {
        const parsed: ParsedDescription = {
            startDate: null, endDate: "2026-10-30", subject: "JavaScript", materialAmount: "Kapitujt 1-3", goal: null, planMode: "skill",
            weeklyAvailability: [{ day: "mon", off: false, windows: [{ start: "08:00", end: "10:00" }] }, { day: "sun", off: true, windows: [] }],
            commitments: [{ label: "Puna", type: "work", days: ["mon", "tue"], dates: null, start: "10:00", end: "18:00" }, { label: "Gjumi", type: "sleep", days: null, dates: null, start: "23:00", end: "07:00" }],
            sessionPreferenceMinutes: 45, energy: { morning: "high", afternoon: null, evening: null }, difficulty: null, clarifyingQuestions: ["A ke pushim dreke?"],
        };
        const form = formFromParsed(parsed, "2026-10-14");

        expect([form.subject, form.material, form.goal, form.planMode, form.difficulty, form.startDate, form.endDate, form.sessionMinutes]).toEqual(["JavaScript", "Kapitujt 1-3", "", "skill", "medium", "2026-10-14", "2026-10-30", 45]);
        expect(form.days.mon).toEqual({ mode: "free", windows: [{ start: "08:00", end: "10:00" }] });
        expect(form.days.sun).toEqual({ mode: "off", windows: [] });
        expect(form.days.tue).toEqual({ mode: "unset", windows: [] });
        expect(form.commitments).toEqual([{ label: "Puna", kind: "work", days: ["mon", "tue"], start: "10:00", end: "18:00" }, { label: "Gjumi", kind: "sleep", days: [], start: "23:00", end: "07:00" }]);
        // Round trip: what the AI read, through the form, back to what the server expects.
        const built = buildPlanInputs(form);
        expect(built.ok && built.structured.weeklyAvailability).toEqual(parsed.weeklyAvailability);
        expect(built.ok && built.structured.commitments).toEqual(parsed.commitments);
        // Editing a copy must not reach back into the parsed answer.
        form.days.mon.windows[0]!.start = "09:00";
        expect(parsed.weeklyAvailability[0]?.windows[0]?.start).toBe("08:00");
    });

    test("times as people type them", () => {
        expect(["9:00", " 09:00 ", "9.05", "23:59", "0:00"].map(normaliseTime)).toEqual(["09:00", "09:00", "09:05", "23:59", "00:00"]);
        expect(["24:00", "9", "09:60", "nëntë", "", "9:5", "123:00"].map(normaliseTime)).toEqual([null, null, null, null, null, null, null]);
    });

    test("errors can be looked up for a control and everything beneath it", () => {
        const errors = [{ path: "structured.weeklyAvailability.0.windows.1.start", message: "A" }, { path: "structured.weeklyAvailability.1.windows", message: "B" }, { path: "structured.subject", message: "C" }, { path: "structured.subjectExtra", message: "D" }];
        expect(errorsAt(errors, "weeklyAvailability.0")).toEqual(["A"]);
        expect(errorsAt(errors, "weeklyAvailability")).toEqual(["A", "B"]);
        expect(errorsAt(errors, "subject")).toEqual(["C"]);
        expect(errorsAt(errors, "endDate")).toEqual([]);
    });
});

describe("calendar export", () => {
    const NOW = new Date("2026-10-14T10:00:00.000Z");
    const withDetails = { ...session("2026-10-15", "17:30", "18:30", "pending", "Derivatet; rregullat, bazë"), id: "abc", goal: "Rregullat\nbazë", material: "Kapitulli 4", tasks: ["Lexo faqet 84–91", "Zgjidh 1, 2, 3"] };

    test("text is escaped as the standard requires", () => {
        expect(escapeText("a;b,c\\d\ne\r\nf")).toBe("a\\;b\\,c\\\\d\\ne\\nf");
    });

    test("a session id cannot break out of its UID line, and different ids stay different", () => {
        expect(uidFor("3f2b9c1e-aaaa-4bbb-8ccc-0123456789ab")).toBe("3f2b9c1e-aaaa-4bbb-8ccc-0123456789ab@planifikuesi");
        expect(uidFor("s1")).toBe("s1@planifikuesi");
        const hostile = "x\r\nATTENDEE:mailto:someone@example.test\nSUMMARY:injected;a,b\\";
        const uid = uidFor(hostile);
        expect(uid).toMatch(/^[A-Za-z0-9._-]+@planifikuesi$/);
        expect(uid).not.toMatch(/[\r\n:;,\\ ]/);
        // Encoding is one-to-one: ids that differ only in an awkward character do not collide.
        expect(new Set(["a b", "a_b", "a-b", "a\nb", "a_20_b", "ab"].map(uidFor)).size).toBe(6);
        expect(uidFor("")).toBe("_@planifikuesi");

        const ics = planToIcs(plan([{ ...session("2026-10-15", "08:00", "09:00"), id: hostile }]), { now: new Date("2026-10-14T10:00:00.000Z") });
        const lines = ics.replace(/\r\n /g, "").split("\r\n");
        expect(lines.filter((l) => l.startsWith("ATTENDEE") || l === "SUMMARY:injected;a,b\\")).toEqual([]);
        expect(lines.filter((l) => l.startsWith("UID:"))).toHaveLength(1);
        expect(lines.filter((l) => l.startsWith("SUMMARY:"))).toHaveLength(1);
    });

    test("long lines are folded at 75 bytes without splitting a character", () => {
        const line = "SUMMARY:" + "ë".repeat(60); // 8 + 120 bytes
        const folded = foldLine(line);
        const pieces = folded.split("\r\n");
        const bytes = (s: string) => new TextEncoder().encode(s).length;
        expect(pieces.length).toBe(2);
        expect(pieces.every((p) => bytes(p) <= 75)).toBe(true);
        expect(pieces.slice(1).every((p) => p.startsWith(" "))).toBe(true);
        // Unfolding gives the original back exactly.
        expect(folded.replace(/\r\n /g, "")).toBe(line);
        expect(foldLine("SHORT")).toBe("SHORT");
        expect(foldLine("x".repeat(75))).toBe("x".repeat(75));
        expect(foldLine("x".repeat(76)).split("\r\n")).toEqual(["x".repeat(75), " x"]);
    });

    test("one event per session still to do, in time order, with local floating times", () => {
        const p = plan([
            session("2026-10-16", "08:00", "09:00", "pending", "E dyta"),
            session("2026-10-10", "08:00", "09:00", "completed", "E kryer"),
            session("2026-10-12", "08:00", "09:00", "skipped", "E anashkaluar"),
            session("2026-10-13", "08:00", "09:00", "partial", "Përgjysmë"),
            withDetails,
        ]);
        const ics = planToIcs(p, { now: NOW });
        const lines = ics.replace(/\r\n /g, "").split("\r\n");

        expect(lines.slice(0, 6)).toEqual(["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Planifikuesi//Orari i mesimit//SQ", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Matematikë"]);
        expect(lines.filter((l) => l.startsWith("SUMMARY:"))).toEqual(["SUMMARY:Matematikë: Përgjysmë", "SUMMARY:Matematikë: Derivatet\\; rregullat\\, bazë", "SUMMARY:Matematikë: E dyta"]);
        expect(lines).toContain("UID:abc@planifikuesi");
        expect(lines).toContain("DTSTAMP:20261014T100000Z");
        expect(lines).toContain("DTSTART:20261015T173000");
        expect(lines).toContain("DTEND:20261015T183000");
        expect(lines).toContain("DESCRIPTION:Rregullat\\nbazë\\nMateriali: Kapitulli 4\\n• Lexo faqet 84–91\\n• Zgjidh 1\\, 2\\, 3");
        expect(lines.at(-2)).toBe("END:VCALENDAR");
        expect(ics.endsWith("\r\n")).toBe(true);
        expect(ics.includes("\n") && !/[^\r]\n/.test(ics)).toBe(true); // CRLF only
        expect(lines.filter((l) => l === "BEGIN:VEVENT").length).toBe(lines.filter((l) => l === "END:VEVENT").length);
    });

    test("every physical line fits in 75 bytes, and a session without details has no DESCRIPTION", () => {
        const long = { ...withDetails, title: "Një titull shumë i gjatë me shkronja shqipe ë ç që e kalon gjatësinë e lejuar të një rreshti" };
        const ics = planToIcs(plan([long, session("2026-10-16", "08:00", "09:00")]), { now: NOW });
        for (const line of ics.split("\r\n")) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
        expect(ics.match(/DESCRIPTION:/g)).toHaveLength(1);
    });

    test("only from a given date on, if asked; an empty plan is still a valid empty calendar", () => {
        const p = plan([session("2026-10-13", "08:00", "09:00"), session("2026-10-15", "08:00", "09:00")]);
        expect(planToIcs(p, { now: NOW, from: "2026-10-14" }).match(/BEGIN:VEVENT/g)).toHaveLength(1);
        expect(planToIcs(plan([]), { now: NOW })).toBe("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Planifikuesi//Orari i mesimit//SQ\r\nCALSCALE:GREGORIAN\r\nMETHOD:PUBLISH\r\nX-WR-CALNAME:Matematikë\r\nEND:VCALENDAR\r\n");
    });

    test("file names are plain ASCII", () => {
        expect(icsFileName("Matematikë, kapitujt 3–5")).toBe("matematike-kapitujt-3-5-orari.ics");
        expect(icsFileName("Çka të mësoj?")).toBe("cka-te-mesoj-orari.ics");
        expect(icsFileName("???")).toBe("plani-orari.ics");
    });
});
