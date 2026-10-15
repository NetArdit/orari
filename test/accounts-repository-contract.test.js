/**
 * One set of behavioural checks, run against the in-memory repository and against a REAL PostgreSQL (the
 * embedded-postgres package starts the real server locally). The two must behave the same: the account
 * logic is written once and swapped between them.
 */
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

import { createMemoryAccountsRepository } from "../lib/accounts/memoryRepository.js";
import { createPostgresAccountsRepository } from "../lib/accounts/postgres/repository.js";
import { startPostgres } from "./helpers/embeddedPg.js";

/* The suites that start a real PostgreSQL (the embedded-postgres package) run with `npm run test:pg`; `npm test` stays fast. */
const PG = process.env.ORARI_PG === "1" || process.env.npm_lifecycle_event === "test:pg";

const T0 = "2026-10-14T10:00:00.000Z";
const at = (min) => new Date(new Date(T0).getTime() + min * 60_000).toISOString();
const user = (n, extra = {}) => ({ id: `u${n}`, email: `u${n}@example.com`, passwordHash: `hash-${n}`, name: `Përdoruesi ${n} ë ç`, emailVerifiedAt: null, createdAt: T0, ...extra });
const session = (id, userId, extra = {}) => ({ id, userId, tokenHash: `th-${id}`, createdAt: T0, lastSeenAt: T0, userAgent: "Edge", ...extra });
const token = (id, userId, extra = {}) => ({ id, userId, purpose: "reset", tokenHash: `tok-${id}`, expiresAt: at(30), usedAt: null, ...extra });
const message = (id, extra = {}) => ({ id, kind: "verification", userId: "u1", to: "u1@example.com", createdAt: at(Number(id.replace(/\D/g, "")) || 0), nextAttemptAt: T0, attempts: 0, link: "https://orari.example/x", ...extra });
const plan = (id, revision = 0, extra = {}) => ({ id, revision, subject: "Matematikë", sessions: [{ id: "s1", status: "pending", title: "Përsëritje: ç ë" }], ...extra });

