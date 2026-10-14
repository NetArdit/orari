/**
 * The SMTP mailer against a real SMTP conversation: a minimal server on 127.0.0.1 accepts the message, and the
 * test reads what arrived. Real nodemailer, real sockets; no provider, so what this does not show is how a
 * particular provider treats the mail (spam filtering, domain authentication).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { smtpSink } from "./helpers/smtpSink.js";
import { createSmtpMail, createSmtpTransport } from "../lib/accounts/smtpMail.js";

const decode = (data) => {
    const body = data.split("\r\n\r\n").slice(1).join("\r\n\r\n");
    return /quoted-printable/i.test(data) ? Buffer.from(body.replace(/=\r\n/g, "").replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8") : /base64/i.test(data) ? Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8") : body;
};

test("a reset mail is delivered over SMTP with the link and Albanian text intact", async () => {
    const sink = await smtpSink();
    try {
        const transport = createSmtpTransport({ SMTP_URL: `smtp://127.0.0.1:${sink.port}` });
        const mail = createSmtpMail({ transport, from: "Orari <no-reply@orari.example>" });
        await mail.sendReset({ to: "arta@example.test", link: "https://orari.example/app/#token=abc_DEF-123" });
        assert.equal(sink.received.length, 1);
        assert.match(sink.received[0].to[0], /arta@example\.test/);
        assert.match(sink.received[0].from, /no-reply@orari\.example/);
        const text = decode(sink.received[0].data);
        assert.match(text, /https:\/\/orari\.example\/app\/#token=abc_DEF-123/);
        assert.match(text, /fjalëkalimin/);
        assert.match(text, /30 minuta/);
    } finally {
        await sink.close();
    }
});

test("a refusal by the provider is an error, so the outbox keeps the message", async () => {
    const sink = await smtpSink({ refuse: true });
    try {
        const mail = createSmtpMail({ transport: createSmtpTransport({ SMTP_URL: `smtp://127.0.0.1:${sink.port}` }), from: "no-reply@orari.example" });
        await assert.rejects(() => mail.sendVerification({ to: "a@example.test", link: "https://orari.example/x" }));
    } finally {
        await sink.close();
    }
});

test("an unreachable provider is an error", async () => {
    const mail = createSmtpMail({ transport: createSmtpTransport({ SMTP_URL: "smtp://127.0.0.1:1" }), from: "no-reply@orari.example" });
    await assert.rejects(() => mail.sendAccountDeleted({ to: "a@example.test" }));
});

test("it refuses to be built without a transport or a sender", () => {
    assert.throws(() => createSmtpMail({ from: "a@b.c" }));
    assert.throws(() => createSmtpMail({ transport: { sendMail() {} }, from: "nobody" }));
    assert.throws(() => createSmtpTransport({}));
});
