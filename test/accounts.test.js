import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { checkPasswordPolicy, createPasswordHasher, POLICY } from "../lib/accounts/password.js";
import { createPwnedCheck } from "../lib/accounts/pwned.js";
import { createMemoryAccountsRepository } from "../lib/accounts/memoryRepository.js";
import { createAccountService, hashToken, LIMITS, normaliseEmail } from "../lib/accounts/service.js";

/* The account logic against the in-memory repository, with a cheap hasher, a recording mailer and a
   clock the tests move. Nothing here touches the network. */

const FAST = { N: 1024, r: 8, p: 1 };
const GOOD = "een lange zin die niemand raadt"; // 30 characters
const BASE_URL = "https://orari.example";
const flush = () => new Promise((resolve) => setImmediate(resolve));

function setup({ passwordCheck } = {}) {
    let time = new Date("2026-10-14T10:00:00.000Z").getTime();
    const clock = { now: () => new Date(time), advance: (ms) => (time += ms) };
    const hasher = createPasswordHasher({ params: FAST });
    const verifyCalls = [];
    const realVerify = hasher.verify.bind(hasher);
    hasher.verify = async (password, stored) => {
        verifyCalls.push(stored);
        return realVerify(password, stored);
    };
    const sent = [];
    const mail = {
        sendVerification: async (m) => void sent.push({ kind: "verification", ...m }),
        sendReset: async (m) => void sent.push({ kind: "reset", ...m }),
        sendPasswordChanged: async (m) => void sent.push({ kind: "changed", ...m }),
        sendAccountExists: async (m) => void sent.push({ kind: "exists", ...m }),
        sendAccountDeleted: async (m) => void sent.push({ kind: "deleted", ...m }),
    };
    let n = 0;
    const repo = createMemoryAccountsRepository();
    const service = createAccountService({
        repo,
        hasher,
        mail,
        baseUrl: BASE_URL,
        passwordCheck: passwordCheck ?? (async () => ({ status: "clean" })),
        now: clock.now,
        newId: () => `id-${++n}`,
        newToken: () => `token-${++n}-${"x".repeat(30)}`,
    });
    return { service, repo, hasher, mail: sent, clock, verifyCalls };
}

const tokenIn = (link) => decodeURIComponent(link.split("#token=")[1]);

async function registered(ctx, email = "arta@example.test", password = GOOD) {
    const result = await ctx.service.signUp({ email, password, name: "Arta", confirmsAge16: true });
    assert.equal(result.ok, true);
    await flush();
    return ctx.mail.filter((m) => m.kind === "verification").at(-1);
}

async function signedIn(ctx, email = "arta@example.test", password = GOOD) {
    const login = await ctx.service.logIn({ email, password, userAgent: "Edge on Windows" });
    assert.equal(login.ok, true);
    return login;
}

describe("password policy", () => {
    test("15 to 128 characters; spaces and passphrases fine; no composition rules", () => {
        assert.deepEqual(checkPasswordPolicy("a".repeat(POLICY.minLength)), { ok: true });
        assert.deepEqual(checkPasswordPolicy("a".repeat(POLICY.minLength - 1)), { ok: false, code: "PASSWORD_TOO_SHORT" });
        assert.deepEqual(checkPasswordPolicy("a".repeat(POLICY.maxLength)), { ok: true });
        assert.deepEqual(checkPasswordPolicy("a".repeat(POLICY.maxLength + 1)), { ok: false, code: "PASSWORD_TOO_LONG" });
        assert.deepEqual(checkPasswordPolicy("tre pika pese gjashte pak"), { ok: true });
        assert.deepEqual(checkPasswordPolicy("aaaaaaaaaaaaaaaaaaaa"), { ok: true }); // no rule against repeats or missing digits
    });

    test("length is in characters, not bytes: ë and ç do not count double", () => {
        assert.deepEqual(checkPasswordPolicy("ë".repeat(15)), { ok: true });
        assert.deepEqual(checkPasswordPolicy("ë".repeat(14)), { ok: false, code: "PASSWORD_TOO_SHORT" });
    });

    test("not a string is invalid", () => {
        for (const bad of [undefined, null, 15, {}, ["a".repeat(20)]]) assert.deepEqual(checkPasswordPolicy(bad), { ok: false, code: "PASSWORD_INVALID" });
    });
});

