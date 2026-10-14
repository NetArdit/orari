import dotenv from "dotenv";
import { createApp } from "./lib/app.js";
import { createAi, resolveModels } from "./lib/ai.js";

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

const app = createApp({
    aiConfigured: AI_CONFIGURED,
    parseNaturalLanguageRequest,
    generateStudyPlan,
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
