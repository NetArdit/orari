import dotenv from "dotenv";
import { createApp } from "./lib/app.js";
import { createAi, createProviderClient, resolveProvider } from "./lib/ai.js";
import { createAccounts } from "./lib/accounts/http.js";
import { createMemoryAccountsRepository } from "./lib/accounts/memoryRepository.js";
import { createPasswordHasher } from "./lib/accounts/password.js";
import { createPwnedCheck } from "./lib/accounts/pwned.js";
import { createAccountService } from "./lib/accounts/service.js";
import { checkMemoryAccountsEnvironment } from "./lib/accounts/localOnly.js";
import { createTestMail } from "./lib/accounts/testMail.js";
import { createSmtpMail, createSmtpTransport } from "./lib/accounts/smtpMail.js";
import { createPool, migrate } from "./lib/accounts/postgres/connect.js";
import { createPostgresAccountsRepository } from "./lib/accounts/postgres/repository.js";
import { createLinkSealer, withSealedOutbox } from "./lib/accounts/postgres/sealedOutbox.js";

dotenv.config();

/* =========================================
   CONFIG
========================================= */

const PORT = process.env.PORT || 3000;

let provider;
try {
    provider = resolveProvider(process.env);
} catch (error) {
    console.error("ERROR:", error.message);
    process.exit(1);
}

const AI_CONFIGURED = Boolean(provider.apiKey);

if (!AI_CONFIGURED) {
    // We do NOT exit here - the server should still boot so the frontend
    // loads and can show a clear "AI not configured" message instead of
    // the whole app being unreachable.
    console.error(`WARNING: ${provider.keyName} is missing from .env - the AI features will return an error.`);
}

const models = provider.models;

const { parseNaturalLanguageRequest, generateStudyPlan } = createAi({ models, ...(AI_CONFIGURED ? { client: createProviderClient(provider) } : {}) });

/* Accounts exist only when asked for (ACCOUNTS_MODE):
   - "postgres": accounts, sessions, plans and the mail outbox live in PostgreSQL (DATABASE_URL); mail is sent over
     SMTP (SMTP_URL, MAIL_FROM). This is the mode for a real deployment.
   - "memory": everything is lost when the process stops and mail goes to a local file; loopback only, never for
     real users. */
