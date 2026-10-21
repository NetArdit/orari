import { getApp, validSignature } from "./_shared.js";

// A background function (the name ends in -background): the host answers 202 at once and lets this run for up to 15
// minutes. It does the work of one job (the AI call) and writes the answer into the jobs table, where the poll finds it.
export const handler = async (event) => {
    let id;
    try {
        id = JSON.parse(event.body ?? "{}").id;
    } catch {
        return { statusCode: 400 };
    }
    if (typeof id !== "string" || !validSignature(id, event.headers?.["x-job-signature"])) return { statusCode: 403 };
    const { app, jobBackend } = await getApp();
    await jobBackend.runJob(id, (kind, payload) => app.locals.runJobWork(kind, payload));
    return { statusCode: 200 };
};
