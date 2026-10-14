/**
 * Memory-mode accounts keep everything in process memory and write mail links to a local file.
 * They must never be reachable from outside this computer, and the insecure cookie must not leave it either.
 * This is checked in code rather than left to the README.
 */
const LOOPBACK = new Set(["127.0.0.1", "::1", "localhost"]);

export function isLoopbackHost(host) {
    return typeof host === "string" && LOOPBACK.has(host.toLowerCase());
}

/** @returns {{ok:true, host:string} | {ok:false, reason:string}} */
export function checkMemoryAccountsEnvironment(env) {
    if (env.NODE_ENV === "production") return { ok: false, reason: "ACCOUNTS_MODE=memory is refused when NODE_ENV=production." };
    const host = env.HOST || "127.0.0.1";
    if (!isLoopbackHost(host)) return { ok: false, reason: `ACCOUNTS_MODE=memory only binds to loopback; HOST=${host} is refused.` };
    const base = env.ORARI_BASE_URL;
    if (base) {
        let url;
        try {
            url = new URL(base);
        } catch {
            return { ok: false, reason: "ORARI_BASE_URL is not a valid address." };
        }
        if (!isLoopbackHost(url.hostname.replace(/^\[|\]$/g, ""))) return { ok: false, reason: "ACCOUNTS_MODE=memory needs ORARI_BASE_URL to be a loopback address." };
    }
    return { ok: true, host };
}

/** The non-Secure cookie is allowed only in memory mode on loopback (checked above). */
export function insecureCookiesAllowed(env, memoryModeChecked) {
    return env.ORARI_INSECURE_COOKIES === "1" && memoryModeChecked === true;
}
