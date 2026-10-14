import { test } from "node:test";
import assert from "node:assert/strict";

import { checkMemoryAccountsEnvironment } from "../lib/accounts/localOnly.js";
import { createMemoryAccountsRepository } from "../lib/accounts/memoryRepository.js";
import { createPasswordHasher } from "../lib/accounts/password.js";
import { createAccountService } from "../lib/accounts/service.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));

function service(mailFails = false) {
    let time = new Date("2026-10-14T10:00:00.000Z").getTime();
    let n = 0;
    const attempts = [];
    const failing = async (m) => {
        attempts.push(time);
        if (mailFails) throw new Error("provider down");
    };
    const mail = { sendVerification: failing, sendReset: failing, sendPasswordChanged: failing, sendAccountExists: failing, sendAccountDeleted: failing };
    const repo = createMemoryAccountsRepository();
    const svc = createAccountService({
        repo,
        hasher: createPasswordHasher({ params: { N: 1024, r: 8, p: 1 } }),
        mail,
        baseUrl: "https://orari.example",
        passwordCheck: async () => ({ status: "clean" }),
        now: () => new Date(time),
        newId: () => `id-${++n}`,
        newToken: () => `token-${++n}-${"x".repeat(30)}`,
    });
    return { svc, repo, attempts, advance: (ms) => (time += ms) };
}

const session = (id) => ({ id, status: "pending", date: "2026-10-15", startTime: "08:00", endTime: "09:00", type: "learning", title: id });
const plan = (id, ids) => ({ id, subject: "Matematikë", sessions: ids.map(session) });

test("memory accounts are refused in production, off loopback, and with a public base address", () => {
    assert.equal(checkMemoryAccountsEnvironment({}).ok, true);
    assert.equal(checkMemoryAccountsEnvironment({ HOST: "127.0.0.1", ORARI_BASE_URL: "http://localhost:3100" }).ok, true);
    assert.equal(checkMemoryAccountsEnvironment({ NODE_ENV: "production" }).ok, false);
    assert.equal(checkMemoryAccountsEnvironment({ HOST: "0.0.0.0" }).ok, false);
    assert.equal(checkMemoryAccountsEnvironment({ HOST: "192.168.1.5" }).ok, false);
    assert.equal(checkMemoryAccountsEnvironment({ ORARI_BASE_URL: "https://orari.example" }).ok, false);
    assert.equal(checkMemoryAccountsEnvironment({ ORARI_BASE_URL: "not a url" }).ok, false);
});

test("a deleted plan's id cannot be used again, so its revisions and operation log cannot restart", async () => {
    const { svc } = service();
    assert.equal((await svc.createPlan("u1", plan("p1", ["s1"]))).ok, true);
    assert.equal((await svc.deletePlan("u1", "p1")).ok, true);
    const again = await svc.createPlan("u1", plan("p1", ["s1"]));
    assert.equal(again.ok, false);
    assert.equal(again.code, "PLAN_EXISTS");
});

test("a session that leaves a plan and returns continues its revision instead of restarting at 0", async () => {
    const { svc, repo } = service();
    await svc.createPlan("u1", plan("p1", ["s1", "s2"]));
    const first = await svc.markSession("u1", "p1", "s2", { opId: "operation-1", status: "completed", baseSessionRevision: 0 });
    assert.equal(first.ok, true);
    const removed = await svc.updatePlan("u1", "p1", { sessions: [session("s1")] }, (await repo.getPlan("u1", "p1")).revision);
    assert.equal(removed.ok, true);
    const back = await svc.updatePlan("u1", "p1", { sessions: [session("s1"), session("s2")] }, (await repo.getPlan("u1", "p1")).revision);
    assert.equal(back.ok, true);
    const revision = back.plan.sessions.find((s) => s.id === "s2").revision;
    assert.equal(revision >= 2, true, `revision ${revision} must be beyond the one it left with`);
    // The old base revision (0) no longer applies.
    const stale = await svc.markSession("u1", "p1", "s2", { opId: "operation-2", status: "skipped", baseSessionRevision: 0 });
    assert.equal(stale.ok, false);
});

test("mail that always fails is attempted five times in all, at the stated delays, then given up and the link dropped", async () => {
    const { svc, repo, attempts, advance } = service(true);
    await svc.signUp({ email: "arta@example.test", password: "een lange zin die niemand raadt", name: "Arta", confirmsAge16: true });
    await flush();
    for (const minutes of [1, 5, 15, 60, 240, 240]) {
        advance(minutes * 60_000);
        await svc.dispatchMail();
    }
    assert.equal(attempts.length, 5);
    const stats = await repo.outboxStats();
    assert.equal(stats.waiting, 0);
    assert.equal(stats.failed, 1);
});
