/**
 * Reminders by Web Push, kept in PostgreSQL. Nothing here knows about plans: the browser, which holds the plans,
 * tells the server WHEN to remind and WHAT to say (generic by default), and the server sends it at that time to
 * the devices that subscribed. All rows belong to a user and go with the user (ON DELETE CASCADE).
 *
 * Rules (the owner's defaults): retry after 1, 5 and 30 minutes, at most 3 attempts, then the reminder is marked
 * failed and the app shows it; a subscription the push service answers 404 or 410 to is deleted; quiet hours and a
 * daily cap are enforced here as well as in the browser; a reminder can be snoozed at most 3 times.
 */
export const PUSH_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user ON push_subscriptions(user_id);

CREATE TABLE IF NOT EXISTS push_prefs (
    user_id     TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    quiet_start INTEGER NOT NULL DEFAULT 1320,
    quiet_end   INTEGER NOT NULL DEFAULT 480,
    daily_cap   INTEGER NOT NULL DEFAULT 5,
    tz          TEXT NOT NULL DEFAULT 'UTC'
);

CREATE TABLE IF NOT EXISTS push_reminders (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    key             TEXT NOT NULL,
    origin          TEXT NOT NULL CHECK (origin IN ('plan', 'snooze')),
    session_id      TEXT NOT NULL,
    fire_at         TIMESTAMPTZ NOT NULL,
    title           TEXT NOT NULL,
    body            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    attempts        INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL,
    snoozes         INTEGER NOT NULL DEFAULT 0,
    sent_at         TIMESTAMPTZ,
    UNIQUE (user_id, key)
);
CREATE INDEX IF NOT EXISTS push_reminders_due ON push_reminders(next_attempt_at) WHERE status = 'pending';
`;

export const BACKOFF_MINUTES = [1, 5, 30];
export const MAX_ATTEMPTS = 3;
export const MAX_SNOOZES = 3;
export const SNOOZE_CHOICES = [5, 10, 15];
export const MAX_REMINDERS_PER_SYNC = 500;

/** Minutes after local midnight in the given zone. */
export function minutesOfDay(date, tz) {
    try {
        const parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(date);
        const h = Number(parts.find((p) => p.type === "hour").value) % 24;
        return h * 60 + Number(parts.find((p) => p.type === "minute").value);
    } catch {
        return date.getUTCHours() * 60 + date.getUTCMinutes();
    }
}
export function inQuietHours(minutes, start, end) {
    return start === end ? false : start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}
export function localDay(date, tz) {
    try {
        return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
    } catch {
        return date.toISOString().slice(0, 10);
    }
}

/**
 * @param {{ pool: { query(t: string, v?: unknown[]): Promise<{rows: any[], rowCount: number}> }, sender: (subscription: {endpoint: string, keys: {p256dh: string, auth: string}}, payload: string) => Promise<void>, now?: () => Date, newId?: () => string }} deps
 *   sender throws an error with .statusCode when the push service refuses (404/410: the subscription is gone).
 */
export function createPushStore({ pool, sender, now = () => new Date(), newId = () => crypto.randomUUID() }) {
    const q = (t, v = []) => pool.query(t, v);
    return {
        async subscribe(userId, { endpoint, keys }) {
            if (typeof endpoint !== "string" || !/^https:\/\//.test(endpoint) || endpoint.length > 1000) return { ok: false, code: "VALIDATION" };
            if (typeof keys?.p256dh !== "string" || typeof keys?.auth !== "string" || keys.p256dh.length > 200 || keys.auth.length > 100) return { ok: false, code: "VALIDATION" };
            // The endpoint is unique: the same device subscribing again (or after someone else used it) is moved to this user.
            await q(
                `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (endpoint) DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
                [newId(), userId, endpoint, keys.p256dh, keys.auth],
            );
            return { ok: true };
        },
        async unsubscribe(userId, endpoint) {
            await q("DELETE FROM push_subscriptions WHERE user_id = $1 AND endpoint = $2", [userId, endpoint]);
            return { ok: true };
        },
        async setPrefs(userId, { quietStart, quietEnd, dailyCap, tz }) {
            const okMin = (n) => Number.isInteger(n) && n >= 0 && n < 1440;
            if (!okMin(quietStart) || !okMin(quietEnd) || !Number.isInteger(dailyCap) || dailyCap < 1 || dailyCap > 50 || typeof tz !== "string") return { ok: false, code: "VALIDATION" };
            try {
                new Intl.DateTimeFormat("en", { timeZone: tz });
            } catch {
                return { ok: false, code: "VALIDATION" };
            }
            await q(
                `INSERT INTO push_prefs (user_id, quiet_start, quiet_end, daily_cap, tz) VALUES ($1,$2,$3,$4,$5)
                 ON CONFLICT (user_id) DO UPDATE SET quiet_start = $2, quiet_end = $3, daily_cap = $4, tz = $5`,
                [userId, quietStart, quietEnd, dailyCap, tz],
            );
            return { ok: true };
        },

        /**
         * Replaces the user's planned reminders with this list. Reminders the browser no longer lists (the session was
         * done, deleted or moved) are cancelled, and so are snoozes of sessions that are no longer active. A reminder
         * already sent is never sent again: its key stays.
         */
        async sync(userId, reminders, activeSessionIds) {
            if (!Array.isArray(reminders) || reminders.length > MAX_REMINDERS_PER_SYNC || !Array.isArray(activeSessionIds)) return { ok: false, code: "VALIDATION" };
            const clean = [];
            for (const r of reminders) {
                const at = new Date(r?.fireAt);
                if (typeof r?.key !== "string" || r.key.length > 200 || typeof r.sessionId !== "string" || Number.isNaN(at.getTime())) return { ok: false, code: "VALIDATION" };
                clean.push({ key: r.key, sessionId: r.sessionId.slice(0, 100), fireAt: at.toISOString(), title: String(r.title ?? "Study session").slice(0, 80), body: String(r.body ?? "").slice(0, 160) });
            }
            // No transaction: a pool may hand each statement to another connection. Every statement is safe to repeat.
            {
                const keys = clean.map((r) => r.key);
                await q("UPDATE push_reminders SET status = 'cancelled' WHERE user_id = $1 AND origin = 'plan' AND status = 'pending' AND NOT (key = ANY($2::text[]))", [userId, keys]);
                for (const r of clean) {
                    await q(
                        `INSERT INTO push_reminders (id, user_id, key, origin, session_id, fire_at, title, body, next_attempt_at)
                         VALUES ($1,$2,$3,'plan',$4,$5,$6,$7,$5)
                         ON CONFLICT (user_id, key) DO UPDATE SET fire_at = EXCLUDED.fire_at, title = EXCLUDED.title, body = EXCLUDED.body,
                             next_attempt_at = EXCLUDED.fire_at, status = CASE WHEN push_reminders.status IN ('sent', 'failed') THEN push_reminders.status ELSE 'pending' END
                           WHERE push_reminders.status IN ('pending', 'cancelled') AND push_reminders.attempts = 0`,
                        [newId(), userId, r.key, r.sessionId, r.fireAt, r.title, r.body],
                    );
                }
                await q("UPDATE push_reminders SET status = 'cancelled' WHERE user_id = $1 AND origin = 'snooze' AND status = 'pending' AND NOT (session_id = ANY($2::text[]))", [userId, activeSessionIds.map(String)]);
            }
            return { ok: true, planned: clean.length };
        },

        /** Snoozes a reminder the user got: a new one a few minutes later, at most 3 times in all. */
        async snooze(userId, reminderId, minutes) {
            if (!SNOOZE_CHOICES.includes(minutes)) return { ok: false, code: "VALIDATION" };
            const base = (await q("SELECT * FROM push_reminders WHERE id = $1 AND user_id = $2", [String(reminderId), userId])).rows[0];
            if (!base) return { ok: false, code: "NOT_FOUND" };
            if (base.snoozes >= MAX_SNOOZES) return { ok: false, code: "SNOOZE_LIMIT" };
            const at = new Date(now().getTime() + minutes * 60_000).toISOString();
            const n = base.snoozes + 1;
            await q(
                `INSERT INTO push_reminders (id, user_id, key, origin, session_id, fire_at, title, body, next_attempt_at, snoozes)
                 VALUES ($1,$2,$3,'snooze',$4,$5,$6,$7,$5,$8) ON CONFLICT (user_id, key) DO NOTHING`,
                [newId(), userId, `${base.key.split("#s")[0]}#s${n}`, base.session_id, at, base.title, base.body, n],
            );
            return { ok: true, snoozes: n, at };
        },

        async status(userId) {
            const subs = (await q("SELECT count(*)::int n FROM push_subscriptions WHERE user_id = $1", [userId])).rows[0].n;
            const counts = (await q("SELECT status, count(*)::int n FROM push_reminders WHERE user_id = $1 GROUP BY status", [userId])).rows;
            const failed = (await q("SELECT session_id, fire_at FROM push_reminders WHERE user_id = $1 AND status = 'failed' ORDER BY fire_at DESC LIMIT 20", [userId])).rows;
            return { subscriptions: subs, counts: Object.fromEntries(counts.map((c) => [c.status, c.n])), failed: failed.map((f) => ({ sessionId: f.session_id, fireAt: new Date(f.fire_at).toISOString() })) };
        },

        /** Sends what is due. Called by the scheduled function. Returns what happened, for the log (no content). */
        async sendDue({ limit = 50 } = {}) {
            const due = (await q("SELECT * FROM push_reminders WHERE status = 'pending' AND next_attempt_at <= $1 ORDER BY next_attempt_at LIMIT $2", [now().toISOString(), limit])).rows;
            const out = { sent: 0, retried: 0, failed: 0, deferred: 0, dropped: 0 };
            for (const r of due) {
                const prefs = (await q("SELECT * FROM push_prefs WHERE user_id = $1", [r.user_id])).rows[0] ?? { quiet_start: 1320, quiet_end: 480, daily_cap: 5, tz: "UTC" };
                const t = now();
                if (inQuietHours(minutesOfDay(t, prefs.tz), prefs.quiet_start, prefs.quiet_end)) {
                    await q("UPDATE push_reminders SET next_attempt_at = $2 WHERE id = $1", [r.id, new Date(t.getTime() + 30 * 60_000).toISOString()]);
                    out.deferred++;
                    continue;
                }
                const today = localDay(t, prefs.tz);
                const sentToday = (await q("SELECT sent_at FROM push_reminders WHERE user_id = $1 AND status = 'sent' AND sent_at > $2", [r.user_id, new Date(t.getTime() - 36 * 3600_000).toISOString()])).rows.filter((x) => localDay(new Date(x.sent_at), prefs.tz) === today).length;
                if (sentToday >= prefs.daily_cap) {
                    // Over the day's cap: not sent, not retried. The in-app list still shows it.
                    await q("UPDATE push_reminders SET status = 'cancelled' WHERE id = $1", [r.id]);
                    out.dropped++;
                    continue;
                }
                const subs = (await q("SELECT * FROM push_subscriptions WHERE user_id = $1", [r.user_id])).rows;
                if (subs.length === 0) {
                    await q("UPDATE push_reminders SET status = 'cancelled' WHERE id = $1", [r.id]);
                    out.dropped++;
                    continue;
                }
                // The payload is the least that works: an id to ask about, and the generic (or chosen) text.
                const payload = JSON.stringify({ id: r.id, title: r.title, body: r.body, snoozes: r.snoozes });
                let delivered = 0;
                for (const s of subs) {
                    try {
                        await sender({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload);
                        delivered++;
                    } catch (error) {
                        if (error?.statusCode === 404 || error?.statusCode === 410) await q("DELETE FROM push_subscriptions WHERE id = $1", [s.id]);
                    }
                }
                if (delivered > 0) {
                    await q("UPDATE push_reminders SET status = 'sent', sent_at = $2, attempts = attempts + 1 WHERE id = $1", [r.id, t.toISOString()]);
                    out.sent++;
                } else if (r.attempts + 1 >= MAX_ATTEMPTS) {
                    await q("UPDATE push_reminders SET status = 'failed', attempts = attempts + 1 WHERE id = $1", [r.id]);
                    out.failed++;
                } else {
                    await q("UPDATE push_reminders SET attempts = attempts + 1, next_attempt_at = $2 WHERE id = $1", [r.id, new Date(t.getTime() + BACKOFF_MINUTES[r.attempts] * 60_000).toISOString()]);
                    out.retried++;
                }
            }
            // Old rows are not kept: what is sent, failed or cancelled and older than 7 days goes.
            await q("DELETE FROM push_reminders WHERE status <> 'pending' AND fire_at < now() - interval '7 days'");
            return out;
        },
    };
}
