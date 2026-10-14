/**
 * Known-compromised password check with the Have I Been Pwned "Pwned Passwords" range API.
 * k-anonymity: the SHA-1 of the password is computed here, only its first five hex characters are
 * sent, and the returned list of suffixes is compared locally. The password and the full hash never
 * leave this process. No API key is needed.
 *
 * Rules (Codex, 2026-10-14): once, after the person has finished entering the password, never per
 * keystroke; the prefix and the returned range are never logged or kept; the person is told a
 * privacy-preserving third-party check is used; when the service cannot be reached the result is
 * "unavailable", which the caller must not treat as "clean".
 */
import { createHash } from "node:crypto";

const ENDPOINT = "https://api.pwnedpasswords.com/range/";

/**
 * @param {{ fetch?: typeof fetch, timeoutMs?: number }} [options]
 * @returns {(password: string) => Promise<{ status: "clean" | "compromised" | "unavailable", count?: number }>}
 */
export function createPwnedCheck({ fetch: fetchFn = globalThis.fetch, timeoutMs = 4000 } = {}) {
    return async function check(password) {
        const sha1 = createHash("sha1").update(password.normalize("NFKC")).digest("hex").toUpperCase();
        const prefix = sha1.slice(0, 5);
        const suffix = sha1.slice(5);

        let body;
        try {
            const response = await fetchFn(ENDPOINT + prefix, {
                // Padding makes every answer a similar size, so the length of the answer does not hint at the prefix.
                headers: { "Add-Padding": "true", "User-Agent": "Orari" },
                signal: AbortSignal.timeout(timeoutMs),
            });
            if (!response.ok) return { status: "unavailable" };
            body = await response.text();
        } catch {
            return { status: "unavailable" };
        }

        for (const line of body.split(/\r?\n/)) {
            const [candidate, count] = line.trim().split(":");
            if (candidate === suffix) {
                const n = Number(count);
                // A padded entry has a count of 0: it is noise, not a match.
                if (n > 0) return { status: "compromised", count: n };
            }
        }
        return { status: "clean" };
    };
}
