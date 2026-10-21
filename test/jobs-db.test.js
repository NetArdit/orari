/**
 * The PostgreSQL job store against a real PostgreSQL (npm run test:pg): the rules of lib/jobs.js, with the work run
 * by someone else (runJob), as the Netlify background function does.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createDbJobStore, JOBS_SCHEMA_SQL } from "../lib/jobsDb.js";
import { startPostgres } from "./helpers/embeddedPg.js";

const PG = process.env.ORARI_PG === "1" || process.env.npm_lifecycle_event === "test:pg";
const payload = (n = 1) => ({ kind: "create-plan", body: { n }, account: null });

describe("job store in PostgreSQL", { skip: !PG }, () => {
    let db;
    let dispatched;
    let store;
    before(async () => {
        db = await startPostgres();
        await db.pool.query(JOBS_SCHEMA_SQL);
    });
    after(async () => db?.stop());
    const fresh = async (options = {}) => {
        await db.pool.query("TRUNCATE jobs");
        dispatched = [];
        store = createDbJobStore({ pool: db.pool, dispatch: async (id) => void dispatched.push(id), ...options });
    };

    test("a job is started, handed to the dispatcher, run by someone else, and polled to its answer", async () => {
        await fresh();
        const started = await store.start("u:1", payload(), { key: "key-number-1", fingerprint: "f" });
        assert.equal(started.ok, true);
        assert.equal(started.job.status, "running");
        assert.deepEqual(dispatched, [started.job.id]);
        assert.equal((await store.get("u:1", started.job.id)).status, "running");
        await store.runJob(started.job.id, async (kind, p) => ({ status: 200, body: { kind, n: p.body.n } }));
        const done = await store.get("u:1", started.job.id);
        assert.equal(done.status, "done");
        assert.deepEqual(done.result, { status: 200, body: { kind: "create-plan", n: 1 } });
        const row = (await db.pool.query("SELECT payload FROM jobs WHERE id = $1", [started.job.id])).rows[0];
        assert.deepEqual(row.payload, {}, "the request is not kept once the work is done");
    });

    test("an error status makes it failed; a crash makes it failed with a safe message", async () => {
        await fresh({ maxRunningPerOwner: 5, maxKeptPerOwner: 5 });
        const a = (await store.start("u:1", payload())).job.id;
        await store.runJob(a, async () => ({ status: 502, body: { code: "AI_FAILED" } }));
        assert.equal((await store.get("u:1", a)).status, "failed");
        const b = (await store.start("u:1", payload())).job.id;
        await store.runJob(b, async () => {
            throw new Error("secret detail");
        });
        const failed = await store.get("u:1", b);
        assert.equal(failed.status, "failed");
        assert.ok(!JSON.stringify(failed).includes("secret detail"));
    });

    test("the same key and request gives the same job; another request with the key is refused; two starts at once make one job", async () => {
        await fresh();
        const one = await store.start("u:1", payload(), { key: "repeat-key-1", fingerprint: "same" });
        const two = await store.start("u:1", payload(), { key: "repeat-key-1", fingerprint: "same" });
        assert.equal(two.existing, true);
        assert.equal(two.job.id, one.job.id);
        assert.equal(dispatched.length, 1);
        assert.deepEqual(await store.start("u:1", payload(2), { key: "repeat-key-1", fingerprint: "other" }), { ok: false, code: "KEY_REUSED" });
        assert.deepEqual(await store.start("u:1", payload(), { key: "short", fingerprint: "x" }), { ok: false, code: "KEY_INVALID" });

        await fresh({ maxRunningPerOwner: 5, maxKeptPerOwner: 5 });
        const both = await Promise.all([store.start("u:2", payload(), { key: "race-key-123", fingerprint: "r" }), store.start("u:2", payload(), { key: "race-key-123", fingerprint: "r" })]);
        assert.equal(new Set(both.map((r) => r.job.id)).size, 1);
    });

    test("one running job per owner; another owner is not blocked", async () => {
        await fresh();
        assert.equal((await store.start("u:1", payload())).ok, true);
        assert.deepEqual(await store.start("u:1", payload()), { ok: false, code: "BUSY" });
        assert.equal((await store.start("u:2", payload())).ok, true);
    });

    test("a job belongs to its owner: another owner's read and cancel look like an unknown id", async () => {
        await fresh();
        const id = (await store.start("u:1", payload())).job.id;
        assert.equal(await store.get("u:2", id), null);
        assert.equal(await store.cancel("u:2", id), false);
        assert.equal(await store.get("u:1", "no-such-job"), null);
        assert.equal((await store.get("u:1", id)).status, "running");
    });

    test("cancel: the job stays cancelled and the late answer of the work is thrown away", async () => {
        await fresh();
        const id = (await store.start("u:1", payload())).job.id;
        assert.equal(await store.cancel("u:1", id), true);
        await store.runJob(id, async () => ({ status: 200, body: { late: true } }));
        const job = await store.get("u:1", id);
        assert.equal(job.status, "cancelled");
        assert.equal(job.result, undefined);
        assert.equal(await store.runJob(id, async () => ({ status: 200, body: {} })), false, "work for a job that is no longer running is not run");
    });

    test("a dispatcher that fails makes the job failed at once, never stuck running", async () => {
        await fresh();
        store = createDbJobStore({ pool: db.pool, dispatch: async () => { throw new Error("down"); } });
        const r = await store.start("u:1", payload());
        assert.equal(r.job.status, "failed");
        assert.equal((await store.start("u:1", payload())).ok, true, "and it does not hold the owner's slot");
    });

    test("old results are removed, and a job that has run for far too long is failed", async () => {
        await fresh({ staleRunningMs: 1000, resultTtlMs: 1000 });
        const id = (await store.start("u:1", payload())).job.id;
        await db.pool.query("UPDATE jobs SET created_at = now() - interval '1 hour' WHERE id = $1", [id]);
        assert.equal((await store.get("u:1", id)).status, "failed");
        await db.pool.query("UPDATE jobs SET finished_at = now() - interval '1 hour' WHERE id = $1", [id]);
        assert.equal(await store.get("u:1", id), null);
    });
});
