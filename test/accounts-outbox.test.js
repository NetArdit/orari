import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { createPasswordHasher } from "../lib/accounts/password.js";
import { createMemoryAccountsRepository } from "../lib/accounts/memoryRepository.js";
import { createAccountService, LIMITS } from "../lib/accounts/service.js";

/* Amendments from Codex's Batch 7 review: expiry checked where the token is consumed, a replay after
   the operation log has dropped an entry, the decoy hash made up front, and the mail outbox. */

const FAST = { N: 1024, r: 8, p: 1 };
const GOOD = "een lange zin die niemand raadt";
const BASE_URL = "https://orari.example";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const tokenIn = (link) => decodeURIComponent(link.split("#token=")[1]);

function build({ failFirst = 0, repo = createMemoryAccountsRepository(), clock = { t: new Date("2026-10-14T10:00:00.000Z").getTime() }, passwordCheck } = {}) {
    const delivered = [];
    let failures = failFirst;
    const flaky = (kind) => async (m) => {
        if (failures-- > 0) throw new Error("provider down");
        delivered.push({ kind, ...m });
    };
    const mail = {
        sendVerification: flaky("verification"),
        sendReset: flaky("reset"),
        sendPasswordChanged: async (m) => void delivered.push({ kind: "changed", ...m }),
        sendAccountExists: async (m) => void delivered.push({ kind: "exists", ...m }),
        sendAccountDeleted: async (m) => void delivered.push({ kind: "deleted", ...m }),
    };
    let n = 0;
    const make = () =>
        createAccountService({
            repo,
            hasher: createPasswordHasher({ params: FAST }),
            mail,
            baseUrl: BASE_URL,
            passwordCheck: passwordCheck ?? (async () => ({ status: "clean" })),
            now: () => new Date(clock.t),
            newId: () => `id-${++n}`,
            newToken: () => `token-${++n}-${"x".repeat(30)}`,
        });
    return { repo, clock, delivered, make, service: make() };
}

const signUp = (service) => service.signUp({ email: "arta@example.test", password: GOOD, name: "Arta", confirmsAge16: true });

describe("expiry is checked where a token is consumed", () => {
    test("a reset link that runs out while the new password is being checked is refused when it is used", async () => {
        const clock = { t: new Date("2026-10-14T10:00:00.000Z").getTime() };
        const ctx = build({
            clock,
            // The lookup takes long enough for the 30 minutes to pass.
            passwordCheck: async () => {
                clock.t += 31 * 60_000;
                return { status: "clean" };
            },
        });
        await signUp(ctx.service);
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        await flush();
        const token = tokenIn(ctx.delivered.find((m) => m.kind === "reset").link);

        const result = await ctx.service.resetPassword({ token, newPassword: "een nieuwe lange zin hier" });

        assert.equal(result.code, "TOKEN_INVALID");
        assert.equal((await ctx.service.logIn({ email: "arta@example.test", password: GOOD })).ok, true); // password unchanged
    });

    test("the repository itself refuses an expired token, whatever the caller checked", async () => {
        const repo = createMemoryAccountsRepository();
        await repo.createToken({ id: "t1", userId: "u", purpose: "reset", tokenHash: "h", expiresAt: "2026-10-14T10:30:00.000Z", usedAt: null });
        assert.equal(await repo.useToken("t1", "2026-10-14T10:30:00.000Z"), false); // at the expiry instant: expired
        assert.equal(await repo.useToken("t1", "2026-10-14T10:29:59.999Z"), true);
        assert.equal(await repo.useToken("t1", "2026-10-14T10:29:59.999Z"), false); // and only once
    });
});

describe("mark idempotency does not depend on the size of the log", () => {
    test("an operation that has left the bounded log is never applied a second time: its replay is a conflict", async () => {
        const ctx = build();
        await signUp(ctx.service);
        await flush();
        const login = await ctx.service.logIn({ email: "arta@example.test", password: GOOD });
        const userId = login.user.id;
        await ctx.service.createPlan(userId, { id: "p1", subject: "Matematikë", sessions: [{ id: "s1", status: "pending", date: "2026-10-15", startTime: "08:00", endTime: "09:00", type: "learning", title: "x" }] });

        const first = await ctx.service.markSession(userId, "p1", "s1", { opId: "the-first-operation", status: "completed", baseSessionRevision: 0 });
        assert.equal(first.ok, true);

        // Push it out of the log with more operations than the log keeps.
        let revision = 1;
        for (let i = 0; i < LIMITS.appliedOpsKept + 10; i++) {
            const result = await ctx.service.markSession(userId, "p1", "s1", { opId: `later-operation-${i}`, status: i % 2 === 0 ? "partial" : "skipped", baseSessionRevision: revision });
            assert.equal(result.ok, true);
            revision = result.sessionRevision;
        }
        const before = (await ctx.service.listPlans(userId))[0].sessions[0];

        const replay = await ctx.service.markSession(userId, "p1", "s1", { opId: "the-first-operation", status: "completed", baseSessionRevision: 0 });

        assert.equal(replay.code, "MARK_CONFLICT");
        assert.deepEqual((await ctx.service.listPlans(userId))[0].sessions[0], before);
    });
});