describe("password hashing", () => {
    const hasher = createPasswordHasher({ params: FAST });

    test("the stored form carries its cost, a salt and the hash, and never the password", async () => {
        const stored = await hasher.hash(GOOD);
        assert.match(stored, /^scrypt\$N=1024,r=8,p=1\$[A-Za-z0-9_-]+\$[A-Za-z0-9_-]+$/);
        assert.equal(stored.includes(GOOD), false);
    });

    test("the right password verifies and a wrong one does not; the same password hashes differently each time", async () => {
        const a = await hasher.hash(GOOD);
        const b = await hasher.hash(GOOD);
        assert.notEqual(a, b);
        assert.equal(await hasher.verify(GOOD, a), true);
        assert.equal(await hasher.verify(GOOD + "!", a), false);
        assert.equal(await hasher.verify("", a), false);
    });

    test("equivalent Unicode forms of one password are the same password", async () => {
        const composed = "ë".repeat(5) + " ".repeat(10);
        const decomposed = "ë".repeat(5) + " ".repeat(10);
        assert.equal(await hasher.verify(decomposed, await hasher.hash(composed)), true);
    });

    test("anything that is not one of our hashes verifies as false, never throws", async () => {
        for (const junk of [undefined, null, "", "plain", "scrypt$", "scrypt$N=3,r=8,p=1$aa$bb", "bcrypt$N=1024,r=8,p=1$aa$bb", "scrypt$N=1024,r=8,p=1$aa$bb$extra", "scrypt$N=2147483648,r=8,p=1$aa$bb"]) {
            assert.equal(await hasher.verify(GOOD, junk), false, String(junk));
        }
        assert.equal(await hasher.verify(undefined, await hasher.hash(GOOD)), false);
    });

    test("an old, cheaper hash is recognised so it can be upgraded after a sign-in", async () => {
        const cheap = await createPasswordHasher({ params: { N: 512, r: 8, p: 1 } }).hash(GOOD);
        assert.equal(hasher.needsRehash(cheap), true);
        assert.equal(await hasher.verify(GOOD, cheap), true); // and it still verifies
        assert.equal(hasher.needsRehash(await hasher.hash(GOOD)), false);
        assert.equal(hasher.needsRehash("junk"), true);
    });

    test("hashing at the same time is capped: a burst queues instead of using all the memory", async () => {
        const capped = createPasswordHasher({ params: FAST, maxConcurrent: 2 });
        let peak = 0;
        const sampler = setInterval(() => (peak = Math.max(peak, capped.inFlight.running)), 1);
        const results = await Promise.all(Array.from({ length: 8 }, (_, i) => capped.hash(`password number ${i} long enough`)));
        clearInterval(sampler);
        assert.equal(results.length, 8);
        assert.ok(peak <= 2, `peak was ${peak}`);
        assert.deepEqual(capped.inFlight, { running: 0, waiting: 0 });
    });

    test("the default cost is the ruled one, N=2^15 r=8 p=3", async () => {
        const real = createPasswordHasher();
        const stored = await real.hash(GOOD);
        assert.match(stored, /^scrypt\$N=32768,r=8,p=3\$/);
        assert.equal(await real.verify(GOOD, stored), true);
    });
});

describe("the compromised-password check", () => {
    const sha1Of = async (text) => (await import("node:crypto")).createHash("sha1").update(text).digest("hex").toUpperCase();

    test("only the first five characters of the hash are sent, never the password, and a match is found locally", async () => {
        const hash = await sha1Of("password-that-leaked");
        const requests = [];
        const check = createPwnedCheck({
            fetch: async (url, init) => {
                requests.push({ url, init });
                return new Response(`0000000000000000000000000000000000A:3\r\n${hash.slice(5)}:81234\r\nFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF:0`, { status: 200 });
            },
        });

        assert.deepEqual(await check("password-that-leaked"), { status: "compromised", count: 81234 });
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, `https://api.pwnedpasswords.com/range/${hash.slice(0, 5)}`);
        assert.equal(requests[0].url.includes("leaked"), false);
        assert.equal(requests[0].url.includes(hash.slice(5)), false);
        assert.equal(requests[0].init.headers["Add-Padding"], "true");
    });

    test("not in the list: clean; a padded entry with a count of 0 is not a match", async () => {
        const hash = await sha1Of("another password entirely");
        const padded = createPwnedCheck({ fetch: async () => new Response(`${hash.slice(5)}:0\r\n1234567890123456789012345678901234A:5`, { status: 200 }) });
        assert.deepEqual(await padded("another password entirely"), { status: "clean" });
    });

    test("an error, a refusal or a timeout is 'unavailable', never 'clean'", async () => {
        assert.deepEqual(await createPwnedCheck({ fetch: async () => new Response("", { status: 503 }) })("x".repeat(20)), { status: "unavailable" });
        assert.deepEqual(await createPwnedCheck({ fetch: async () => { throw new Error("offline"); } })("x".repeat(20)), { status: "unavailable" });
    });
});

