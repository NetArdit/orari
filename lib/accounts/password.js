/**
 * Passwords: the policy, and hashing with Node's built-in scrypt.
 *
 * Stored form: scrypt$N=32768,r=8,p=3$<salt, base64url>$<hash, base64url>
 * The cost is part of the string, so it can be raised later and old hashes still verify
 * (needsRehash tells the login code to upgrade a hash after a successful sign-in).
 *
 * Defaults are N=2^15, r=8, p=3: one of the sets the OWASP Password Storage Cheat Sheet lists for
 * scrypt, measured at about 270 ms and 32 MB per hash on the development machine. Re-measure on the
 * real host before release.
 */
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

export const DEFAULT_PARAMS = Object.freeze({ N: 2 ** 15, r: 8, p: 3 });
const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

/**
 * The minimum is 8 characters (the owner's decision, 2026-10-15; OWASP asks for 15 without a second factor, and
 * the lower bar is made up for by the leaked-password check and the sign-in rate limits). Passphrases and spaces
 * are allowed, there are no composition rules, and nothing is truncated: a longer password is refused, not cut.
 */
export const POLICY = Object.freeze({ minLength: 8, maxLength: 128 });

/** Length is counted in characters (code points), not bytes, so a passphrase with letters such as ë or ç is not penalised. */
export function checkPasswordPolicy(password) {
    if (typeof password !== "string") return { ok: false, code: "PASSWORD_INVALID" };
    const length = [...password].length;
    if (length < POLICY.minLength) return { ok: false, code: "PASSWORD_TOO_SHORT" };
    if (length > POLICY.maxLength) return { ok: false, code: "PASSWORD_TOO_LONG" };
    return { ok: true };
}

function parseStored(stored) {
    if (typeof stored !== "string") return null;
    const [scheme, params, salt, hash, ...rest] = stored.split("$");
    if (scheme !== "scrypt" || rest.length > 0 || !params || !salt || !hash) return null;
    const values = Object.fromEntries(params.split(",").map((pair) => pair.split("=")));
    const N = Number(values.N);
    const r = Number(values.r);
    const p = Number(values.p);
    if (![N, r, p].every((n) => Number.isInteger(n) && n > 0) || (N & (N - 1)) !== 0 || N > 2 ** 20) return null;
    return { N, r, p, salt: Buffer.from(salt, "base64url"), hash: Buffer.from(hash, "base64url") };
}

/**
 * @param {{ params?: {N:number,r:number,p:number}, maxConcurrent?: number }} [options]
 *   maxConcurrent: hashing at the same time is capped, so a burst of sign-ins queues instead of
 *   exhausting memory (32 MB each at the defaults).
 */
export function createPasswordHasher({ params = DEFAULT_PARAMS, maxConcurrent = 2 } = {}) {
    let running = 0;
    const waiting = [];

    const acquire = () =>
        new Promise((resolve) => {
            if (running < maxConcurrent) {
                running++;
                resolve();
            } else waiting.push(resolve);
        });
    const release = () => {
        const next = waiting.shift();
        if (next) next();
        else running--;
    };

    const derive = (password, salt, { N, r, p }) =>
        new Promise((resolve, reject) => {
            const maxmem = 128 * N * r * (p + 1) + 1024 * 1024;
            scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r, p, maxmem }, (error, key) => (error ? reject(error) : resolve(key)));
        });

    async function limited(work) {
        await acquire();
        try {
            return await work();
        } finally {
            release();
        }
    }

    return {
        params,

        async hash(password) {
            const salt = randomBytes(SALT_LENGTH);
            const key = await limited(() => derive(password, salt, params));
            return `scrypt$N=${params.N},r=${params.r},p=${params.p}$${salt.toString("base64url")}$${key.toString("base64url")}`;
        },

        /** True only for the right password. A stored value that is not a hash of ours is false, never an exception. */
        async verify(password, stored) {
            const parsed = parseStored(stored);
            if (!parsed || typeof password !== "string") return false;
            const key = await limited(() => derive(password, parsed.salt, parsed));
            return key.length === parsed.hash.length && timingSafeEqual(key, parsed.hash);
        },

        /** Whether a stored hash was made with weaker settings than the current ones. */
        needsRehash(stored) {
            const parsed = parseStored(stored);
            return !parsed || parsed.N < params.N || parsed.r < params.r || parsed.p < params.p;
        },

        get inFlight() {
            return { running, waiting: waiting.length };
        },
    };
}
