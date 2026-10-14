import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { createLinkSealer, withSealedOutbox } from "../lib/accounts/postgres/sealedOutbox.js";
import { createPostgresAccountsRepository } from "../lib/accounts/postgres/repository.js";
import { createPool } from "../lib/accounts/postgres/connect.js";
import { createSmtpTransport } from "../lib/accounts/smtpMail.js";
import { startPostgres } from "./helpers/embeddedPg.js";

const SECRET = "a-long-secret-a-long-secret-a-long-secret";
const LINK = "https://orari.example/app/#token=SECRETTOKENVALUE1234567890";
const T0 = "2026-10-14T10:00:00.000Z";

test("a sealed link opens only with the same key and the same message id", () => {
    const sealer = createLinkSealer(SECRET);
    const sealed = sealer.seal(LINK, "m1");
    assert.ok(!sealed.includes("SECRETTOKEN"));
    assert.equal(sealer.open(sealed, "m1"), LINK);
    assert.equal(sealer.open(sealed, "m2"), null, "bound to its message");
    assert.equal(createLinkSealer("another-secret-another-secret-another-1").open(sealed, "m1"), null);
    assert.equal(sealer.open(sealed.slice(0, -2) + "AA", "m1"), null, "tampering is detected");
    assert.equal(sealer.open("plain text", "m1"), null);
    assert.notEqual(sealer.seal(LINK, "m1"), sealed, "a fresh nonce each time");
    assert.throws(() => createLinkSealer("short"));
});

test("the database never holds the usable link; the dispatcher still gets it", async () => {
    const db = await startPostgres();
    try {
        const repo = withSealedOutbox(createPostgresAccountsRepository({ pool: db.pool }), createLinkSealer(SECRET));
        await repo.outboxAdd({ id: "m1", kind: "verification", userId: null, to: "a@example.test", createdAt: T0, nextAttemptAt: T0, attempts: 0, link: LINK });
        const raw = await db.pool.query("SELECT data::text AS d FROM outbox");
        assert.ok(!raw.rows[0].d.includes("SECRETTOKEN"), "raw row has no token");
        assert.ok(!raw.rows[0].d.includes("orari.example"), "raw row has no link");
        const claimed = await repo.outboxClaim({ now: T0, limit: 5, leaseUntil: "2026-10-14T10:02:00.000Z" });
        assert.equal(claimed[0].link, LINK);

        // a different secret cannot read it: the message is given up, not sent
        await db.pool.query("UPDATE outbox SET lease_until = NULL");
        const wrong = withSealedOutbox(createPostgresAccountsRepository({ pool: db.pool }), createLinkSealer("another-secret-another-secret-another-1"));
        assert.deepEqual(await wrong.outboxClaim({ now: T0, limit: 5, leaseUntil: "2026-10-14T10:02:00.000Z" }), []);
        assert.deepEqual(await repo.outboxStats(), { waiting: 0, failed: 1 });
    } finally {
        await db.stop();
    }
});

test("database TLS: weakening modes are refused off this machine, local is allowed", () => {
    for (const mode of ["disable", "allow", "prefer", "no-verify"]) {
        assert.throws(() => createPool({ connectionString: `postgres://u:p@db.example.com/x?sslmode=${mode}` }), /refused/);
    }
    const ok = createPool({ connectionString: "postgres://u:p@db.example.com/x?sslmode=require" });
    ok.end();
    const local = createPool({ connectionString: "postgres://u:p@127.0.0.1:5432/x?sslmode=disable" });
    local.end();
    assert.throws(() => createPool({ connectionString: "mysql://x" }));
});

test("SMTP off this machine must be encrypted; loopback is left alone", () => {
    const remote = createSmtpTransport({ SMTP_URL: "smtp://user:pw@smtp.provider.example:587" });
    assert.equal(remote.transporter.options.requireTLS, true);
    assert.equal(remote.transporter.options.tls.rejectUnauthorized, true);
    const local = createSmtpTransport({ SMTP_URL: "smtp://127.0.0.1:2525" });
    assert.notEqual(local.transporter.options.requireTLS, true);
    assert.equal(remote.transporter.options.connectionTimeout, 10_000);
    assert.throws(() => createSmtpTransport({ SMTP_URL: "not a url" }));
});