describe("sign-up and e-mail verification", () => {
    let ctx;
    beforeEach(() => (ctx = setup()));

    test("an account is made with a hash, and a verification link built from the configured address goes out", async () => {
        const mail = await registered(ctx);
        assert.equal(mail.to, "arta@example.test");
        assert.match(mail.link, new RegExp(`^${BASE_URL}/app/verify#token=`));
        const user = await ctx.repo.findUserByEmail("arta@example.test");
        assert.match(user.passwordHash, /^scrypt\$/);
        assert.equal(JSON.stringify(user).includes(GOOD), false);
        assert.equal(user.emailVerifiedAt, null);
    });

    test("the e-mail address is tidied: case and surrounding spaces do not make a second account", async () => {
        await registered(ctx, "  Arta@Example.TEST ");
        assert.equal((await ctx.repo.findUserByEmail("arta@example.test")).email, "arta@example.test");
        assert.equal(normaliseEmail("a@b"), null);
        assert.equal(normaliseEmail("a b@c.de"), null);
        assert.equal(normaliseEmail("x".repeat(250) + "@a.bc"), null);
        assert.equal(normaliseEmail(7), null);
    });

    test("each refusal has its own code and creates nothing", async () => {
        const cases = [
            [{ email: "not-an-email", password: GOOD, name: "A", confirmsAge16: true }, "EMAIL_INVALID"],
            [{ email: "a@b.cd", password: GOOD, name: "   ", confirmsAge16: true }, "NAME_INVALID"],
            [{ email: "a@b.cd", password: GOOD, name: "x".repeat(81), confirmsAge16: true }, "NAME_INVALID"],
            [{ email: "a@b.cd", password: GOOD, name: "A", confirmsAge16: false }, "AGE_NOT_CONFIRMED"],
            [{ email: "a@b.cd", password: GOOD, name: "A" }, "AGE_NOT_CONFIRMED"],
            [{ email: "a@b.cd", password: "short", name: "A", confirmsAge16: true }, "PASSWORD_TOO_SHORT"],
        ];
        for (const [input, code] of cases) assert.equal((await ctx.service.signUp(input)).code, code, code);
        assert.equal(await ctx.repo.findUserByEmail("a@b.cd"), undefined);
        await flush();
        assert.deepEqual(ctx.mail, []);
    });

    test("a known-compromised password is refused; if the check cannot be made, that is said, not ignored", async () => {
        const compromised = setup({ passwordCheck: async () => ({ status: "compromised", count: 9 }) });
        assert.equal((await compromised.service.signUp({ email: "a@b.cd", password: GOOD, name: "A", confirmsAge16: true })).code, "PASSWORD_COMPROMISED");
        const unavailable = setup({ passwordCheck: async () => ({ status: "unavailable" }) });
        assert.equal((await unavailable.service.signUp({ email: "a@b.cd", password: GOOD, name: "A", confirmsAge16: true })).code, "PASSWORD_CHECK_UNAVAILABLE");
        assert.equal(await unavailable.repo.findUserByEmail("a@b.cd"), undefined);
    });

    test("signing up with an address that has an account gives the same answer and a different e-mail to its owner", async () => {
        await registered(ctx);
        const again = await ctx.service.signUp({ email: "arta@example.test", password: "een heel andere lange zin", name: "Ndokush", confirmsAge16: true });
        const first = await ctx.service.signUp({ email: "tjeter@example.test", password: GOOD, name: "Tjetër", confirmsAge16: true });
        await flush();
        assert.deepEqual(again, first);
        assert.deepEqual(ctx.mail.filter((m) => m.to === "arta@example.test").map((m) => m.kind), ["verification", "exists"]);
        // And the existing account is untouched.
        assert.equal((await ctx.repo.findUserByEmail("arta@example.test")).name, "Arta");
        assert.equal((await signedIn(ctx)).user.name, "Arta");
    });

    test("verifying: once, then the link is dead; unknown and malformed tokens are one code", async () => {
        const mail = await registered(ctx);
        const token = tokenIn(mail.link);
        assert.deepEqual(await ctx.service.verifyEmail(token), { ok: true });
        assert.notEqual((await ctx.repo.findUserByEmail("arta@example.test")).emailVerifiedAt, null);
        assert.deepEqual(await ctx.service.verifyEmail(token), { ok: false, code: "TOKEN_INVALID" });
        for (const bad of ["nope", "", undefined, "x".repeat(300), null]) assert.equal((await ctx.service.verifyEmail(bad)).code, "TOKEN_INVALID");
    });

    test("a verification link expires after 24 hours", async () => {
        const token = tokenIn((await registered(ctx)).link);
        ctx.clock.advance(24 * 3_600_000 + 1000);
        assert.equal((await ctx.service.verifyEmail(token)).code, "TOKEN_INVALID");
    });

    test("a new link replaces the old one", async () => {
        const first = tokenIn((await registered(ctx)).link);
        const user = await ctx.repo.findUserByEmail("arta@example.test");
        await ctx.service.resendVerification(user.id);
        await flush();
        const second = tokenIn(ctx.mail.filter((m) => m.kind === "verification").at(-1).link);
        assert.notEqual(first, second);
        assert.equal((await ctx.service.verifyEmail(first)).code, "TOKEN_INVALID");
        assert.equal((await ctx.service.verifyEmail(second)).ok, true);
    });

    test("sync and AI need a verified address; the rest of the account does not", async () => {
        const token = tokenIn((await registered(ctx)).link);
        const before = await signedIn(ctx);
        assert.equal(ctx.service.canUseSyncAndAi(before.user), false);
        await ctx.service.verifyEmail(token);
        assert.equal(ctx.service.canUseSyncAndAi((await signedIn(ctx)).user), true);
    });

    test("the verification token is stored only as a hash", async () => {
        const token = tokenIn((await registered(ctx)).link);
        const record = await ctx.repo.findTokenByHash("verify", hashToken(token));
        assert.ok(record);
        assert.equal(JSON.stringify(record).includes(token), false);
    });
});

