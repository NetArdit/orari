/**
 * Everything a PostgreSQL deployment needs, built from environment variables: the pool, the account service with
 * its sealed outbox and SMTP mail, and the HTTP account routes. Shared by server.js (a long-lived process) and the
 * Netlify functions, so the two cannot drift apart.
 */
import { createAccounts } from "./accounts/http.js";
import { createPasswordHasher } from "./accounts/password.js";
import { createPwnedCheck } from "./accounts/pwned.js";
import { createAccountService } from "./accounts/service.js";
import { createSmtpMail, createSmtpTransport } from "./accounts/smtpMail.js";
import { createPool, migrate } from "./accounts/postgres/connect.js";
import { createPostgresAccountsRepository } from "./accounts/postgres/repository.js";
import { createLinkSealer, withSealedOutbox } from "./accounts/postgres/sealedOutbox.js";
import { JOBS_SCHEMA_SQL } from "./jobsDb.js";

/** Throws an Error with a plain message when the configuration is wrong. */
export async function composePostgres(env, { poolSize = 5 } = {}) {
    const missing = ["DATABASE_URL", "SMTP_URL", "MAIL_FROM", "ORARI_BASE_URL", "OUTBOX_SECRET"].filter((name) => !env[name]);
    if (missing.length > 0) throw new Error("ACCOUNTS_MODE=postgres needs " + missing.join(", ") + ".");
    const baseUrl = env.ORARI_BASE_URL.replace(/\/$/, "");
    let publicOrigin;
    try {
        publicOrigin = new URL(baseUrl);
    } catch {
        throw new Error("ORARI_BASE_URL is not a valid address.");
    }
    const local = ["localhost", "127.0.0.1"].includes(publicOrigin.hostname);
    if (publicOrigin.protocol !== "https:" && !local) throw new Error("ORARI_BASE_URL must be https:// (the session cookie is Secure).");

    const pool = createPool({ connectionString: env.DATABASE_URL, max: poolSize });
    try {
        await migrate(pool);
        await pool.query(JOBS_SCHEMA_SQL);
    } catch (error) {
        throw new Error("the database is not reachable or the schema could not be applied: " + error.message);
    }
    const service = createAccountService({
        // The links of queued e-mails are sealed with OUTBOX_SECRET before they reach the database.
        repo: withSealedOutbox(createPostgresAccountsRepository({ pool }), createLinkSealer(env.OUTBOX_SECRET)),
        hasher: createPasswordHasher(),
        mail: createSmtpMail({ transport: createSmtpTransport(env), from: env.MAIL_FROM }),
        passwordCheck: createPwnedCheck(),
        baseUrl,
    });
    const accounts = {
        ...createAccounts({ service, allowedOrigins: [publicOrigin.origin], secureCookies: !local || env.ORARI_INSECURE_COOKIES !== "1" }),
        mode: "postgres",
    };
    return { pool, service, accounts };
}
