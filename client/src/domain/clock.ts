/**
 * "Now" as the planner needs it: the person's calendar date and the minute of their day.
 * Plans are made of dates and times of day without a time zone, so everything is compared
 * in the device's own local time. Functions take a Clock instead of reading the system time,
 * which keeps every rule testable at any moment, including one minute before midnight.
 */
export interface Clock {
    /** YYYY-MM-DD in the device's local time. */
    today: string;
    /** Minutes since local midnight, 0 to 1439. */
    minutes: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

export function clockFrom(date: Date): Clock {
    return {
        today: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
        minutes: date.getHours() * 60 + date.getMinutes(),
    };
}

/** "08:30" to 510. Times in stored plans are always zero-padded HH:MM. */
export function minutesOf(time: string): number {
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

/** 510 to "08:30". */
export function timeOf(minutes: number): string {
    return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function durationMinutes(session: { startTime: string; endTime: string }): number {
    return Math.max(0, minutesOf(session.endTime) - minutesOf(session.startTime));
}

/** The date `days` after (or before) a YYYY-MM-DD date. Pure calendar arithmetic, no time zone involved. */
export function addDays(date: string, days: number): string {
    const [y, m, d] = date.split("-").map(Number) as [number, number, number];
    const shifted = new Date(Date.UTC(y, m - 1, d + days));
    return shifted.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`; negative when `to` is earlier. */
export function daysBetween(from: string, to: string): number {
    const utc = (date: string) => {
        const [y, m, d] = date.split("-").map(Number) as [number, number, number];
        return Date.UTC(y, m - 1, d);
    };
    return Math.round((utc(to) - utc(from)) / 86_400_000);
}

/** Orders sessions by date, then start time, then end time. */
export function byTime(a: { date: string; startTime: string; endTime: string }, b: { date: string; startTime: string; endTime: string }): number {
    return a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.endTime.localeCompare(b.endTime);
}
