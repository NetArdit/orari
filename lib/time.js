/* ==========================================
   TIME ENGINE
   All deterministic date / time / availability
   math lives here. The AI never has to do
   arithmetic - it only reasons about the
   free windows this module computes.
========================================== */

const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Default protected sleep window if the user never mentions sleep.
const DEFAULT_SLEEP = { start: "23:00", end: "07:00" };

// Absolute outer bound - we never schedule study outside this,
// even if a user's "availability" window technically covers it.
const DAY_START_FLOOR = "06:00";
const DAY_END_CEILING = "23:30";

// Sessions shorter than this are not worth proposing.
const MIN_USABLE_MINUTES = 20;

function timeToMinutes(t) {
    if (typeof t !== "string") return null;
    const m = t.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
    if (!m) return null;
    return Number(m[1]) * 60 + Number(m[2]);
}

function minutesToTime(mins) {
    const clamped = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(clamped / 60);
    const m = clamped % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function isValidDateStr(d) {
    if (typeof d !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
    // Date arithmetic rolls 31 February over into March instead of failing,
    // so a date is real only if it formats back to exactly what was given.
    const parsed = toUtcDate(d);
    return !Number.isNaN(parsed.getTime()) && formatUtcDate(parsed) === d;
}

// All date-string parsing/formatting is done in UTC on purpose: a plain
// "YYYY-MM-DD" has no timezone of its own, and mixing it with local-time
// Date methods (getDay, toISOString after local construction, etc.) shifts
// the date by a day whenever the server's timezone is ahead of UTC.
function toUtcDate(dateStr) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

function formatUtcDate(d) {
    return d.toISOString().slice(0, 10);
}

function weekdayOf(dateStr) {
    return WEEKDAYS[toUtcDate(dateStr).getUTCDay()];
}

function isValidTimeZone(timeZone) {
    if (typeof timeZone !== "string" || timeZone.length === 0) return false;
    try {
        new Intl.DateTimeFormat("en-CA", { timeZone });
        return true;
    } catch {
        return false;
    }
}

// The calendar date it is right now for someone in the given IANA time zone.
function localDateInZone(timeZone, instant) {
    return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

function addDays(dateStr, days) {
    const d = toUtcDate(dateStr);
    d.setUTCDate(d.getUTCDate() + days);
    return formatUtcDate(d);
}

// Whether a commitment begins on this date, by its weekday list and its date list.
function commitmentStartsOn(c, dateStr) {
    const appliesDate = !c.dates || c.dates.length === 0 || c.dates.includes(dateStr);
    const appliesDay = !c.days || c.days.length === 0 || c.days.includes(weekdayOf(dateStr));
    return appliesDate && appliesDay;
}

// Inclusive list of "YYYY-MM-DD" strings from start to end.
function dateRange(startStr, endStr) {
    const out = [];
    const start = toUtcDate(startStr);
    const end = toUtcDate(endStr);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return out;

    const cursor = new Date(start);
    let guard = 0;
    while (cursor <= end && guard < 400) {
        out.push(formatUtcDate(cursor));
        cursor.setUTCDate(cursor.getUTCDate() + 1);
        guard++;
    }
    return out;
}

// Turn a {start,end} (possibly crossing midnight, e.g. sleep 23:00-07:00)
// into one or two [startMin,endMin] intervals within a single 0-1440 day.
function intervalToRanges(win) {
    const s = timeToMinutes(win.start);
    const e = timeToMinutes(win.end);
    if (s === null || e === null) return [];
    if (e > s) return [[s, e]];
    if (e === s) return [];
    // crosses midnight: split into [s,1440] and [0,e]
    return [[s, 1440], [0, e]];
}

// Subtract a list of busy [s,e] ranges from a list of free [s,e] ranges.
function subtractRanges(freeRanges, busyRanges) {
    let result = freeRanges.map((r) => [...r]);

    for (const busy of busyRanges) {
        const next = [];
        for (const free of result) {
            const [fs, fe] = free;
            const [bs, be] = busy;

            if (be <= fs || bs >= fe) {
                // no overlap
                next.push(free);
                continue;
            }
            if (bs > fs) next.push([fs, Math.min(bs, fe)]);
            if (be < fe) next.push([Math.max(be, fs), fe]);
        }
        result = next.filter(([s, e]) => e - s > 0);
    }

    return result;
}

/**
 * Build the free study windows for a single date.
 *
 * @param {string} dateStr - "YYYY-MM-DD"
 * @param {Array} weeklyAvailability - [{day:"mon", windows:[{start,end}], off:false}]
 * @param {Array} commitments - [{label, days:["mon",...]|null, start, end, dates:[...]|null}]
 * @param {Array} unavailableDates - ["YYYY-MM-DD", ...] whole days off
 * @returns {Array<{start:string,end:string,minutes:number}>}
 */
function buildFreeWindowsForDate(dateStr, weeklyAvailability, commitments, unavailableDates) {
    const weekday = weekdayOf(dateStr);

    if (Array.isArray(unavailableDates) && unavailableDates.includes(dateStr)) {
        return [];
    }

    const dayEntry = (weeklyAvailability || []).find((d) => d.day === weekday);

    let baseRanges;
    if (dayEntry) {
        if (dayEntry.off) return [];
        baseRanges = (dayEntry.windows || []).flatMap(intervalToRanges);
    } else if (!weeklyAvailability || weeklyAvailability.length === 0) {
        // No availability info at all supplied -> assume a reasonable
        // default waking day, constraints will carve out the rest.
        baseRanges = intervalToRanges({ start: DAY_START_FLOOR, end: DAY_END_CEILING });
    } else {
        // Availability was specified for other days but not this one -> unavailable.
        return [];
    }

    // Always clip to the sane outer bounds.
    baseRanges = intersectWithBounds(baseRanges);

    // Busy intervals: explicit commitments + default sleep unless overridden.
    const busy = [];
    let sleepDefined = false;

    const previousDate = addDays(dateStr, -1);

    for (const c of commitments || []) {
        const startsToday = commitmentStartsOn(c, dateStr);
        const s = timeToMinutes(c.start);
        const e = timeToMinutes(c.end);
        if (s === null || e === null || s === e) continue;

        if (e > s) {
            if (startsToday) busy.push([s, e]);
        } else {
            // Crosses midnight: the evening part belongs to the day it starts on,
            // the morning part to the day after.
            if (startsToday) busy.push([s, 1440]);
            if (commitmentStartsOn(c, previousDate)) busy.push([0, e]);
        }

        if (c.type === "sleep" && startsToday) sleepDefined = true;
    }

    if (!sleepDefined) {
        for (const r of intervalToRanges(DEFAULT_SLEEP)) busy.push(r);
    }

    const free = subtractRanges(baseRanges, busy)
        .filter(([s, e]) => e - s >= MIN_USABLE_MINUTES)
        .sort((a, b) => a[0] - b[0]);

    return free.map(([s, e]) => ({
        start: minutesToTime(s),
        end: minutesToTime(e),
        minutes: e - s,
    }));
}

function intersectWithBounds(ranges) {
    const floor = timeToMinutes(DAY_START_FLOOR);
    const ceiling = timeToMinutes(DAY_END_CEILING);
    return subtractRanges(ranges, [
        [0, floor],
        [ceiling, 1440],
    ]);
}

/**
 * Build the full calendar of free windows between two dates.
 * Returns [{date, weekday, windows:[...], totalMinutes}]
 */
function buildCalendar(startDate, endDate, weeklyAvailability, commitments, unavailableDates) {
    return dateRange(startDate, endDate).map((date) => {
        const windows = buildFreeWindowsForDate(date, weeklyAvailability, commitments, unavailableDates);
        return {
            date,
            weekday: weekdayOf(date),
            windows,
            totalMinutes: windows.reduce((sum, w) => sum + w.minutes, 0),
        };
    });
}

function totalCapacityMinutes(calendar) {
    return calendar.reduce((sum, day) => sum + day.totalMinutes, 0);
}

// Check whether [start,end] on `date` fits fully inside one of that date's
// free windows. Used to validate AI-proposed sessions.
function fitsInWindow(date, start, end, calendar) {
    const day = calendar.find((d) => d.date === date);
    if (!day) return false;

    const s = timeToMinutes(start);
    const e = timeToMinutes(end);
    if (s === null || e === null || e <= s) return false;

    return day.windows.some((w) => {
        const ws = timeToMinutes(w.start);
        const we = timeToMinutes(w.end);
        return s >= ws && e <= we;
    });
}

export {
    WEEKDAYS,
    MIN_USABLE_MINUTES,
    DEFAULT_SLEEP,
    timeToMinutes,
    minutesToTime,
    isValidDateStr,
    isValidTimeZone,
    localDateInZone,
    weekdayOf,
    dateRange,
    buildFreeWindowsForDate,
    buildCalendar,
    totalCapacityMinutes,
    fitsInWindow,
};
