import { buildCalendar, fitsInWindow, dateRange, isValidDateStr } from "./time.js";

/* =========================================
   BUILD CALENDAR (shared by create/adjust)
========================================= */

export function buildCalendarOrError(structured, fromDate) {
    const start = fromDate || structured.startDate;

    if (!isValidDateStr(start) || !isValidDateStr(structured.endDate)) {
        return { error: "Datat e planit nuk janë valide." };
    }

    if (dateRange(start, structured.endDate).length === 0) {
        return { error: "Data e fillimit duhet të jetë para datës së mbarimit." };
    }

    if (dateRange(start, structured.endDate).length > 180) {
        return { error: "Periudha e planit është shumë e gjatë (maksimumi ~6 muaj)." };
    }

    const calendar = buildCalendar(
        start,
        structured.endDate,
        structured.weeklyAvailability,
        structured.commitments,
        structured.unavailableDates || []
    );

    return { calendar };
}

/* =========================================
   VALIDATE / SANITIZE AI SESSIONS
   Deterministic safety net: an AI-proposed
   session that falls outside the computed
   free windows is clipped or dropped, never
   trusted blindly.
========================================= */

export function sanitizeSessions(sessions, calendar) {
    const kept = [];
    const dropped = [];

    for (const session of sessions) {
        if (fitsInWindow(session.date, session.startTime, session.endTime, calendar)) {
            kept.push(session);
        } else {
            dropped.push(`${session.date} ${session.startTime}-${session.endTime}`);
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