describe("the decoy hash", () => {
    test("is made when the service is made, not on the first unknown sign-in", () => {
        const hasher = createPasswordHasher({ params: FAST });
        let hashed = 0;
        const realHash = hasher.hash.bind(hasher);
        hasher.hash = async (password) => {
            hashed++;
            return realHash(password);
        };
        createAccountService({ repo: createMemoryAccountsRepository(), hasher, mail: {}, baseUrl: BASE_URL, passwordCheck: async () => ({ status: "clean" }) });
        assert.equal(hashed, 1);
    });
});

describe("the mail outbox", () => {
    test("a failed send is kept and retried later, not lost", async () => {
        const ctx = build({ failFirst: 1 });
        await signUp(ctx.service);
        await flush();
        assert.deepEqual(ctx.delivered, []);
        assert.deepEqual(await ctx.repo.outboxStats(), { waiting: 1, failed: 0 });

        assert.equal(await ctx.service.dispatchMail(), 0); // not due yet
        ctx.clock.t += 61_000;
        assert.equal(await ctx.service.dispatchMail(), 1);
        assert.equal(ctx.delivered.length, 1);
        assert.deepEqual(await ctx.repo.outboxStats(), { waiting: 0, failed: 0 });
    });

    test("a message left by a process that died is sent by the next one", async () => {
        const first = build({ failFirst: 1 });
        await signUp(first.service);
        await flush();
        assert.equal(first.delivered.length, 0);

        // A new process: a new service over the same storage and a provider that works.
        const second = build({ repo: first.repo, clock: first.clock });
        second.clock.t += 61_000;
        assert.equal(await second.service.dispatchMail(), 1);
        assert.equal(second.delivered[0].kind, "verification");
        assert.match(second.delivered[0].link, /\/app\/verify#token=/);
    });

    test("after five failed attempts it is given up and the link it held is dropped", async () => {
        const ctx = build({ failFirst: 100 });
        await signUp(ctx.service);
        await flush();
        for (const minutes of [1, 5, 15, 60, 240]) {
            ctx.clock.t += (minutes + 1) * 60_000;
            await ctx.service.dispatchMail();
        }
        assert.deepEqual(await ctx.repo.outboxStats(), { waiting: 0, failed: 1 });
        const claim = await ctx.repo.outboxClaim({ now: new Date(ctx.clock.t + 1e9).toISOString(), limit: 10, leaseUntil: "x" });
        assert.deepEqual(claim, []); // nothing is due any more
    });

    test("a message whose link has already expired is dropped unsent", async () => {
        const ctx = build({ failFirst: 1 });
        await signUp(ctx.service);
        await flush();
        ctx.clock.t += 25 * 3_600_000; // past the 24 hours of a verification link
        assert.equal(await ctx.service.dispatchMail(), 0);
        assert.deepEqual(await ctx.repo.outboxStats(), { waiting: 0, failed: 0 });
        assert.deepEqual(ctx.delivered, []);
    });

    test("dispatchers started together do not send the same message twice", async () => {
        const ctx = build({ failFirst: 1 });
        await signUp(ctx.service);
        await flush();
        ctx.clock.t += 61_000;
        await Promise.all([ctx.service.dispatchMail(), ctx.make().dispatchMail(), ctx.make().dispatchMail()]);
        await flush();
        assert.equal(ctx.delivered.filter((m) => m.kind === "verification").length, 1);
    });

    test("erasing an account also removes the mail still waiting for it", async () => {
        const ctx = build({ failFirst: 1 });
        await signUp(ctx.service);
        await flush();
        const user = await ctx.repo.findUserByEmail("arta@example.test");
        assert.deepEqual(await ctx.repo.outboxStats(), { waiting: 1, failed: 0 });
        await ctx.repo.eraseUser(user.id);
        assert.deepEqual(await ctx.repo.outboxStats(), { waiting: 0, failed: 0 });
    });

    test("an unknown address gets nothing queued", async () => {
        const ctx = build();
        await ctx.service.requestPasswordReset({ email: "nobody@example.test" });
        await flush();
        assert.deepEqual(await ctx.repo.outboxStats(), { waiting: 0, failed: 0 });
        assert.deepEqual(ctx.delivered, []);
    });
});
