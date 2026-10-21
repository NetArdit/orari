/**
 * What both Netlify functions need: the Express app of lib/app.js, built once per warm instance from the
 * environment, with its accounts, its mail and its job store in PostgreSQL. Files starting with an underscore are
 * not functions.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { createAi, createProviderClient, resolveProvider } from "../../lib/ai.js";
import { createApp } from "../../lib/app.js";
import { composePostgres } from "../../lib/composePostgres.js";
import { createDbJobStore } from "../../lib/jobsDb.js";

const signature = (id) => createHmac("sha256", process.env.OUTBOX_SECRET ?? "").update("job:" + id).digest("hex");
export function validSignature(id, given) {
    const a = Buffer.from(signature(id));
    const b = Buffer.from(String(given ?? ""));
    return a.length === b.length && timingSafeEqual(a, b);
}

let built;
export function getApp() {
    built ??= build().catch((error) => {
        built = undefined; // try again on the next request instead of caching a failure
        throw error;
    });
    return built;
}

async function build() {
    const env = process.env;
    const provider = resolveProvider(env);
    const aiConfigured = Boolean(provider.apiKey);
    const { parseNaturalLanguageRequest, generateStudyPlan } = createAi({ models: provider.models, ...(aiConfigured ? { client: createProviderClient(provider) } : {}) });
    // A function instance is short-lived and several can run at once: a small pool each keeps the database's connection limit safe.
    const { pool, service, accounts } = await composePostgres(env, { poolSize: 3 });

    const base = env.ORARI_BASE_URL.replace(/\/$/, "");
    const jobBackend = createDbJobStore({
        pool,
        // The background function answers 202 at once and carries on; this call returns as soon as it has been accepted.
        dispatch: async (id) => {
            const res = await fetch(`${base}/.netlify/functions/job-background`, {
                method: "POST",
                headers: { "content-type": "application/json", "x-job-signature": signature(id) },
                body: JSON.stringify({ id }),
            });
            if (res.status !== 202 && !res.ok) throw new Error("dispatch refused: " + res.status);
        },
    });
    const app = createApp({ aiConfigured, parseNaturalLanguageRequest, generateStudyPlan, accounts, jobBackend, rateLimit: { windowMs: 10 * 60 * 1000, limit: 30 } });
    app.set("trust proxy", 1);
    return { app, service, jobBackend };
}
