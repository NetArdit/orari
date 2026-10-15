import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { buildCalendarOrError, sanitizeSessions, computeStats } from "../lib/plan.js";
import { buildCalendar } from "../lib/time.js";
import { extractJsonPayload } from "../lib/ai.js";

const structured = (overrides = {}) => ({
    startDate: "2026-10-14",
    endDate: "2026-10-16",
    weeklyAvailability: [],
    commitments: [],
    unavailableDates: [],
    ...overrides,
});

const session = (date, startTime, endTime) => ({ date, startTime, endTime, type: "learning", title: "x" });

describe("buildCalendarOrError", () => {
    test("returns a calendar for a valid period", () => {
        const { calendar, error } = buildCalendarOrError(structured());
        assert.equal(error, undefined);
        assert.deepEqual(calendar.map((d) => d.date), ["2026-10-14", "2026-10-15", "2026-10-16"]);
    });

    test("a one-day plan is allowed", () => {
        assert.equal(buildCalendarOrError(structured({ endDate: "2026-10-14" })).calendar.length, 1);
    });

    test("fromDate replaces the start date (used when re-planning from today)", () => {
        const { calendar } = buildCalendarOrError(structured(), "2026-10-16");
        assert.deepEqual(calendar.map((d) => d.date), ["2026-10-16"]);
    });

    test("invalid dates, reversed dates and periods over 180 days give the safe Albanian message", () => {
        assert.equal(buildCalendarOrError(structured({ startDate: "2026-13-01" })).error, "The dates of the plan are not valid.");
        assert.equal(buildCalendarOrError(structured({ startDate: "2026-02-31", endDate: "2026-03-04" })).error, "The dates of the plan are not valid.");
        assert.equal(buildCalendarOrError(structured({ endDate: "2026-10-13" })).error, "The start date must be before the end date.");
        assert.equal(buildCalendarOrError(structured({ startDate: "2026-13-01" })).code, "INVALID_DATES");
        assert.equal(buildCalendarOrError(structured({ endDate: "2026-10-13" })).code, "DATES_REVERSED");
        assert.deepEqual(buildCalendarOrError(structured({ startDate: "2026-01-01", endDate: "2026-06-30" })), {
            code: "PERIOD_TOO_LONG",
            error: "The period of the plan is too long (at most about 6 months).",
        });
    });

    test("exactly 180 days is allowed", () => {
        // 2026-01-01 to 2026-06-29 inclusive is 180 days.
        assert.equal(buildCalendarOrError(structured({ startDate: "2026-01-01", endDate: "2026-06-29" })).calendar.length, 180);
    });

    test("with a time as well as a date, the first day starts at that time and the other days are whole", () => {
        const { calendar } = buildCalendarOrError(structured(), "2026-10-15", "18:30");
        assert.deepEqual(calendar.map((d) => [d.date, d.windows.map((w) => `${w.start}-${w.end}`), d.totalMinutes]), [
            ["2026-10-15", ["18:30-23:00"], 270],
            ["2026-10-16", ["07:00-23:00"], 960],
        ]);
    });

    test("a time without a start date is ignored: creating a plan always offers whole days", () => {
        const { calendar } = buildCalendarOrError(structured(), undefined, "18:30");
        assert.deepEqual(calendar[0].windows.map((w) => `${w.start}-${w.end}`), ["07:00-23:00"]);
    });

    test("missing unavailableDates is treated as none", () => {
        const input = structured();
        delete input.unavailableDates;
        assert.equal(buildCalendarOrError(input).calendar.length, 3);
    });
});

