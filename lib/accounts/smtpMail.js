/**
 * The real mailer: sends the account e-mails over SMTP (any provider: Brevo, Mailgun, Postmark, Gmail with an
 * app password, ...). It has the same five methods as the test mailer, and throws when the provider refuses, so
 * the outbox in the account service keeps the message and retries it.
 *
 * Links reach this code already built from the site's configured address; nothing here reads a request.
 * Mail is plain text: it is read in every client, and carries no tracking.
 */
import nodemailer from "nodemailer";

const SIGNATURE = "\n\n— Orari\nIf you did not expect this message, you can ignore it.";

/**
 * @param {object} options
 * @param {{ sendMail(message: object): Promise<unknown> }} options.transport
 * @param {string} options.from  e.g. 'Orari <no-reply@orari.example>'
 */
export function createSmtpMail({ transport, from }) {
    if (!transport || typeof transport.sendMail !== "function") throw new Error("A transport with sendMail() is required.");
    if (typeof from !== "string" || !from.includes("@")) throw new Error("A sender address is required.");
    // A one-time link is long (about 90 characters). In a quoted-printable plain-text part a line is cut at 76
    // characters, which can put a break INSIDE the token, and some mail paths then deliver a truncated link. So the text
    // part is base64 (no line is ever cut inside the link) and an HTML part carries the link as an anchor, which
    // is what mail clients show and what a click follows.
    const escapeHtml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    const toHtml = (text) =>
        '<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.5;color:#111">' +
        escapeHtml(text)
            .replace(/(https?:\/\/[^\s<]+)/g, (url) => '<a href="' + url + '">' + url + "</a>")
            .split("\n\n")
            .map((paragraph) => "<p>" + paragraph.split("\n").join("<br>") + "</p>")
            .join("") +
        "</div>";
    const send = (to, subject, text) => transport.sendMail({ from, to, subject, text, html: toHtml(text), textEncoding: "base64" });

    return {
        sendVerification: ({ to, link }) =>
            send(to, "Confirm your e-mail address for Orari", `Welcome to Orari.\n\nTo confirm your address, open this link (valid for 24 hours):\n${link}${SIGNATURE}`),
        sendReset: ({ to, link }) =>
            send(to, "Reset your Orari password", `We received a request to reset your password.\n\nOpen this link to set a new password (valid for 30 minutes):\n${link}\n\nIf you did not ask for this, you do not need to do anything: your password stays the same.${SIGNATURE}`),
        sendPasswordChanged: ({ to }) =>
            send(to, "Your Orari password was changed", `The password of your account was changed and every other device was signed out.\n\nIf you did not change it, reset the password right away with "Forgot your password?".${SIGNATURE}`),
        sendAccountExists: ({ to }) =>
            send(to, "You already have an Orari account", `Someone tried to open an account on Orari with this address, but it already exists.\n\nIf it was you, sign in with your password or use "Forgot your password?".${SIGNATURE}`),
        sendAccountDeleted: ({ to }) =>
            send(to, "Your Orari account was deleted", `Your Orari account and the plans stored in it were deleted.\n\nThe plans on your own devices stay there until you delete them yourself.${SIGNATURE}`),
    };
}

/** The production transport from environment variables. SMTP_URL is smtps://user:pass@host:465 or smtp://...:587 */
export function createSmtpTransport(env) {
    if (!env.SMTP_URL) throw new Error("SMTP_URL is required (for example smtps://user:password@smtp.example.com:465).");
    let url;
    try {
        url = new URL(env.SMTP_URL);
    } catch {
        throw new Error("SMTP_URL is not a valid address.");
    }
    const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
    // Off this machine the connection must be encrypted: smtps:// from the start, or smtp:// that must upgrade
    // with STARTTLS (and fails when the provider does not offer it), never a silent fall back to plain text.
    return nodemailer.createTransport({
        url: env.SMTP_URL,
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
        ...(loopback ? {} : { requireTLS: true, tls: { rejectUnauthorized: true } }),
    });
}
