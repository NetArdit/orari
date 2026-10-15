import { test } from "node:test";
import assert from "node:assert/strict";

import { createMemoryAccountsRepository } from "../lib/accounts/memoryRepository.js";
import { createPasswordHasher } from "../lib/accounts/password.js";
import { createAccountService } from "../lib/accounts/service.js";
import { createTestMail } from "../lib/accounts/testMail.js";

const PASSWORD = "Qershor-Lule-47x";
const flush = () => new Promise((resolve) => setImmediate(resolve));
const tokenIn = (link) => decodeURIComponent(link.split("#token=")[1]);

async function setup() {
    const mail = createTestMail();
    const repo = createMemoryAccountsRepository();
    const service = createAccountService({
        repo,
        hasher: createPasswordHasher({ params: { N: 1024, r: 8, p: 1 } }),
        mail,
        baseUrl: "https://orari.example",
        passwordCheck: async () => ({ status: "clean" }),
    });
    const join = async (email, name = "Arta") => {
        await service.signUp({ email, password: PASSWORD, name, confirmsAge16: true });
        await flush();
        const verification = mail.messages.find((m) => m.kind === "verification" && m.to === email);
        await service.verifyEmail(tokenIn(verification.link));
        return (await repo.findUserByEmail(email)).id;
    };
    return { service, repo, mail, join };
}

test("the display name can be changed, and an empty or very long one is refused", async () => {
    const { service, repo, join } = await setup();
    const id = await join("arta@example.test");
    const changed = await service.updateName({ userId: id, name: "  Arta Krasniqi  " });
    assert.equal(changed.ok, true);
    assert.equal(changed.user.name, "Arta Krasniqi");
    assert.equal((await repo.findUserById(id)).name, "Arta Krasniqi");
    assert.deepEqual(await service.updateName({ userId: id, name: "   " }), { ok: false, code: "NAME_INVALID" });
    assert.deepEqual(await service.updateName({ userId: id, name: "x".repeat(81) }), { ok: false, code: "NAME_INVALID" });
});

test("the address changes only after the link sent to the NEW address is followed, and needs the password", async () => {
    const { service, repo, mail, join } = await setup();
    const id = await join("old@example.test");

    assert.deepEqual(await service.requestEmailChange({ userId: id, currentPassword: "wrong password here", newEmail: "new@example.test" }), { ok: false, code: "INVALID_CREDENTIALS" });
    assert.deepEqual(await service.requestEmailChange({ userId: id, currentPassword: PASSWORD, newEmail: "not an address" }), { ok: false, code: "EMAIL_INVALID" });

    assert.equal((await service.requestEmailChange({ userId: id, currentPassword: PASSWORD, newEmail: "New@Example.test" })).ok, true);
    await flush();
    const sent = mail.messages.filter((m) => m.kind === "verification" && m.to === "new@example.test");
    assert.equal(sent.length, 1, "the link goes to the new address only");
    assert.equal((await repo.findUserById(id)).email, "old@example.test", "nothing changes before the link is followed");
    assert.equal(await repo.findUserByEmail("new@example.test"), undefined);

    assert.equal((await service.verifyEmail(tokenIn(sent[0].link))).ok, true);
    assert.equal((await repo.findUserById(id)).email, "new@example.test");
    assert.equal(await repo.findUserByEmail("old@example.test"), undefined);
    assert.equal((await repo.findUserByEmail("new@example.test")).id, id);
    // the same link cannot be used twice
    assert.deepEqual(await service.verifyEmail(tokenIn(sent[0].link)), { ok: false, code: "TOKEN_INVALID" });
});

test("an address that already has an account is not revealed, and does not move", async () => {
    const { service, repo, mail, join } = await setup();
    const a = await join("a@example.test");
    await join("b@example.test");
    const answer = await service.requestEmailChange({ userId: a, currentPassword: PASSWORD, newEmail: "b@example.test" });
    assert.deepEqual(answer, { ok: true, status: "check_email" });
    await flush();
    assert.ok(mail.messages.some((m) => m.kind === "exists" && m.to === "b@example.test"));
    assert.equal((await repo.findUserById(a)).email, "a@example.test");
});

test("a link for an address that was taken meanwhile is refused", async () => {
    const { service, repo, mail, join } = await setup();
    const a = await join("a@example.test");
    await service.requestEmailChange({ userId: a, currentPassword: PASSWORD, newEmail: "c@example.test" });
    await flush();
    const link = mail.messages.find((m) => m.kind === "verification" && m.to === "c@example.test").link;
    await join("c@example.test", "Someone Else");
    assert.deepEqual(await service.verifyEmail(tokenIn(link)), { ok: false, code: "TOKEN_INVALID" });
    assert.equal((await repo.findUserById(a)).email, "a@example.test");
});