describe("signing in and sessions", () => {
    let ctx;
    beforeEach(async () => {
        ctx = setup();
        await registered(ctx);
    });

    test("signing in gives a token; only its hash is stored", async () => {
        const login = await signedIn(ctx);
        assert.equal(login.user.email, "arta@example.test");
        const stored = await ctx.repo.findSessionByTokenHash(hashToken(login.token));
        assert.equal(stored.id, login.sessionId);
        assert.equal(JSON.stringify(await ctx.repo.listSessions(login.user.id)).includes(login.token), false);
    });

    test("a wrong password and an unknown address are the same answer, and cost the same work", async () => {
        ctx.verifyCalls.length = 0;
        const wrong = await ctx.service.logIn({ email: "arta@example.test", password: "e gabuar e gabuar e gabuar" });
        const unknown = await ctx.service.logIn({ email: "askush@example.test", password: "e gabuar e gabuar e gabuar" });
        const malformed = await ctx.service.logIn({ email: "nuk-eshte-email", password: GOOD });
        assert.deepEqual(wrong, { ok: false, code: "INVALID_CREDENTIALS" });
        assert.deepEqual(unknown, wrong);
        assert.deepEqual(malformed, wrong);
        // One password verification each, against a real hash or the decoy: no early exit that shows which addresses exist.
        assert.equal(ctx.verifyCalls.length, 3);
        assert.ok(ctx.verifyCalls.every((stored) => stored.startsWith("scrypt$")));
    });

    test("a very long password is refused without being hashed", async () => {
        ctx.verifyCalls.length = 0;
        const result = await ctx.service.logIn({ email: "arta@example.test", password: "a".repeat(LIMITS.maxPasswordInput + 1) });
        assert.equal(result.code, "INVALID_CREDENTIALS");
        assert.ok(ctx.verifyCalls.every((stored) => stored.startsWith("scrypt$")));
    });

    test("every sign-in is a new session with a new token", async () => {
        const a = await signedIn(ctx);
        const b = await signedIn(ctx);
        assert.notEqual(a.token, b.token);
        assert.notEqual(a.sessionId, b.sessionId);
        assert.equal((await ctx.service.authenticate(a.token)).ok, true);
        assert.equal((await ctx.service.authenticate(b.token)).ok, true);
    });

    test("a cheaper old hash is upgraded at sign-in", async () => {
        const user = await ctx.repo.findUserByEmail("arta@example.test");
        const cheap = await createPasswordHasher({ params: { N: 512, r: 8, p: 1 } }).hash(GOOD);
        await ctx.repo.updateUser(user.id, { passwordHash: cheap });
        await signedIn(ctx);
        const upgraded = (await ctx.repo.findUserByEmail("arta@example.test")).passwordHash;
        assert.match(upgraded, /N=1024/);
        assert.equal((await signedIn(ctx)).ok, true);
    });

    test("a token that is unknown, malformed or missing is not signed in", async () => {
        for (const bad of [undefined, null, "", "short", "x".repeat(300), "a-token-that-was-never-issued-by-us"]) {
            assert.deepEqual(await ctx.service.authenticate(bad), { ok: false, code: "UNAUTHENTICATED" });
        }
    });

    test("30 days without use ends a session; use within the window keeps it", async () => {
        const { token } = await signedIn(ctx);
        ctx.clock.advance(29 * 86_400_000);
        assert.equal((await ctx.service.authenticate(token)).ok, true); // and this use renews the window
        ctx.clock.advance(29 * 86_400_000);
        assert.equal((await ctx.service.authenticate(token)).ok, true);
        ctx.clock.advance(31 * 86_400_000);
        assert.equal((await ctx.service.authenticate(token)).ok, false);
    });

    test("90 days from sign-in ends a session however often it was used", async () => {
        const { token } = await signedIn(ctx);
        for (let day = 1; day <= 89; day++) {
            ctx.clock.advance(86_400_000);
            assert.equal((await ctx.service.authenticate(token)).ok, true, `day ${day}`);
        }
        ctx.clock.advance(2 * 86_400_000);
        assert.equal((await ctx.service.authenticate(token)).ok, false);
    });

    test("an expired session is removed, not just refused", async () => {
        const { token, user } = await signedIn(ctx);
        ctx.clock.advance(31 * 86_400_000);
        await ctx.service.authenticate(token);
        assert.deepEqual(await ctx.repo.listSessions(user.id), []);
    });

    test("last-seen is written at most once a minute", async () => {
        const { token, sessionId } = await signedIn(ctx);
        const seen = async () => (await ctx.repo.listSessions((await ctx.service.authenticate(token)).user.id)).find((s) => s.id === sessionId).lastSeenAt;
        const first = await seen();
        ctx.clock.advance(30_000);
        assert.equal(await seen(), first);
        ctx.clock.advance(31_000);
        assert.notEqual(await seen(), first);
    });

    test("signing out ends that session only", async () => {
        const a = await signedIn(ctx);
        const b = await signedIn(ctx);
        await ctx.service.logOut(a.token);
        assert.equal((await ctx.service.authenticate(a.token)).ok, false);
        assert.equal((await ctx.service.authenticate(b.token)).ok, true);
        assert.deepEqual(await ctx.service.logOut("never-issued-token-value-here"), { ok: true });
    });

    test("the device list marks the current one; one's own sessions can be ended, someone else's cannot", async () => {
        await registered(ctx, "tjeter@example.test");
        const mine = await signedIn(ctx);
        const phone = await ctx.service.logIn({ email: "arta@example.test", password: GOOD, userAgent: "Chrome on Android" });
        const other = await signedIn(ctx, "tjeter@example.test");

        const list = await ctx.service.listSessions(mine.user.id, mine.sessionId);
        assert.equal(list.length, 2);
        assert.deepEqual(list.map((s) => [s.device, s.current]).sort(), [["Chrome on Android", false], ["Edge on Windows", true]]);
        assert.equal(JSON.stringify(list).includes(mine.token), false);

        assert.deepEqual(await ctx.service.revokeSession(mine.user.id, other.sessionId), { ok: false, code: "NOT_FOUND" });
        assert.equal((await ctx.service.authenticate(other.token)).ok, true);
        assert.deepEqual(await ctx.service.revokeSession(mine.user.id, phone.sessionId), { ok: true });
        assert.equal((await ctx.service.authenticate(phone.token)).ok, false);
    });

    test("'sign out everywhere else' keeps this session", async () => {
        const here = await signedIn(ctx);
        const there = await signedIn(ctx);
        assert.deepEqual(await ctx.service.revokeOtherSessions(here.user.id, here.sessionId), { ok: true, removed: 1 });
        assert.equal((await ctx.service.authenticate(here.token)).ok, true);
        assert.equal((await ctx.service.authenticate(there.token)).ok, false);
    });
});