function contract(makeRepo) {
    test("users: unique email, lookup, partial update", async () => {
        const repo = await makeRepo();
        assert.deepEqual(await repo.createUser(user(1)), { ok: true });
        assert.deepEqual(await repo.createUser(user(2, { email: "u1@example.com" })), { ok: false, code: "EMAIL_TAKEN" });
        assert.deepEqual(await repo.findUserByEmail("u1@example.com"), user(1));
        assert.deepEqual(await repo.findUserById("u1"), user(1));
        assert.equal(await repo.findUserById("nope"), undefined);
        assert.equal(await repo.updateUser("u1", { emailVerifiedAt: T0 }), true);
        assert.equal((await repo.findUserById("u1")).emailVerifiedAt, T0);
        assert.equal((await repo.findUserById("u1")).name, user(1).name);
        assert.equal(await repo.updateUser("u1", { passwordHash: "new-hash" }), true);
        assert.equal((await repo.findUserByEmail("u1@example.com")).passwordHash, "new-hash");
        assert.equal(await repo.updateUser("nope", { name: "x" }), false);
    });

    test("users: the sign-in address can move, and cannot move onto another account's", async () => {
        const repo = await makeRepo();
        await repo.createUser(user(1));
        await repo.createUser(user(2));
        assert.equal(await repo.updateUser("u1", { email: "moved@example.com" }), true);
        assert.equal(await repo.findUserByEmail("u1@example.com"), undefined);
        assert.equal((await repo.findUserByEmail("moved@example.com")).id, "u1");
        assert.equal((await repo.findUserById("u1")).email, "moved@example.com");
    });

    test("users: ten concurrent sign-ups with one address, exactly one wins", async () => {
        const repo = await makeRepo();
        const results = await Promise.all(Array.from({ length: 10 }, (_, i) => repo.createUser(user(i + 1, { email: "same@example.com" }))));
        assert.equal(results.filter((r) => r.ok).length, 1);
    });

    test("sessions: create, find by hash, touch, list, delete, delete all but one", async () => {
        const repo = await makeRepo();
        await repo.createUser(user(1));
        await repo.createSession(session("a", "u1"));
        await repo.createSession(session("b", "u1"));
        await repo.createSession(session("c", "u1"));
        assert.equal((await repo.findSessionByTokenHash("th-a")).id, "a");
        assert.equal(await repo.findSessionByTokenHash("nope"), undefined);
        await repo.touchSession("a", at(5));
        assert.equal((await repo.findSessionByTokenHash("th-a")).lastSeenAt, at(5));
        assert.equal((await repo.listSessions("u1")).length, 3);
        assert.equal(await repo.deleteSession("c"), true);
        assert.equal(await repo.deleteSession("c"), false);
        assert.equal(await repo.deleteSessionsOf("u1", "a"), 1);
        assert.deepEqual((await repo.listSessions("u1")).map((s) => s.id), ["a"]);
        assert.equal(await repo.deleteSessionsOf("u1"), 1);
    });

    test("tokens: found by purpose and hash, used once, refused after expiry, voided", async () => {
        const repo = await makeRepo();
        await repo.createUser(user(1));
        await repo.createToken(token("t1", "u1"));
        assert.equal((await repo.findTokenByHash("reset", "tok-t1")).id, "t1");
        assert.equal(await repo.findTokenByHash("verify", "tok-t1"), undefined);
        assert.equal(await repo.useToken("t1", at(1)), true);
        assert.equal(await repo.useToken("t1", at(2)), false);
        await repo.createToken(token("t2", "u1", { expiresAt: at(10) }));
        assert.equal(await repo.useToken("t2", at(10)), false, "at the expiry instant it is already refused");
        await repo.createToken(token("t3", "u1"));
        await repo.voidTokens("u1", "reset", at(3));
        assert.equal(await repo.useToken("t3", at(4)), false);
    });

    test("tokens: of twenty concurrent uses exactly one succeeds", async () => {
        const repo = await makeRepo();
        await repo.createUser(user(1));
        await repo.createToken(token("t1", "u1"));
        const results = await Promise.all(Array.from({ length: 20 }, () => repo.useToken("t1", at(1))));
        assert.equal(results.filter(Boolean).length, 1);
    });

    test("outbox: claim leases, order, done, retry schedule, giving up drops the link, stats", async () => {
        const repo = await makeRepo();
        await repo.outboxAdd(message("m2"));
        await repo.outboxAdd(message("m1"));
        await repo.outboxAdd(message("m3", { nextAttemptAt: at(60) }));
        const first = await repo.outboxClaim({ now: at(0), limit: 10, leaseUntil: at(2) });
        assert.deepEqual(first.map((m) => m.id), ["m1", "m2"], "due messages, oldest first, not the one scheduled later");
        assert.deepEqual(await repo.outboxClaim({ now: at(1), limit: 10, leaseUntil: at(3) }), [], "leased messages are hidden");
        assert.deepEqual((await repo.outboxClaim({ now: at(2), limit: 1, leaseUntil: at(4) })).map((m) => m.id), ["m1"], "lease over, limit respected");
        await repo.outboxDone("m1");
        await repo.outboxFail("m2", { attempts: 1, nextAttemptAt: at(10) });
        assert.deepEqual(await repo.outboxClaim({ now: at(9), limit: 10, leaseUntil: at(11) }), []);
        const retried = await repo.outboxClaim({ now: at(10), limit: 10, leaseUntil: at(12) });
        assert.deepEqual(retried.map((m) => [m.id, m.attempts]), [["m2", 1]]);
        await repo.outboxFail("m2", { attempts: 5, failedAt: at(11) });
        assert.deepEqual(await repo.outboxStats(), { waiting: 1, failed: 1 });
        const later = await repo.outboxClaim({ now: at(500), limit: 10, leaseUntil: at(501) });
        assert.deepEqual(later.map((m) => m.id), ["m3"], "a given-up message is never claimed again");
    });

    test("outbox: a failed message no longer holds its link", async () => {
        const repo = await makeRepo();
        await repo.outboxAdd(message("m1"));
        await repo.outboxClaim({ now: at(0), limit: 10, leaseUntil: at(2) });
        await repo.outboxFail("m1", { attempts: 5, failedAt: at(1) });
        assert.deepEqual(await repo.outboxStats(), { waiting: 0, failed: 1 });
    });

    test("outbox: six dispatchers claiming at once never take the same message", async () => {
        const repo = await makeRepo();
        for (let i = 1; i <= 30; i++) await repo.outboxAdd(message("m" + i));
        const claims = await Promise.all(Array.from({ length: 6 }, () => repo.outboxClaim({ now: at(0), limit: 10, leaseUntil: at(2) })));
        const ids = claims.flat().map((m) => m.id);
        assert.equal(new Set(ids).size, ids.length, "no message appears twice");
        assert.equal(ids.length, 30, "every message was taken once");
    });

    test("plans: insert, duplicate, retired id, per-user isolation, text round trip", async () => {
        const repo = await makeRepo();
        await repo.createUser(user(1));
        await repo.createUser(user(2));
        assert.deepEqual(await repo.insertPlan("u1", plan("p1")), { ok: true });
        assert.deepEqual(await repo.insertPlan("u1", plan("p1")), { ok: false, code: "PLAN_EXISTS" });
        assert.deepEqual(await repo.getPlan("u1", "p1"), plan("p1"));
        assert.equal(await repo.getPlan("u2", "p1"), undefined, "another user does not see it");
        assert.deepEqual(await repo.insertPlan("u2", plan("p1")), { ok: true }, "the same id under another user is allowed");
        assert.deepEqual((await repo.listPlans("u1")).map((p) => p.id), ["p1"]);
        assert.equal(await repo.deletePlan("u1", "p1"), true);
        assert.equal(await repo.deletePlan("u1", "p1"), false);
        assert.deepEqual(await repo.insertPlan("u1", plan("p1")), { ok: false, code: "PLAN_EXISTS" }, "a deleted id stays retired");
    });

    test("plans: compare-and-swap on the revision; of concurrent writers exactly one wins", async () => {
        const repo = await makeRepo();
        await repo.createUser(user(1));
        await repo.insertPlan("u1", plan("p1", 0));
        assert.deepEqual(await repo.replacePlan("u1", plan("p1", 1, { subject: "Fizikë" }), 0), { ok: true });
        const stale = await repo.replacePlan("u1", plan("p1", 1, { subject: "Kimi" }), 0);
        assert.equal(stale.ok, false);
        assert.equal(stale.code, "REVISION_CONFLICT");
        assert.equal(stale.current.subject, "Fizikë");
        assert.deepEqual(await repo.replacePlan("u1", plan("zz", 1), 0), { ok: false, code: "NOT_FOUND" });
        const race = await Promise.all([1, 2, 3, 4, 5, 6].map((n) => repo.replacePlan("u1", plan("p1", 2, { subject: "W" + n }), 1)));
        assert.equal(race.filter((r) => r.ok).length, 1);
    });

    test("erasing a user leaves nothing that refers to them, and leaves others alone", async () => {
        const repo = await makeRepo();
        await repo.createUser(user(1));
        await repo.createUser(user(2));
        await repo.createSession(session("a", "u1"));
        await repo.createToken(token("t1", "u1"));
        await repo.insertPlan("u1", plan("p1"));
        await repo.deletePlan("u1", "p1");
        await repo.insertPlan("u1", plan("p2"));
        await repo.outboxAdd(message("m1", { userId: "u1" }));
        await repo.insertPlan("u2", plan("p9"));
        await repo.eraseUser("u1");
        assert.equal(await repo.findUserById("u1"), undefined);
        assert.deepEqual(await repo.listSessions("u1"), []);
        assert.equal(await repo.findTokenByHash("reset", "tok-t1"), undefined);
        assert.deepEqual(await repo.listPlans("u1"), []);
        assert.deepEqual(await repo.outboxStats(), { waiting: 0, failed: 0 });
        assert.deepEqual((await repo.listPlans("u2")).map((p) => p.id), ["p9"]);
        // a retired id went with the user: a new account with the same id starts clean
        await repo.createUser(user(1));
        assert.deepEqual(await repo.insertPlan("u1", plan("p1")), { ok: true });
    });
}

describe("repository contract: in memory", () => contract(async () => createMemoryAccountsRepository()));

describe("repository contract: real PostgreSQL", { skip: !PG }, () => {
    let db;
    before(async () => {
        db = await startPostgres();
    });
    after(async () => {
        await db?.stop();
    });
    contract(async () => {
        await db.reset();
        return createPostgresAccountsRepository({ pool: db.pool });
    });
});
