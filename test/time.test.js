import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    timeToMinutes,
    minutesToTime,
    isValidDateStr,
    weekdayOf,
    dateRange,
    buildFreeWindowsForDate,
    buildCalendar,
    totalCapacityMinutes,
    fitsInWindow,
} from "../lib/time.js";

// 2026-10-12 is a Monday; 2026-10-14 a Wednesday; 2026-10-17 a Saturday.
const windows = (date, availability = [], commitments = [], unavailable = []) =>
    buildFreeWindowsForDate(date, availability, commitments, unavailable).map((w) => `${w.start}-${w.end}`);

describe("time helpers", () => {
    test("timeToMinutes parses HH:MM and rejects junk", () => {
        assert.equal(timeToMinutes("00:00"), 0);
        assert.equal(timeToMinutes("08:30"), 510);
        assert.equal(timeToMinutes("7:05"), 425);
        assert.equal(timeToMinutes("23:59"), 1439);
        assert.equal(timeToMinutes("29:00"), null);
        assert.equal(timeToMinutes("08:60"), null);
        assert.equal(timeToMinutes("abc"), null);
        assert.equal(timeToMinutes(830), null);
    });

    test("minutesToTime formats and wraps around a day", () => {
        assert.equal(minutesToTime(0), "00:00");
        assert.equal(minutesToTime(510), "08:30");
        assert.equal(minutesToTime(1440), "00:00");
        assert.equal(minutesToTime(-30), "23:30");
    });

    test("weekdayOf does not depend on the machine's timezone", () => {
        assert.equal(weekdayOf("2026-10-12"), "mon");
        assert.equal(weekdayOf("2026-10-14"), "wed");
        assert.equal(weekdayOf("2026-10-18"), "sun");
        assert.equal(weekdayOf("2028-02-29"), "tue");
    });

    test("isValidDateStr accepts real dates and rejects wrong shapes", () => {
        assert.equal(isValidDateStr("2026-10-14"), true);
        assert.equal(isValidDateStr("2028-02-29"), true);
        assert.equal(isValidDateStr("2026-13-01"), false);
        assert.equal(isValidDateStr("2026-00-10"), false);
        assert.equal(isValidDateStr("14-10-2026"), false);
        assert.equal(isValidDateStr("2026-10-14T00:00"), false);
        assert.equal(isValidDateStr(null), false);
    });

    test("dateRange is inclusive, crosses months and years, and is empty when reversed", () => {
        assert.deepEqual(dateRange("2026-10-14", "2026-10-14"), ["2026-10-14"]);
        assert.deepEqual(dateRange("2026-10-30", "2026-11-02"), ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
        assert.deepEqual(dateRange("2026-12-31", "2027-01-01"), ["2026-12-31", "2027-01-01"]);
        assert.deepEqual(dateRange("2028-02-28", "2028-03-01"), ["2028-02-28", "2028-02-29", "2028-03-01"]);
        assert.deepEqual(dateRange("2026-10-14", "2026-10-01"), []);
    });

    test("dateRange stops at 400 days", () => {
        assert.equal(dateRange("2026-01-01", "2027-06-30").length, 400);
    });
});

describe("free windows for one date", () => {
    test("with nothing supplied the day is open from the end of default sleep to its start", () => {
        assert.deepEqual(windows("2026-10-14"), ["07:00-23:00"]);
    });

    test("a sleep commitment replaces the default sleep, and the 06:00-23:30 bounds still hold", () => {
        const sleep = [{ label: "Gjumë", type: "sleep", days: null, dates: null, start: "01:00", end: "05:00" }];
        assert.deepEqual(windows("2026-10-14", [], sleep), ["06:00-23:30"]);
    });

    test("availability for some days closes the days that are not listed", () => {
        const onlySat = [{ day: "sat", off: false, windows: [{ start: "10:00", end: "12:00" }] }];
        assert.deepEqual(windows("2026-10-14", onlySat), []);
        assert.deepEqual(windows("2026-10-17", onlySat), ["10:00-12:00"]);
    });

    test("a day marked off has no windows even if windows are listed", () => {
        const off = [{ day: "wed", off: true, windows: [{ start: "10:00", end: "12:00" }] }];
        assert.deepEqual(windows("2026-10-14", off), []);
    });

    test("an unavailable date has no windows", () => {
        assert.deepEqual(windows("2026-10-14", [], [], ["2026-10-14"]), []);
        assert.deepEqual(windows("2026-10-15", [], [], ["2026-10-14"]), ["07:00-23:00"]);
    });

    test("default sleep cuts an availability window that runs late", () => {
        const late = [{ day: "wed", off: false, windows: [{ start: "21:00", end: "23:30" }] }];
        assert.deepEqual(windows("2026-10-14", late), ["21:00-23:00"]);
    });

    test("a commitment splits a window, and several windows stay sorted", () => {
        const avail = [{ day: "wed", off: false, windows: [{ start: "18:00", end: "22:00" }, { start: "08:00", end: "12:00" }] }];
        const lunch = [{ label: "Kafe", type: "other", days: null, dates: null, start: "09:00", end: "10:00" }];
        assert.deepEqual(windows("2026-10-14", avail, lunch), ["08:00-09:00", "10:00-12:00", "18:00-22:00"]);
    });

    test("a commitment limited to weekdays applies only on them", () => {
        const work = [{ label: "Punë", type: "work", days: ["mon", "tue"], dates: null, start: "09:00", end: "17:00" }];
        assert.deepEqual(windows("2026-10-12", [], work), ["07:00-09:00", "17:00-23:00"]);
        assert.deepEqual(windows("2026-10-14", [], work), ["07:00-23:00"]);
    });

    test("a commitment limited to dates applies only on them", () => {
        const exam = [{ label: "Provim", type: "school", days: null, dates: ["2026-10-14"], start: "10:00", end: "13:00" }];
        assert.deepEqual(windows("2026-10-14", [], exam), ["07:00-10:00", "13:00-23:00"]);
        assert.deepEqual(windows("2026-10-15", [], exam), ["07:00-23:00"]);
    });

    test("leftover windows under 20 minutes are discarded, exactly 20 is kept", () => {
        const avail = [{ day: "wed", off: false, windows: [{ start: "08:00", end: "09:00" }] }];
        const leaves19 = [{ label: "x", type: "other", days: null, dates: null, start: "08:19", end: "09:00" }];
        const leaves20 = [{ label: "x", type: "other", days: null, dates: null, start: "08:20", end: "09:00" }];
        assert.deepEqual(windows("2026-10-14", avail, leaves19), []);
        assert.deepEqual(windows("2026-10-14", avail, leaves20), ["08:00-08:20"]);
    });

    test("a commitment with identical start and end blocks nothing", () => {
        const zero = [{ label: "x", type: "other", days: null, dates: null, start: "10:00", end: "10:00" }];
        assert.deepEqual(windows("2026-10-14", [], zero), ["07:00-23:00"]);
    });
});

describe("calendar", () => {
    test("buildCalendar returns one entry per date with weekday and total minutes", () => {
        const work = [{ label: "Punë", type: "work", days: ["mon"], dates: null, start: "09:00", end: "17:00" }];
        const calendar = buildCalendar("2026-10-11", "2026-10-12", [], work, []);
        assert.deepEqual(calendar.map((d) => [d.date, d.weekday, d.totalMinutes]), [
            ["2026-10-11", "sun", 960],
            ["2026-10-12", "mon", 480],
        ]);
        assert.equal(totalCapacityMinutes(calendar), 1440);
    });

    test("fitsInWindow accepts sessions inside a window, including its exact edges", () => {
        const calendar = buildCalendar("2026-10-14", "2026-10-14", [{ day: "wed", off: false, windows: [{ start: "08:00", end: "10:00" }] }], [], []);
        assert.equal(fitsInWindow("2026-10-14", "08:00", "10:00", calendar), true);
        assert.equal(fitsInWindow("2026-10-14", "08:30", "09:30", calendar), true);
        assert.equal(fitsInWindow("2026-10-14", "07:59", "09:00", calendar), false);
        assert.equal(fitsInWindow("2026-10-14", "09:00", "10:01", calendar), false);
        assert.equal(fitsInWindow("2026-10-14", "09:00", "09:00", calendar), false);
        assert.equal(fitsInWindow("2026-10-14", "09:30", "09:00", calendar), false);
        assert.equal(fitsInWindow("2026-10-15", "08:00", "09:00", calendar), false);
    });

    test("fitsInWindow rejects a session that spans two windows across a commitment", () => {
        const lunch = [{ label: "Drekë", type: "meal", days: null, dates: null, start: "12:00", end: "13:00" }];
        const calendar = buildCalendar("2026-10-14", "2026-10-14", [], lunch, []);
        assert.equal(fitsInWindow("2026-10-14", "11:30", "13:30", calendar), false);
    });
});

/* Behaviour the audit identified as wrong (docs/agent-handoff/CLAUDE_REPORT.md). These tests record what
   the code does today so that the fix is a deliberate, visible change of the expectation. */
describe("KNOWN DEFECTS, to be reversed in Phase 1", () => {
    test("KNOWN DEFECT P0-3: impossible dates are accepted and moved to another date", () => {
        assert.equal(isValidDateStr("2026-02-31"), true);
        assert.deepEqual(dateRange("2026-02-31", "2026-02-31"), ["2026-03-03"]);
        assert.equal(isValidDateStr("2026-04-31"), true);
        assert.deepEqual(dateRange("2026-04-31", "2026-04-31"), ["2026-05-01"]);
    });

    test("KNOWN DEFECT P1-5: a commitment crossing midnight blocks the morning of its own day, not the next", () => {
        const sleep = { label: "Gjumë", type: "sleep", days: null, dates: null, start: "00:00", end: "06:00" };
        const shift = { label: "Ndërrimi i natës", type: "work", days: ["mon"], dates: null, start: "20:00", end: "10:00" };
        // Monday: 06:00-10:00 is blocked although the shift only starts at 20:00 that evening.
        assert.deepEqual(windows("2026-10-12", [], [sleep, shift]), ["10:00-20:00"]);
        // Tuesday: the shift ends at 10:00 that morning, yet the morning is offered for study.
        assert.deepEqual(windows("2026-10-13", [], [sleep, shift]), ["06:00-23:30"]);
    });

    test("KNOWN DEFECT P1-6: an availability window ending before it starts becomes two windows", () => {
        const reversed = [{ day: "wed", off: false, windows: [{ start: "20:00", end: "08:00" }] }];
        assert.deepEqual(windows("2026-10-14", reversed), ["07:00-08:00", "20:00-23:00"]);
    });

    test("KNOWN DEFECT P1-3: a five-minute session fits", () => {
        const calendar = buildCalendar("2026-10-14", "2026-10-14", [], [], []);
        assert.equal(fitsInWindow("2026-10-14", "21:00", "21:05", calendar), true);
    });

    test("KNOWN DEFECT P3: timeToMinutes accepts 24:30", () => {
        assert.equal(timeToMinutes("24:30"), 1470);
    });
});