describe("forgotten password", () => {
    let ctx;
    beforeEach(async () => {
        ctx = setup();
        await registered(ctx);
    });
    const resetToken = async () => tokenIn(ctx.mail.filter((m) => m.kind === "reset").at(-1).link);

    test("the answer is the same for an address with an account and one without; only the first gets a link", async () => {
        const known = await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        const unknown = await ctx.service.requestPasswordReset({ email: "askush@example.test" });
        const malformed = await ctx.service.requestPasswordReset({ email: "???" });
        await flush();
        assert.deepEqual(known, { ok: true });
        assert.deepEqual(unknown, known);
        assert.deepEqual(malformed, known);
        assert.deepEqual(ctx.mail.filter((m) => m.kind === "reset").map((m) => m.to), ["arta@example.test"]);
    });

    test("the link is built from the configured address, with the token in the fragment", async () => {
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        await flush();
        const link = ctx.mail.find((m) => m.kind === "reset").link;
        assert.match(link, new RegExp(`^${BASE_URL}/app/reset#token=[A-Za-z0-9_-]+$`));
        assert.equal(new URL(link).search, "");
    });

    test("the new password works and the old one does not; no one is signed in by it; every session ends; the owner is told", async () => {
        const session = await signedIn(ctx);
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        await flush();
        const newPassword = "een nieuwe zin voor na het vergeten";
        const result = await ctx.service.resetPassword({ token: await resetToken(), newPassword });
        await flush();

        assert.deepEqual(result, { ok: true });
        assert.equal("token" in result, false);
        assert.equal((await ctx.service.authenticate(session.token)).ok, false);
        assert.equal((await ctx.service.logIn({ email: "arta@example.test", password: GOOD })).ok, false);
        assert.equal((await ctx.service.logIn({ email: "arta@example.test", password: newPassword })).ok, true);
        assert.equal(ctx.mail.filter((m) => m.kind === "changed").length, 1);
        assert.notEqual((await ctx.repo.findUserByEmail("arta@example.test")).emailVerifiedAt, null);
    });

    test("the link works once", async () => {
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        await flush();
        const token = await resetToken();
        assert.equal((await ctx.service.resetPassword({ token, newPassword: "de eerste nieuwe lange zin" })).ok, true);
        assert.equal((await ctx.service.resetPassword({ token, newPassword: "de tweede nieuwe lange zin" })).code, "TOKEN_INVALID");
    });

    test("two uses at the same moment: exactly one succeeds", async () => {
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        await flush();
        const token = await resetToken();
        const results = await Promise.all([
            ctx.service.resetPassword({ token, newPassword: "eerste lange wachtzin voor test" }),
            ctx.service.resetPassword({ token, newPassword: "tweede lange wachtzin voor test" }),
        ]);
        assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
    });

    test("it expires after 30 minutes", async () => {
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        await flush();
        const token = await resetToken();
        ctx.clock.advance(30 * 60_000 + 1000);
        assert.equal((await ctx.service.resetPassword({ token, newPassword: "een nieuwe lange zin hier" })).code, "TOKEN_INVALID");
    });

    test("a newer request makes the earlier link useless", async () => {
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        await flush();
        const first = await resetToken();
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        await flush();
        const second = await resetToken();
        assert.notEqual(first, second);
        assert.equal((await ctx.service.resetPassword({ token: first, newPassword: "een nieuwe lange zin hier" })).code, "TOKEN_INVALID");
        assert.equal((await ctx.service.resetPassword({ token: second, newPassword: "een nieuwe lange zin hier" })).ok, true);
    });

    test("a weak password is refused without using up the link", async () => {
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        await flush();
        const token = await resetToken();
        assert.equal((await ctx.service.resetPassword({ token, newPassword: "kort" })).code, "PASSWORD_TOO_SHORT");
        assert.equal((await ctx.service.resetPassword({ token, newPassword: "een nieuwe lange zin hier" })).ok, true);
    });

    test("an unknown token is one code, and nothing changes", async () => {
        const before = (await ctx.repo.findUserByEmail("arta@example.test")).passwordHash;
        assert.equal((await ctx.service.resetPassword({ token: "x".repeat(40), newPassword: "een nieuwe lange zin hier" })).code, "TOKEN_INVALID");
        assert.equal((await ctx.repo.findUserByEmail("arta@example.test")).passwordHash, before);
    });

    test("changing the password: the current one is required; other sessions end, this one stays", async () => {
        const here = await signedIn(ctx);
        const there = await signedIn(ctx);
        const wrong = await ctx.service.changePassword({ userId: here.user.id, currentPassword: "e gabuar e gabuar", newPassword: "een nieuwe lange zin hier", currentSessionId: here.sessionId });
        assert.equal(wrong.code, "INVALID_CREDENTIALS");

        const done = await ctx.service.changePassword({ userId: here.user.id, currentPassword: GOOD, newPassword: "een nieuwe lange zin hier", currentSessionId: here.sessionId });
        assert.deepEqual(done, { ok: true });
        assert.equal((await ctx.service.authenticate(here.token)).ok, true);
        assert.equal((await ctx.service.authenticate(there.token)).ok, false);
    });
});

