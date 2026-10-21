/**
 * A plan as an iCalendar file (RFC 5545), so its sessions can be added to the calendar the person
 * already uses. Made on the device; nothing is sent anywhere.
 *
 * Times are written as "floating" local times (no time zone): a session at 08:00 is at 08:00 on the
 * wall clock wherever the calendar is opened, which is what a study timetable means.
 */
import { byTime } from "./clock.ts";
import type { StoredPlan, StoredSession } from "../storage/model.ts";

const CRLF = "\r\n";

/** RFC 5545 section 3.3.11: backslash, semicolon and comma are escaped; line breaks become \n. */
export function escapeText(value: string): string {
    return value.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r\n|\r|\n/g, "\\n");
}

/**
 * RFC 5545 section 3.1: lines longer than 75 octets are continued on the next line after a space.
 * Counted in UTF-8 bytes, never cutting a character in half (letters such as ë and ç take two bytes each).
 */
export function foldLine(line: string): string {
    const encoder = new TextEncoder();
    const parts: string[] = [];
    let current = "";
    let bytes = 0;
    for (const char of line) {
        const size = encoder.encode(char).length;
        // Continuation lines start with a space, which counts towards their 75.
        const limit = parts.length === 0 ? 75 : 74;
        if (bytes + size > limit) {
            parts.push(current);
            current = "";
            bytes = 0;
        }
        current += char;
        bytes += size;
    }
    parts.push(current);
    return parts.join(CRLF + " ");
}

/**
 * A session id as a UID. Ids come from storage and are not guaranteed to be tame: a line break in one
 * would start a new content line and let stored text inject calendar properties. Everything outside
 * letters, digits, dot, dash and underscore is replaced by its code point, which keeps different ids different.
 */
export function uidFor(sessionId: string): string {
    const safe = Array.from(sessionId, (char) => (/[A-Za-z0-9.-]/.test(char) ? char : `_${char.codePointAt(0)!.toString(16)}_`)).join("");
    return `${safe || "_"}@planifikuesi`;
}

const stamp = (date: string, time: string) => `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;

const utcStamp = (date: Date) => date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");

function description(session: StoredSession): string {
    const lines: string[] = [];
    if (session.goal) lines.push(session.goal);
    if (session.material) lines.push(`Material: ${session.material}`);
    for (const task of session.tasks) lines.push(`• ${task}`);
    return lines.join("\n");
}

export interface IcsOptions {
    /** When the file is made; goes into every event's DTSTAMP. */
    now: Date;
    /** Leave out sessions before this date (YYYY-MM-DD). Default: include all. */
    from?: string;
    /**
     * A calendar reminder (VALARM) this many minutes before each event, 0 = at the start; omitted or null = none.
     * It is an alarm inside the file: whether the calendar app honours it is up to that app, not to Orari.
     */
    reminderMinutes?: number | null;
}

/**
 * The sessions of a plan that are still to be done (not marked done or skipped), as one calendar file.
 * Each event's UID is built from the session's id, so importing a newer export of the same plan
 * updates the events instead of duplicating them.
 */
export function planToIcs(plan: Pick<StoredPlan, "id" | "subject" | "sessions">, options: IcsOptions): string {
    const sessions = plan.sessions
        .filter((s) => s.status === "pending" || s.status === "partial")
        .filter((s) => !options.from || s.date >= options.from)
        .sort(byTime);

    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Orari//Study planner//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${escapeText(plan.subject)}`];

    for (const session of sessions) {
        const details = description(session);
        lines.push(
            "BEGIN:VEVENT",
            `UID:${uidFor(session.id)}`,
            `DTSTAMP:${utcStamp(options.now)}`,
            `DTSTART:${stamp(session.date, session.startTime)}`,
            `DTEND:${stamp(session.date, session.endTime)}`,
            `SUMMARY:${escapeText(`${plan.subject}: ${session.title}`)}`,
            ...(details ? [`DESCRIPTION:${escapeText(details)}`] : []),
            ...(options.reminderMinutes === undefined || options.reminderMinutes === null
                ? []
                : ["BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Study session", `TRIGGER:${options.reminderMinutes === 0 ? "PT0S" : `-PT${options.reminderMinutes}M`}`, "END:VALARM"]),
            "END:VEVENT"
        );
    }

    lines.push("END:VCALENDAR");
    return lines.map(foldLine).join(CRLF) + CRLF;
}

/** A safe file name for the export, e.g. "matematike-orari.ics". */
export function icsFileName(subject: string): string {
    const base = subject
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 40);
    return `${base || "plani"}-orari.ics`;
}
