import serverless from "serverless-http";
import { getApp } from "./_shared.js";

// The whole API as one function; netlify.toml sends every /api/* request here and publishes the pages as files.
let handle;
let service;

export const handler = async (event, context) => {
    try {
        if (!handle) {
            const built = await getApp();
            handle = serverless(built.app);
            service = built.service;
        }
    } catch (error) {
        // What exactly is wrong is not for a visitor to read; a connection string could be in the message.
        console.error(JSON.stringify({ event: "function_start_failed", reason: String(error?.message ?? error).replace(/postgres(ql)?:\/\/\S+/g, "postgres://<hidden>") }));
        return { statusCode: 503, headers: { "content-type": "application/json", "cache-control": "no-store" }, body: JSON.stringify({ code: "SERVER_BUSY", error: "The service is not available right now. Try again in a moment." }) };
    }
    const result = await handle(event, context);
    // A function stops when it has answered, so mail queued by this request is sent before it does (the same run the
    // service already started; this only waits for it). What fails stays in the database outbox for the hourly retry.
    await service.dispatchMail().catch(() => undefined);
    return result;
};