describe("sanitizeSessions", () => {
    const calendar = buildCalendar("2026-10-14", "2026-10-15", [], [], []); // 07:00-23:00 both days

    test("keeps sessions inside a free window, in time order, and lists the dropped ones with the reason", () => {
        const inside = session("2026-10-15", "08:00", "09:00");
        const edge = session("2026-10-14", "22:00", "23:00");
        const tooEarly = session("2026-10-14", "06:00", "07:30");
        const otherDay = session("2026-10-20", "08:00", "09:00");
        const reversed = session("2026-10-14", "10:00", "09:00");

        const { kept, dropped } = sanitizeSessions([inside, tooEarly, edge, otherDay, reversed], calendar);

        assert.deepEqual(kept, [edge, inside]);
        assert.deepEqual(dropped, [
            "2026-10-14 06:00-07:30 (outside_free_time)",
            "2026-10-14 10:00-09:00 (outside_free_time)",
            "2026-10-20 08:00-09:00 (outside_free_time)",
        ]);
    });

    test("P1-3: of overlapping or identical sessions only the earliest is kept", () => {
        const a = session("2026-10-14", "08:00", "10:00");
        const b = session("2026-10-14", "09:00", "11:00");
        const inside = session("2026-10-14", "08:30", "09:00");
        const later = session("2026-10-14", "11:00", "12:00");

        const { kept, dropped } = sanitizeSessions([later, b, a, inside, a], calendar);

        assert.deepEqual(kept, [a, later]);
        assert.deepEqual(dropped, [
            "2026-10-14 08:00-10:00 (overlap)",
            "2026-10-14 08:30-09:00 (overlap)",
            "2026-10-14 09:00-11:00 (overlap)",
        ]);
        assert.equal(computeStats(kept).totalMinutes, 180);
    });

    test("sessions that touch end to start, or sit at the same time on different days, are all kept", () => {
        const first = session("2026-10-14", "08:00", "09:00");
        const second = session("2026-10-14", "09:00", "10:00");
        const nextDay = session("2026-10-15", "08:00", "09:00");
        assert.deepEqual(sanitizeSessions([nextDay, second, first], calendar), { kept: [first, second, nextDay], dropped: [] });
    });

    test("P1-3: sessions under 20 minutes are dropped, exactly 20 is kept", () => {
        const nineteen = session("2026-10-14", "08:00", "08:19");
        const twenty = session("2026-10-14", "09:00", "09:20");
        const { kept, dropped } = sanitizeSessions([nineteen, twenty], calendar);
        assert.deepEqual(kept, [twenty]);
        assert.deepEqual(dropped, ["2026-10-14 08:00-08:19 (too_short)"]);
    });

    test("an empty list gives empty results", () => {
        assert.deepEqual(sanitizeSessions([], calendar), { kept: [], dropped: [] });
    });
});

describe("computeStats", () => {
    test("sums minutes and rounds hours to one decimal", () => {
        assert.deepEqual(computeStats([]), { totalSessions: 0, totalMinutes: 0, totalHours: 0 });
        assert.deepEqual(computeStats([session("d", "08:00", "09:00"), session("d", "20:00", "20:50")]), {
            totalSessions: 2,
            totalMinutes: 110,
            totalHours: 1.8,
        });
    });
});

describe("extractJsonPayload (model output is never trusted)", () => {
    test("plain JSON, fenced JSON and JSON with text around it", () => {
        assert.deepEqual(extractJsonPayload('{"a":1}'), { ok: true, data: { a: 1 } });
        assert.deepEqual(extractJsonPayload('```json\n{"a":1}\n```'), { ok: true, data: { a: 1 } });
        assert.deepEqual(extractJsonPayload('Ja plani:\n{"a":{"b":2}}\nSuksese!'), { ok: true, data: { a: { b: 2 } } });
    });

    test("empty, object-less and truncated answers are reported, not thrown", () => {
        assert.deepEqual(extractJsonPayload(""), { ok: false, error: "empty_response" });
        assert.deepEqual(extractJsonPayload(null), { ok: false, error: "empty_response" });
        assert.deepEqual(extractJsonPayload("nuk mundem"), { ok: false, error: "no_json_object" });
        assert.equal(extractJsonPayload('{"a":[1,2}').error, "malformed_json");
        assert.equal(extractJsonPayload('{"sessions":[{"date":"2026-10-14"').error, "no_json_object");
    });
});

