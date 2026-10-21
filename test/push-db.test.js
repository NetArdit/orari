/** Reminders by Web Push against a real PostgreSQL (npm run test:pg), with a fake push service. */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createPushStore, inQuietHours, minutesOfDay, PUSH_SCHEMA_SQL } from "../lib/pushDb.js";
import { startPostgres } from "./helpers/embeddedPg.js";

const PG = process.env.ORARI_PG === "1" || process.env.npm_lifecycle_event === "test:pg";

test("quiet hours, also across midnight, and the local minute in a time zone", () => {
    assert.equal(inQuietHours(23 * 60, 1320, 480), true);
    assert.equal(inQuietHours(7 * 60, 1320, 480), true);
    assert.equal(inQuietHours(8 * 60, 1320, 480), false);
    assert.equal(inQuietHours(12 * 60, 1320, 480), false);
    assert.equal(inQuietHours(5, 600, 600), false);
    assert.equal(minutesOfDay(new Date("2026-10-25T00:30:00Z"), "Europe/Belgrade"), 2 * 60 + 30); // the night the clocks go back
    assert.equal(minutesOfDay(new Date("2026-10-25T01:30:00Z"), "Europe/Belgrade"), 2 * 60 + 30);
});

describe("web push store", { skip: !PG }, () => {
    let db;
    let clock;
    let calls;
    let behaviour;
    let store;
    const sub = (n) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "p".repeat(40), auth: "a".repeat(16) } });
    const NOON = "2026-10-20T10:00:00Z"; // 12:00 in Belgrade, outside quiet hours
    before(async () => {
        db = await startPostgres();
        await db.pool.query(PUSH_SCHEMA_SQL);
    });
    after(async () => db?.stop());
    const fresh = async () => {
        await db.pool.query("TRUNCATE users, push_subscriptions, push_prefs, push_reminders CASCADE");
        for (const id of ["u1", "u2"]) await db.pool.query("INSERT INTO users (id, email, password_hash, name, data, created_at) VALUES ($1,$2,'h','n','{}','x')", [id, id + "@x.test"]);
        clock = new Date(NOON);
        calls = [];
        behaviour = async () => undefined;
        store = createPushStore({ pool: db.pool, now: () => clock, sender: async (s, payload) => { calls.push({ endpoint: s.endpoint, payload: JSON.parse(payload) }); await behaviour(s); } });
    };
    const reminder = (key, minutesAgo = 1, sessionId = "s1") => ({ key, sessionId, fireAt: new Date(clock.getTime() - minutesAgo * 60_000).toISOString(), title: "Study time", body: "A session starts soon." });
    const setup = async (user = "u1", tz = "Europe/Belgrade") => {
        await store.subscribe(user, sub(user));
        await store.setPrefs(user, { quietStart: 1320, quietEnd: 480, dailyCap: 5, tz });
    };

    test("a due reminder is sent once to the device, with only an id and the text; running again sends nothing", async () => {
        await fresh();
        await setup();
        await store.sync("u1", [reminder("s1|a")], ["s1"]);
        assert.deepEqual(await store.sendDue(), { sent: 1, retried: 0, failed: 0, deferred: 0, dropped: 0 });
        assert.deepEqual(Object.keys(calls[0].payload).sort(), ["body", "id", "snoozes", "title"]);
        await store.sendDue();
        assert.equal(calls.length, 1);
        await store.sync("u1", [reminder("s1|a")], ["s1"]); // the same list again: still once
        await store.sendDue();
        assert.equal(calls.length, 1);
    });

    test("a reminder in the future waits; one the browser no longer lists is cancelled", async () => {
        await fresh();
        await setup();
        await store.sync("u1", [{ ...reminder("s1|a"), fireAt: new Date(clock.getTime() + 3600_000).toISOString() }, reminder("s2|a", 1, "s2")], ["s1", "s2"]);
        await store.sendDue();
        assert.equal(calls.length, 1);
        await store.sync("u1", [], []);
        clock = new Date(clock.getTime() + 2 * 3600_000);
        await store.sendDue();
        assert.equal(calls.length, 1, "the cancelled one is not sent when its time comes");
    });

    test("failure: retried after 1, 5 and 30 minutes, then failed and shown by the status; never more than 3 attempts", async () => {
        await fresh();
        await setup();
        behaviour = async () => { throw Object.assign(new Error("down"), { statusCode: 500 }); };
        await store.sync("u1", [reminder("s1|a")], ["s1"]);
        assert.equal((await store.sendDue()).retried, 1);
        assert.equal((await store.sendDue()).retried, 0, "not again before the backoff");
        clock = new Date(clock.getTime() + 61_000);
        assert.equal((await store.sendDue()).retried, 1);
        clock = new Date(clock.getTime() + 5 * 60_000 + 1000);
        assert.equal((await store.sendDue()).failed, 1);
        clock = new Date(clock.getTime() + 3600_000);
        await store.sendDue();
        assert.equal(calls.length, 3);
        assert.equal((await store.status("u1")).failed.length, 1);
    });

    test("a subscription the push service answers 410 to is deleted", async () => {
        await fresh();
        await setup();
        behaviour = async () => { throw Object.assign(new Error("gone"), { statusCode: 410 }); };
        await store.sync("u1", [reminder("s1|a")], ["s1"]);
        await store.sendDue();
        assert.equal((await store.status("u1")).subscriptions, 0);
    });

    test("quiet hours defer; the daily cap drops the rest; no subscription means nothing is sent", async () => {
        await fresh();
        await setup();
        clock = new Date("2026-10-20T21:30:00Z"); // 23:30 in Belgrade
        await store.sync("u1", [reminder("s1|a")], ["s1"]);
        assert.equal((await store.sendDue()).deferred, 1);
        assert.equal(calls.length, 0);

        await fresh();
        await store.subscribe("u1", sub("u1"));
        await store.setPrefs("u1", { quietStart: 1320, quietEnd: 480, dailyCap: 2, tz: "Europe/Belgrade" });
        await store.sync("u1", [reminder("a", 5, "s1"), reminder("b", 4, "s2"), reminder("c", 3, "s3")], ["s1", "s2", "s3"]);
        const r = await store.sendDue();
        assert.equal(r.sent, 2);
        assert.equal(r.dropped, 1);

        await fresh();
        await store.sync("u1", [reminder("s1|a")], ["s1"]);
        assert.equal((await store.sendDue()).dropped, 1);
    });

    test("snooze: 5, 10 or 15 minutes, at most 3 times, and only the owner's reminder", async () => {
        await fresh();
        await setup();
        await store.sync("u1", [reminder("s1|a")], ["s1"]);
        await store.sendDue();
        const id = calls[0].payload.id;
        assert.deepEqual(await store.snooze("u1", id, 7), { ok: false, code: "VALIDATION" });
        assert.deepEqual(await store.snooze("u2", id, 5), { ok: false, code: "NOT_FOUND" });
        assert.equal((await store.snooze("u1", id, 5)).ok, true);
        clock = new Date(clock.getTime() + 6 * 60_000);
        await store.sendDue();
        assert.equal(calls.length, 2);
        for (let i = 2; i <= 3; i++) {
            assert.equal((await store.snooze("u1", calls.at(-1).payload.id, 5)).ok, true);
            clock = new Date(clock.getTime() + 6 * 60_000);
            await store.sendDue();
        }
        assert.equal(calls.length, 4);
        assert.deepEqual(await store.snooze("u1", calls.at(-1).payload.id, 5), { ok: false, code: "SNOOZE_LIMIT" });
    });

    test("a pending snooze is cancelled when its session is no longer active", async () => {
        await fresh();
        await setup();
        await store.sync("u1", [reminder("s1|a")], ["s1"]);
        await store.sendDue();
        await store.snooze("u1", calls[0].payload.id, 10);
        await store.sync("u1", [], []); // the session was completed or deleted
        clock = new Date(clock.getTime() + 11 * 60_000);
        await store.sendDue();
        assert.equal(calls.length, 1);
    });

    test("one person never sees or changes another's: subscriptions, reminders and status are separate", async () => {
        await fresh();
        await setup("u1");
        await setup("u2");
        await store.sync("u1", [reminder("s1|a")], ["s1"]);
        assert.equal((await store.status("u2")).counts.pending, undefined);
        await store.sendDue();
        assert.deepEqual([...new Set(calls.map((c) => c.endpoint))], ["https://push.example/u1"]);
        // a device that moves to another account is that account's from then on
        await store.subscribe("u2", sub("u1"));
        assert.equal((await store.status("u1")).subscriptions, 0);
    });

    test("deleting the account removes everything", async () => {
        await fresh();
        await setup();
        await store.sync("u1", [reminder("s1|a")], ["s1"]);
        await db.pool.query("DELETE FROM users WHERE id = 'u1'");
        const left = await db.pool.query("SELECT (SELECT count(*) FROM push_subscriptions) + (SELECT count(*) FROM push_reminders) + (SELECT count(*) FROM push_prefs) AS n");
        assert.equal(Number(left.rows[0].n), 0);
    });

    test("bad input is refused", async () => {
        await fresh();
        assert.equal((await store.subscribe("u1", { endpoint: "http://insecure", keys: {} })).ok, false);
        assert.equal((await store.sync("u1", [{ key: "x", sessionId: "s", fireAt: "not a date" }], [])).ok, false);
        assert.equal((await store.setPrefs("u1", { quietStart: 5000, quietEnd: 1, dailyCap: 5, tz: "UTC" })).ok, false);
        assert.equal((await store.setPrefs("u1", { quietStart: 1, quietEnd: 2, dailyCap: 5, tz: "Not/AZone" })).ok, false);
    });
});
