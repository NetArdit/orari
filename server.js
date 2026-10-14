import dotenv from "dotenv";
import { createApp } from "./lib/app.js";
import { createAi, resolveModels } from "./lib/ai.js";
import { createAccounts } from "./lib/accounts/http.js";
import { createMemoryAccountsRepository } from "./lib/accounts/memoryRepository.js";
import { createPasswordHasher } from "./lib/accounts/password.js";
import { createPwnedCheck } from "./lib/accounts/pwned.js";
import { createAccountService } from "./lib/accounts/service.js";
import { createTestMail } from "./lib/accounts/testMail.js";

dotenv.config();

/* =========================================
   CONFIG
========================================= */

const PORT = process.env.PORT || 3000;

const AI_CONFIGURED = Boolean(process.env.OPENROUTER_API_KEY);

if (!AI_CONFIGURED) {
    // We do NOT exit here - the server should still boot so the frontend
    // loads and can show a clear "AI not configured" message instead of
    // the whole app being unreachable.
    console.error("WARNING: OPENROUTER_API_KEY mungon në .env - funksionet AI do të kthejnë gabim.");
}

// A wrong model list is a mistake in the settings: say so and stop, rather than fail on every request later.
let models;
try {
    models = resolveModels(process.env.OPENROUTER_MODELS);
} catch (error) {
    console.error("ERROR:", error.message);
    process.exit(1);
}

const { parseNaturalLanguageRequest, generateStudyPlan } = createAi({ models });

/* Accounts exist only when asked for, and only in memory for now: no database, no mail provider and
   no host have been chosen. Everything is lost when the process stops, and the page says so. */
let accounts = null;
if (process.env.ACCOUNTS_MODE === "memory") {
    const baseUrl = (process.env.ORARI_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, "");
    const service = createAccountService({
        repo: createMemoryAccountsRepository(),
        hasher: createPasswordHasher(),
        mail: createTestMail({ directory: "dev-mail" }),
        passwordCheck: createPwnedCheck(),
        baseUrl,
    });
    // Mail that could not be sent is retried from the outbox; this also picks up what a restart left.
    setInterval(() => service.dispatchMail().catch(() => undefined), 60_000).unref();
    accounts = {
        ...createAccounts({ service, allowedOrigins: [new URL(baseUrl).origin], secureCookies: process.env.ORARI_INSECURE_COOKIES !== "1" }),
        mode: "memory",
    };
    console.error("ACCOUNTS_MODE=memory: accounts are kept in memory and lost on restart; mail is written to dev-mail/ and not sent. Not for real users.");
}

const app = createApp({
    aiConfigured: AI_CONFIGURED,
    parseNaturalLanguageRequest,
    generateStudyPlan,
    accounts,
});

/* =========================================
   START SERVER
========================================= */

const server = app.listen(PORT, () => {
    console.log(`StudyFlow running at http://localhost:${PORT}`);
    if (!AI_CONFIGURED) {
        console.log("-> AI features are disabled until OPENROUTER_API_KEY is set in .env");
    }
});

server.on("error", (error) => {
    if (error.code === "EADDRINUSE") {
        console.error(`Porti ${PORT} është duke u përdorur.`);
        process.exit(1);
    }
    console.error("SERVER ERROR:", error);
});

process.on("SIGINT", () => {
    console.log("\nDuke mbyllur StudyFlow...");
    server.close(() => {
        console.log("StudyFlow u mbyll.");
        process.exit(0);
    });
});