let accounts = null;
let pool = null;
let HOST = process.env.HOST || undefined;
if (process.env.ACCOUNTS_MODE === "postgres") {
    const missing = ["DATABASE_URL", "SMTP_URL", "MAIL_FROM", "ORARI_BASE_URL", "OUTBOX_SECRET"].filter((name) => !process.env[name]);
    if (missing.length > 0) {
        console.error("ERROR: ACCOUNTS_MODE=postgres needs " + missing.join(", ") + ".");
        process.exit(1);
    }
    const baseUrl = process.env.ORARI_BASE_URL.replace(/\/$/, "");
    let publicOrigin;
    try {
        publicOrigin = new URL(baseUrl);
    } catch {
        console.error("ERROR: ORARI_BASE_URL is not a valid address.");
        process.exit(1);
    }
    const local = ["localhost", "127.0.0.1"].includes(publicOrigin.hostname);
    if (publicOrigin.protocol !== "https:" && !local) {
        console.error("ERROR: ORARI_BASE_URL must be https:// (the session cookie is Secure).");
        process.exit(1);
    }
    try {
        pool = createPool({ connectionString: process.env.DATABASE_URL });
        await migrate(pool);
    } catch (error) {
        console.error("ERROR: the database is not reachable or the schema could not be applied:", error.message);
        process.exit(1);
    }
    const service = createAccountService({
        // The links of queued e-mails are sealed with OUTBOX_SECRET before they reach the database.
        repo: withSealedOutbox(createPostgresAccountsRepository({ pool }), createLinkSealer(process.env.OUTBOX_SECRET)),
        hasher: createPasswordHasher(),
        mail: createSmtpMail({ transport: createSmtpTransport(process.env), from: process.env.MAIL_FROM }),
        passwordCheck: createPwnedCheck(),
        baseUrl,
    });
    // Mail that could not be sent stays in the database outbox and is retried here (and by any other instance).
    service.dispatchMail().catch(() => undefined);
    setInterval(() => service.dispatchMail().catch(() => undefined), 30_000).unref();
    accounts = {
        ...createAccounts({ service, allowedOrigins: [publicOrigin.origin], secureCookies: !local || process.env.ORARI_INSECURE_COOKIES !== "1" }),
        mode: "postgres",
    };
    console.error("ACCOUNTS_MODE=postgres: accounts and plans are stored in PostgreSQL; mail goes out over SMTP.");
} else if (process.env.ACCOUNTS_MODE === "memory") {
    const environment = checkMemoryAccountsEnvironment(process.env);
    if (!environment.ok) {
        console.error("ERROR:", environment.reason);
        process.exit(1);
    }
    HOST = environment.host;
    const baseUrl = (process.env.ORARI_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
    const service = createAccountService({
        repo: createMemoryAccountsRepository(),
        hasher: createPasswordHasher(),
        mail: createTestMail({ directory: "dev-mail" }),
        // ACCOUNTS_PWNED_CHECK=off is for automated browser runs and offline development in memory mode only:
        // it skips the third-party lookup and treats every password as not found. It does not exist for any other mode.
        passwordCheck: process.env.ACCOUNTS_PWNED_CHECK === "off" ? async () => ({ status: "clean" }) : createPwnedCheck(),
        baseUrl,
    });
    // Mail that could not be sent is retried from the outbox while this process runs. The memory outbox is lost on
    // restart; a database-backed outbox (not connected) is what would survive one.
    setInterval(() => service.dispatchMail().catch(() => undefined), 60_000).unref();
    accounts = {
        ...createAccounts({ service, allowedOrigins: [new URL(baseUrl).origin], secureCookies: process.env.ORARI_INSECURE_COOKIES !== "1" }),
        mode: "memory",
    };
    console.error("ACCOUNTS_MODE=memory: accounts are kept in memory and lost on restart; mail is written to dev-mail/ and not sent. Not for real users.");
}

// Behind a reverse proxy: TRUST_PROXY=<number of proxy hops in front of this process> (usually 1). It makes the
// client address (rate limit) and the public scheme (origin check) come from the proxy's X-Forwarded-* headers.
// Left unset, those headers are ignored, which is right when nothing sits in front.
const TRUST_PROXY_HOPS = process.env.TRUST_PROXY ? Number(process.env.TRUST_PROXY) : 0;
if (!Number.isInteger(TRUST_PROXY_HOPS) || TRUST_PROXY_HOPS < 0 || TRUST_PROXY_HOPS > 5) {
    console.error("TRUST_PROXY must be a whole number of proxy hops from 0 to 5.");
    process.exit(1);
}

const app = createApp({
    aiConfigured: AI_CONFIGURED,
    parseNaturalLanguageRequest,
    generateStudyPlan,
    accounts,
});
if (TRUST_PROXY_HOPS > 0) app.set("trust proxy", TRUST_PROXY_HOPS);

/* =========================================
   START SERVER
========================================= */

const server = app.listen(PORT, ...(HOST ? [HOST] : []), () => {
    console.log(`StudyFlow running at http://localhost:${PORT}`);
    if (!AI_CONFIGURED) {
        console.log(`-> AI features are disabled until ${provider.keyName} is set in .env`);
    }
});

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use.`);
        process.exit(1);
    }
    console.error("SERVER ERROR:", error);
});

// SIGTERM is what hosts send on a deploy or a stop: finish what is running, close the database, leave.
function shutdown() {
    console.log("\nShutting StudyFlow down...");
    setTimeout(() => process.exit(1), 10_000).unref();
    server.close(async () => {
        await pool?.end().catch(() => undefined);
        console.log("StudyFlow stopped.");
        process.exit(0);
    });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
