import { describe, expect, test } from "vitest";
import { applyPlanDefaults, buildPlanInputs, emptyPlanForm, formFromParsed } from "./planForm.ts";
import type { ParsedDescription } from "../api/types.ts";

const parsed = (extra: Partial<ParsedDescription>): ParsedDescription => ({
    startDate: null, endDate: null, subject: "JS Essentials", materialAmount: null, goal: null, planMode: null,
    weeklyAvailability: [], commitments: [], sessionPreferenceMinutes: null, energy: null, difficulty: null, clarifyingQuestions: [], ...extra,
});

describe("a short description is enough for a plan", () => {
    test("no end date and no hours: starts today, runs four weeks, and the form is valid", () => {
        const form = applyPlanDefaults(formFromParsed(parsed({}), "2026-10-15"), "2026-10-15");
        expect(form.startDate).toBe("2026-10-15");
        expect(form.endDate).toBe("2026-11-11");
        expect(buildPlanInputs(form).ok).toBe(true);
    });

    test("two days named as free without hours get an evening window of the stated length", () => {
        const days = [{ day: "fri" as const, off: false, windows: [] }, { day: "sat" as const, off: false, windows: [] }];
        const form = applyPlanDefaults(formFromParsed(parsed({ weeklyAvailability: days }), "2026-10-15"), "2026-10-15");
        expect(form.days.fri.windows).toEqual([{ start: "17:00", end: "19:00" }]);
        expect(form.days.sat.windows).toEqual([{ start: "17:00", end: "19:00" }]);
        expect(form.days.mon.mode).toBe("unset");
        const built = buildPlanInputs(form);
        expect(built.ok).toBe(true);
    });

    test("what the person did say is kept", () => {
        const given = parsed({ startDate: "2026-10-20", endDate: "2026-10-30", sessionPreferenceMinutes: 45, weeklyAvailability: [{ day: "mon", off: false, windows: [{ start: "09:00", end: "10:30" }] }, { day: "tue", off: false, windows: [] }] });
        const form = applyPlanDefaults(formFromParsed(given, "2026-10-15"), "2026-10-15");
        expect([form.startDate, form.endDate]).toEqual(["2026-10-20", "2026-10-30"]);
        expect(form.days.mon.windows).toEqual([{ start: "09:00", end: "10:30" }]);
        expect(form.days.tue.windows).toEqual([{ start: "17:00", end: "18:00" }]);
    });

    test("without a subject there is still nothing to plan", () => {
        const form = applyPlanDefaults(formFromParsed(parsed({ subject: null }), "2026-10-15"), "2026-10-15");
        expect(buildPlanInputs(form).ok).toBe(false);
        expect(emptyPlanForm("2026-10-15").subject).toBe("");
    });
});
