/**
 * The SMTP mailer against a real SMTP conversation: a minimal server on 127.0.0.1 accepts the message, and the
 * test reads what arrived. Real nodemailer, real sockets; no provider, so what this does not show is how a
 * particular provider treats the mail (spam filtering, domain authentication, link tracking).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { smtpSink } from "./helpers/smtpSink.js";
import { createSmtpMail, createSmtpTransport } from "../lib/accounts/smtpMail.js";

const CRLF = "\r\n";

/** Decodes every part of the message (base64 or quoted-printable) and returns them joined. */
function decode(data) {
    return data
        .split(new RegExp(CRLF + "--[^\\r\\n]+"))
        .map((part) => {
            const pieces = part.split(CRLF + CRLF);
            const head = pieces[0];
            const body = pieces.slice(1).join(CRLF + CRLF);
            if (/base64/i.test(head)) return Buffer.from(body.replace(/\s/g, ""), "base64").toString("utf8");
            if (/quoted-printable/i.test(head)) {
                const joined = body.split("=" + CRLF).join("");
                return Buffer.from(joined.replace(/=([0-9A-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16))), "latin1").toString("utf8");
            }
            return body;
        })
        .join("\n");
}

const LONG_LINK = "https://orari-hmgr.onrender.com/app/reset#token=AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdEf";

test("a reset mail is delivered over SMTP with the whole link and Albanian text intact", async () => {
    const sink = await smtpSink();
    try {
        const transport = createSmtpTransport({ SMTP_URL: `smtp://127.0.0.1:${sink.port}` });
        const mail = createSmtpMail({ transport, from: "Orari <no-reply@orari.example>" });
        await mail.sendReset({ to: "arta@example.test", link: LONG_LINK });
        assert.equal(sink.received.length, 1);
        assert.match(sink.received[0].to[0], /arta@example\.test/);
        assert.match(sink.received[0].from, /no-reply@orari\.example/);
        const text = decode(sink.received[0].data);
        assert.ok(text.includes(LONG_LINK), "the plain text holds the link in one piece");
        assert.ok(text.includes(`<a href="${LONG_LINK}">`), "the HTML part carries it as an anchor");
        assert.match(text, /fjalëkalimin/);
        assert.match(text, /30 minuta/);
    } finally {
        await sink.close();
    }
});

test("no line of the message is cut inside the link", async () => {
    const sink = await smtpSink();
    try {
        const mail = createSmtpMail({ transport: createSmtpTransport({ SMTP_URL: `smtp://127.0.0.1:${sink.port}` }), from: "no-reply@orari.example" });
        await mail.sendVerification({ to: "a@example.test", link: LONG_LINK });
        const raw = sink.received[0].data;
        const lines = raw.split(CRLF);
        assert.ok(!lines.some((l) => l.includes("token=3D") || l.includes("#token=")), "the link never appears in a cut, quoted-printable line");
        assert.ok(decode(raw).includes(LONG_LINK));
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
