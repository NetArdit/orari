import { buildCalendar, clipDayFrom, fitsInWindow, dateRange, isValidDateStr, timeToMinutes, MIN_USABLE_MINUTES } from "./time.js";

/* =========================================
   BUILD CALENDAR (shared by create/adjust)
========================================= */

/**
 * @param {object} structured - the plan's inputs
 * @param {string} [fromDate] - plan from this date instead of the plan's start (adjusting a plan from today)
 * @param {string} [fromTime] - "HH:MM": on that first date, only time from here on is offered
 */
export function buildCalendarOrError(structured, fromDate, fromTime) {
    const start = fromDate || structured.startDate;

    if (!isValidDateStr(start) || !isValidDateStr(structured.endDate)) {
        return { code: "INVALID_DATES", error: "Datat e planit nuk janë valide." };
    }

    if (dateRange(start, structured.endDate).length === 0) {
        return { code: "DATES_REVERSED", error: "Data e fillimit duhet të jetë para datës së mbarimit." };
    }

    if (dateRange(start, structured.endDate).length > 180) {
        return { code: "PERIOD_TOO_LONG", error: "Periudha e planit është shumë e gjatë (maksimumi ~6 muaj)." };
    }

    const calendar = buildCalendar(
        start,
        structured.endDate,
        structured.weeklyAvailability,
        structured.commitments,
        structured.unavailableDates || []
    );

    // Adjusting at 18:00 must not offer this morning: what has passed today is not free time.
    if (fromDate && fromTime && calendar.length > 0) {
        calendar[0] = clipDayFrom(calendar[0], fromTime);
    }

    return { calendar };
}

/* =========================================
   VALIDATE / SANITIZE AI SESSIONS
   Deterministic safety net: an AI-proposed
   session is never trusted blindly. It is
   dropped if it falls outside the computed
   free windows, is too short to be useful,
   or overlaps a session that starts earlier.
   What is kept comes back in time order.
========================================= */

export function sanitizeSessions(sessions, calendar) {
    const kept = [];
    const dropped = [];

    const sortKey = (s) => `${s.date} ${s.startTime} ${s.endTime}`;
    const ordered = [...sessions].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));

    for (const session of ordered) {
        const start = timeToMinutes(session.startTime);
        const end = timeToMinutes(session.endTime);
        // Sessions are in start order and the kept ones do not overlap,
        // so only the last kept session can collide with this one.
        const previous = kept.at(-1);

        let reason = null;
        if (!fitsInWindow(session.date, session.startTime, session.endTime, calendar)) {
            reason = "outside_free_time";
        } else if (end - start < MIN_USABLE_MINUTES) {
            reason = "too_short";
        } else if (previous && previous.date === session.date && timeToMinutes(previous.endTime) > start) {
            reason = "overlap";
        }

        if (reason) {
            dropped.push(`${session.date} ${session.startTime}-${session.endTime} (${reason})`);
        } else {
            kept.push(session);
        }
    }

    return { kept, dropped };
}

export function computeStats(sessions) {
    let totalMinutes = 0;
    for (const s of sessions) {
        const [sh, sm] = s.startTime.split(":").map(Number);
        const [eh, em] = s.endTime.split(":").map(Number);
        totalMinutes += eh * 60 + em - (sh * 60 + sm);
    }
    return {
        totalSessions: sessions.length,
        totalMinutes,
        totalHours: Math.round((totalMinutes / 60) * 10) / 10,
    };
}
