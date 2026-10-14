import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
    timeToMinutes,
    minutesToTime,
    isValidDateStr,
    weekdayOf,
    isValidTimeZone,
    localDateInZone,
    dateRange,
    buildFreeWindowsForDate,
    buildCalendar,
    clipDayFrom,
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
        assert.equal(timeToMinutes("24:00"), null);
        assert.equal(timeToMinutes("24:30"), null);
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
        assert.equal(isValidDateStr("2026-02-31"), false);
        assert.equal(isValidDateStr("2026-04-31"), false);
        assert.equal(isValidDateStr("2026-02-29"), false);
        assert.equal(isValidDateStr("2026-12-31"), true);
        assert.equal(isValidDateStr("2026-00-10"), false);
        assert.equal(isValidDateStr("14-10-2026"), false);
        assert.equal(isValidDateStr("2026-10-14T00:00"), false);
        assert.equal(isValidDateStr(null), false);
    });

    test("P1-13: the local date depends on the time zone, across midnight and summer time", () => {
        const lateEvening = new Date("2026-10-14T22:30:00Z"); // 00:30 on the 15th in Prishtina (UTC+2 in October)
        assert.equal(localDateInZone("Europe/Belgrade", lateEvening), "2026-10-15");
        assert.equal(localDateInZone("UTC", lateEvening), "2026-10-14");
        assert.equal(localDateInZone("America/New_York", lateEvening), "2026-10-14");
        assert.equal(localDateInZone("Pacific/Kiritimati", lateEvening), "2026-10-15");

        const winter = new Date("2026-01-14T23:30:00Z"); // UTC+1 in January: 00:30 on the 15th
        assert.equal(localDateInZone("Europe/Belgrade", winter), "2026-01-15");
        const winterEarlier = new Date("2026-01-14T22:30:00Z"); // 23:30 on the 14th
        assert.equal(localDateInZone("Europe/Belgrade", winterEarlier), "2026-01-14");
    });

    test("isValidTimeZone accepts IANA names and rejects everything else", () => {
        for (const zone of ["Europe/Belgrade", "Europe/Tirane", "UTC", "America/New_York"]) assert.equal(isValidTimeZone(zone), true, zone);
        for (const zone of ["Prishtina", "Europe/Nowhere", "", null, 2, "<script>"]) assert.equal(isValidTimeZone(zone), false, String(zone));
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

    test("P1-5: a commitment crossing midnight blocks the evening of its day and the morning of the next", () => {
        const sleep = { label: "Gjumë", type: "sleep", days: null, dates: null, start: "00:00", end: "06:00" };
        const shift = { label: "Ndërrimi i natës", type: "work", days: ["mon"], dates: null, start: "20:00", end: "10:00" };
        assert.deepEqual(windows("2026-10-11", [], [sleep, shift]), ["06:00-23:30"]); // Sunday: untouched
        assert.deepEqual(windows("2026-10-12", [], [sleep, shift]), ["06:00-20:00"]); // Monday: free until the shift starts
        assert.deepEqual(windows("2026-10-13", [], [sleep, shift]), ["10:00-23:30"]); // Tuesday: busy until the shift ends
        assert.deepEqual(windows("2026-10-14", [], [sleep, shift]), ["06:00-23:30"]); // Wednesday: untouched
    });

    test("P1-5: an overnight commitment on one date spills into the next date only", () => {
        const trip = [{ label: "Udhëtim", type: "other", days: null, dates: ["2026-10-14"], start: "21:00", end: "09:00" }];
        assert.deepEqual(windows("2026-10-14", [], trip), ["07:00-21:00"]);
        assert.deepEqual(windows("2026-10-15", [], trip), ["09:00-23:00"]);
        assert.deepEqual(windows("2026-10-16", [], trip), ["07:00-23:00"]);
    });

    test("an every-day overnight sleep commitment still blocks both ends of every day", () => {
        const sleep = [{ label: "Gjumë", type: "sleep", days: null, dates: null, start: "22:00", end: "08:00" }];
        assert.deepEqual(windows("2026-10-14", [], sleep), ["08:00-22:00"]);
    });

    test("a sleep commitment for one night leaves the default sleep in force on the day after", () => {
        const sleep = [{ label: "Gjumë", type: "sleep", days: ["mon"], dates: null, start: "22:00", end: "09:00" }];
        assert.deepEqual(windows("2026-10-12", [], sleep), ["06:00-22:00"]); // Monday: own sleep replaces the default
        assert.deepEqual(windows("2026-10-13", [], sleep), ["09:00-23:00"]); // Tuesday: Monday's sleep ends 09:00, default sleep from 23:00
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

    test("fitsInWindow judges position only; session length is sanitizeSessions' job", () => {
        const calendar = buildCalendar("2026-10-14", "2026-10-14", [], [], []);
        assert.equal(fitsInWindow("2026-10-14", "21:00", "21:05", calendar), true);
    });

    test("fitsInWindow rejects a session that spans two windows across a commitment", () => {
        const lunch = [{ label: "Drekë", type: "meal", days: null, dates: null, start: "12:00", end: "13:00" }];
        const calendar = buildCalendar("2026-10-14", "2026-10-14", [], lunch, []);
        assert.equal(fitsInWindow("2026-10-14", "11:30", "13:30", calendar), false);
    });
});

describe("today from now on (adjusting a plan part-way through the day)", () => {
    const dayWith = (...ranges) => {
        const availability = [{ day: "wed", off: false, windows: ranges.map(([start, end]) => ({ start, end })) }];
        const sleep = [{ label: "Gjumë", type: "sleep", days: null, dates: null, start: "00:00", end: "06:00" }];
        return buildCalendar("2026-10-14", "2026-10-14", availability, sleep, [])[0];
    };
    const clipped = (day, from) => clipDayFrom(day, from).windows.map((w) => `${w.start}-${w.end}`);
    const day = dayWith(["08:00", "10:00"], ["17:00", "19:00"]);

    test("before every window: nothing changes", () => {
        assert.deepEqual(clipped(day, "07:00"), ["08:00-10:00", "17:00-19:00"]);
        assert.deepEqual(clipped(day, "08:00"), ["08:00-10:00", "17:00-19:00"]);
        assert.deepEqual(clipDayFrom(day, "07:00"), day);
    });

    test("during a window: only what is left of it, with its minutes recounted", () => {
        const result = clipDayFrom(day, "08:45");
        assert.deepEqual(result.windows, [{ start: "08:45", end: "10:00", minutes: 75 }, { start: "17:00", end: "19:00", minutes: 120 }]);
        assert.equal(result.totalMinutes, 195);
        assert.deepEqual([result.date, result.weekday], ["2026-10-14", "wed"]);
    });

    test("what is left of a window must still be worth a session: 20 minutes stay, 19 go", () => {
        assert.deepEqual(clipped(day, "09:40"), ["09:40-10:00", "17:00-19:00"]);
        assert.deepEqual(clipped(day, "09:41"), ["17:00-19:00"]);
    });

    test("between windows, and exactly at the end of one: the earlier window is gone", () => {
        assert.deepEqual(clipped(day, "10:00"), ["17:00-19:00"]);
        assert.deepEqual(clipped(day, "13:00"), ["17:00-19:00"]);
    });

    test("after every window: the day has no free time left", () => {
        const result = clipDayFrom(day, "19:00");
        assert.deepEqual([result.windows, result.totalMinutes], [[], 0]);
        assert.deepEqual(clipDayFrom(day, "23:59").windows, []);
    });

    test("the day given is not changed, and a time that is not a time changes nothing", () => {
        const before = structuredClone(day);
        clipDayFrom(day, "18:00");
        assert.deepEqual(day, before);
        assert.deepEqual(clipDayFrom(day, "soon"), day);
    });
});

describe("what the engine tolerates and the schemas refuse", () => {
    test("an availability window ending before it starts is read as crossing midnight; the request schema rejects it first", () => {
        const reversed = [{ day: "wed", off: false, windows: [{ start: "20:00", end: "08:00" }] }];
        assert.deepEqual(windows("2026-10-14", reversed), ["07:00-08:00", "20:00-23:00"]);
    });
});
