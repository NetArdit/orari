/**
 * Seals the one-time link a queued e-mail carries, so that a reader of the database (or of a backup) cannot use
 * a verification or reset link that is waiting to be sent. AES-256-GCM, key derived from a secret that lives
 * only in the server's environment (OUTBOX_SECRET), a fresh nonce per message; the message id is bound as
 * associated data so a sealed link cannot be moved to another message.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

const PREFIX = "sealed:v1:";

export function createLinkSealer(secret) {
    if (typeof secret !== "string" || secret.length < 32) throw new Error("OUTBOX_SECRET must be at least 32 characters.");
    const key = Buffer.from(hkdfSync("sha256", secret, "orari-outbox", "outbox-link-v1", 32));
    return {
        seal(link, messageId) {
            const nonce = randomBytes(12);
            const cipher = createCipheriv("aes-256-gcm", key, nonce);
            cipher.setAAD(Buffer.from(messageId));
            const body = Buffer.concat([cipher.update(link, "utf8"), cipher.final()]);
            return PREFIX + Buffer.concat([nonce, cipher.getAuthTag(), body]).toString("base64url");
        },
        /** Returns null when it was not sealed with this key (a wrong secret, a tampered value). */
        open(sealed, messageId) {
            if (typeof sealed !== "string" || !sealed.startsWith(PREFIX)) return null;
            try {
                const raw = Buffer.from(sealed.slice(PREFIX.length), "base64url");
                const decipher = createDecipheriv("aes-256-gcm", key, raw.subarray(0, 12));
                decipher.setAAD(Buffer.from(messageId));
                decipher.setAuthTag(raw.subarray(12, 28));
                return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
            } catch {
                return null;
            }
        },
    };
}

/** Wraps a repository: links are sealed on the way in and opened on the way out; everything else passes through. */
export function withSealedOutbox(repo, sealer) {
    return {
        ...repo,
        async outboxAdd(message) {
            return repo.outboxAdd(message.link === undefined ? message : { ...message, link: sealer.seal(message.link, message.id) });
        },
        async outboxClaim(args) {
            const claimed = await repo.outboxClaim(args);
            const open = [];
            for (const message of claimed) {
                if (message.link === undefined) {
                    open.push(message);
                    continue;
                }
                const link = sealer.open(message.link, message.id);
                if (link === null) {
                    // Unreadable (another key): give it up rather than send something wrong or retry forever.
                    await repo.outboxFail(message.id, { attempts: (message.attempts ?? 0) + 1, failedAt: new Date().toISOString() });
                    continue;
                }
                open.push({ ...message, link });
            }
            return open;
        },
    };
}
