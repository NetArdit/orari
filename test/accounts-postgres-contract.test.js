import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryAccountsRepository } from "../lib/accounts/memoryRepository.js";
import { createPostgresAccountsRepository } from "../lib/accounts/postgres/repository.js";

/* The PostgreSQL adapter is not connected and has never run against a database. These tests check only what
   a recording fake can show: that it offers the same methods as the in-memory repository, and that the
   statements which must be atomic are single conditional statements decided by the row count.
   They do NOT replace a run against a real PostgreSQL. */

function fakePool(rowCount = 1, rows = []) {
    const calls = [];
    return { calls, query: async (text, values) => (calls.push({ text, values }), { rowCount, rows }) };
}

test("it offers every method of the in-memory repository", () => {
    const memory = createMemoryAccountsRepository();
    const postgres = createPostgresAccountsRepository({ pool: fakePool() });
    const missing = Object.keys(memory).filter((name) => !name.startsWith("_") && typeof postgres[name] !== "function");
    assert.deepEqual(missing, []);
});

test("it refuses to be built without a pool", () => {
    assert.throws(() => createPostgresAccountsRepository({}));
});

test("useToken is one conditional UPDATE that checks unused and unexpired at the moment of use", async () => {
    const pool = fakePool(1);
    const repo = createPostgresAccountsRepository({ pool });
    assert.equal(await repo.useToken("t1", "2026-10-14T10:00:00.000Z"), true);
    assert.equal(pool.calls.length, 1);
    assert.match(pool.calls[0].text, /UPDATE tokens SET used_at = \$2 WHERE id = \$1 AND used_at IS NULL AND expires_at > \$2/);
    assert.equal(await createPostgresAccountsRepository({ pool: fakePool(0) }).useToken("t1", "x"), false);
});

test("replacePlan is a compare-and-swap on the stored revision, and a miss returns the current row", async () => {
    const pool = fakePool(0, [{ data: { id: "p1", revision: 5 } }]);
    const repo = createPostgresAccountsRepository({ pool });
    const result = await repo.replacePlan("u1", { id: "p1", revision: 3 }, 2);
    assert.match(pool.calls[0].text, /WHERE user_id = \$1 AND id = \$2 AND revision = \$5/);
    assert.equal(pool.calls[0].values[4], 2);
    assert.deepEqual(result, { ok: false, code: "REVISION_CONFLICT", current: { id: "p1", revision: 5 } });
});

test("insertPlan refuses a retired id inside the statement, and deletePlan retires the id in the same statement", async () => {
    const pool = fakePool(1, [{ n: 1 }]);
    const repo = createPostgresAccountsRepository({ pool });
    await repo.insertPlan("u1", { id: "p1", revision: 1 });
    assert.match(pool.calls[0].text, /NOT EXISTS \(SELECT 1 FROM retired_plans/);
    assert.equal(await repo.deletePlan("u1", "p1"), true);
    assert.match(pool.calls[1].text, /DELETE FROM plans[\s\S]*INSERT INTO retired_plans/);
    assert.equal(pool.calls.length, 2);
});

test("outboxClaim takes due messages with row locks that other dispatchers skip", async () => {
    const pool = fakePool(0, []);
    await createPostgresAccountsRepository({ pool }).outboxClaim({ now: "n", limit: 5, leaseUntil: "l" });
    assert.match(pool.calls[0].text, /FOR UPDATE SKIP LOCKED/);
});

test("giving up on a message removes the link it held", async () => {
    const pool = fakePool(1);
    await createPostgresAccountsRepository({ pool }).outboxFail("m1", { attempts: 5, failedAt: "now" });
    assert.match(pool.calls[0].text, /data - 'link'/);
});