describe("plans and marks", () => {
    let ctx;
    let arta;
    let besa;
    const session = (id) => ({ id, status: "pending", date: "2026-10-15", startTime: "08:00", endTime: "09:00", type: "learning", title: "Seancë " + id });
    const plan = (id = "p1", sessions = ["s1", "s2"]) => ({ id, subject: "Matematikë", sessions: sessions.map(session) });
    let op = 0;
    const mark = (userId, sessionId, status, base, planId = "p1") => ctx.service.markSession(userId, planId, sessionId, { opId: `operation-${++op}`, status, baseSessionRevision: base });

    beforeEach(async () => {
        ctx = setup();
        await registered(ctx);
        await registered(ctx, "besa@example.test");
        arta = (await signedIn(ctx)).user;
        besa = (await signedIn(ctx, "besa@example.test")).user;
        await ctx.service.createPlan(arta.id, plan());
    });

    test("a new plan starts at revision 1 with its sessions at revision 0", async () => {
        const [stored] = await ctx.service.listPlans(arta.id);
        assert.equal(stored.revision, 1);
        assert.deepEqual(stored.sessions.map((s) => s.revision), [0, 0]);
    });

    test("a taken plan id is reported and nothing is replaced", async () => {
        const result = await ctx.service.createPlan(arta.id, { ...plan(), subject: "Ndërhyrësi" });
        assert.deepEqual(result, { ok: false, code: "PLAN_EXISTS" });
        assert.equal((await ctx.service.listPlans(arta.id))[0].subject, "Matematikë");
    });

    test("a person has a limit on plans", async () => {
        for (let i = 2; i <= LIMITS.maxPlansPerUser; i++) assert.equal((await ctx.service.createPlan(arta.id, plan(`p${i}`, []))).ok, true);
        assert.equal((await ctx.service.createPlan(arta.id, plan("one-too-many", []))).code, "PLAN_LIMIT");
    });

    test("another person's plans are not found, whatever is asked: not listed, not marked, not changed, not deleted", async () => {
        assert.deepEqual(await ctx.service.listPlans(besa.id), []);
        assert.equal((await mark(besa.id, "s1", "completed", 0)).code, "NOT_FOUND");
        assert.equal((await ctx.service.updatePlan(besa.id, "p1", { subject: "X" }, 1)).code, "NOT_FOUND");
        assert.equal((await ctx.service.deletePlan(besa.id, "p1")).code, "NOT_FOUND");
        assert.equal((await ctx.service.listPlans(arta.id))[0].sessions[0].status, "pending");
    });

    test("a mark changes that session, raises its revision, and is applied", async () => {
        const result = await mark(arta.id, "s1", "completed", 0);
        assert.deepEqual(result, { ok: true, duplicate: false, status: "completed", sessionRevision: 1 });
        const [stored] = await ctx.service.listPlans(arta.id);
        assert.deepEqual(stored.sessions.map((s) => [s.status, s.revision]), [["completed", 1], ["pending", 0]]);
        assert.equal(stored.revision, 2);
    });

    test("sending the same operation again changes nothing", async () => {
        const input = { opId: "retry-after-lost-answer", status: "completed", baseSessionRevision: 0 };
        const first = await ctx.service.markSession(arta.id, "p1", "s1", input);
        const again = await ctx.service.markSession(arta.id, "p1", "s1", input);
        assert.equal(first.duplicate, false);
        assert.deepEqual(again, { ok: true, duplicate: true, status: "completed", sessionRevision: 1 });
        assert.equal((await ctx.service.listPlans(arta.id))[0].sessions[0].revision, 1);
    });

    test("a mark made from a session state that has since changed is refused and the current state returned", async () => {
        await mark(arta.id, "s1", "completed", 0); // the laptop
        const phone = await mark(arta.id, "s1", "skipped", 0); // the phone, offline, still based on revision 0
        assert.deepEqual(phone, { ok: false, code: "MARK_CONFLICT", current: { status: "completed", sessionRevision: 1 } });
        assert.equal((await ctx.service.listPlans(arta.id))[0].sessions[0].status, "completed");
        // The phone shows what it was told and marks again from there.
        assert.equal((await mark(arta.id, "s1", "skipped", 1)).ok, true);
    });

    test("no client clock is consulted: the order is the revision, not a time", async () => {
        const result = await ctx.service.markSession(arta.id, "p1", "s1", { opId: "operation-with-a-timestamp", status: "partial", baseSessionRevision: 0, at: "1999-01-01T00:00:00Z", clientTime: 0 });
        assert.equal(result.ok, true);
    });

    test("marks on different sessions of one plan, sent at the same moment, are both kept", async () => {
        const results = await Promise.all([mark(arta.id, "s1", "completed", 0), mark(arta.id, "s2", "partial", 0)]);
        assert.deepEqual(results.map((r) => r.ok), [true, true]);
        assert.deepEqual((await ctx.service.listPlans(arta.id))[0].sessions.map((s) => s.status), ["completed", "partial"]);
    });

    test("two marks on one session at the same moment: one wins, the other gets a conflict", async () => {
        const results = await Promise.all([mark(arta.id, "s1", "completed", 0), mark(arta.id, "s1", "skipped", 0)]);
        assert.deepEqual(results.map((r) => r.ok).sort(), [false, true]);
    });

    test("operation and status are validated", async () => {
        assert.equal((await ctx.service.markSession(arta.id, "p1", "s1", { opId: "x", status: "completed", baseSessionRevision: 0 })).code, "OPERATION_INVALID");
        assert.equal((await ctx.service.markSession(arta.id, "p1", "s1", { opId: "operation-ok-1", status: "great", baseSessionRevision: 0 })).code, "STATUS_INVALID");
        assert.equal((await mark(arta.id, "nope", "completed", 0)).code, "NOT_FOUND");
    });

    test("changing a plan from a stale revision is refused and returns the current plan", async () => {
        await mark(arta.id, "s1", "completed", 0); // plan is now at revision 2
        const stale = await ctx.service.updatePlan(arta.id, "p1", { subject: "Ndryshuar" }, 1);
        assert.equal(stale.code, "REVISION_CONFLICT");
        assert.equal(stale.current.revision, 2);
        assert.equal((await ctx.service.listPlans(arta.id))[0].subject, "Matematikë");
    });

    test("a re-plan keeps the marks the server holds, even ones made on another device meanwhile", async () => {
        await mark(arta.id, "s1", "completed", 0);
        const [current] = await ctx.service.listPlans(arta.id);
        // The re-plan was prepared on a device that still showed s1 as pending, and adds s3.
        const replanned = await ctx.service.updatePlan(arta.id, "p1", { strategy: "E re", sessions: [session("s1"), session("s2"), session("s3")] }, current.revision);
        assert.equal(replanned.ok, true);
        assert.deepEqual(replanned.plan.sessions.map((s) => [s.id, s.status, s.revision]), [["s1", "completed", 1], ["s2", "pending", 0], ["s3", "pending", 0]]);
        assert.equal(replanned.plan.revision, current.revision + 1);
    });

    test("a plan can be deleted by its owner", async () => {
        assert.deepEqual(await ctx.service.deletePlan(arta.id, "p1"), { ok: true });
        assert.deepEqual(await ctx.service.listPlans(arta.id), []);
    });

    test("the export holds the person's data and nothing secret", async () => {
        await mark(arta.id, "s1", "completed", 0);
        const exported = await ctx.service.exportAccount(arta.id);
        assert.equal(exported.ok, true);
        assert.deepEqual(exported.account, { email: "arta@example.test", name: "Arta", createdAt: exported.account.createdAt, emailVerified: false });
        assert.equal(exported.plans.length, 1);
        const text = JSON.stringify(exported);
        for (const secret of ["scrypt$", "passwordHash", "tokenHash", "appliedOps"]) assert.equal(text.includes(secret), false, secret);
    });

    test("deleting the account needs the password and then leaves nothing behind", async () => {
        const login = await signedIn(ctx);
        await ctx.service.requestPasswordReset({ email: "arta@example.test" });
        assert.equal((await ctx.service.deleteAccount({ userId: arta.id, password: "e gabuar e gabuar e gabuar" })).code, "INVALID_CREDENTIALS");
        assert.equal(await ctx.repo._holdsAnythingFor(arta.id), true);

        assert.deepEqual(await ctx.service.deleteAccount({ userId: arta.id, password: GOOD }), { ok: true });
        await flush();
        assert.equal(await ctx.repo._holdsAnythingFor(arta.id), false);
        assert.equal((await ctx.service.authenticate(login.token)).ok, false);
        assert.equal((await ctx.service.logIn({ email: "arta@example.test", password: GOOD })).ok, false);
        assert.equal(ctx.mail.at(-1).kind, "deleted");
        // Someone else's account is untouched.
        assert.equal(await ctx.repo._holdsAnythingFor(besa.id), true);
    });
});
