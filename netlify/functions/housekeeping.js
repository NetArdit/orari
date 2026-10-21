import { getApp } from "./_shared.js";

// Retries mail that did not go out the first time. Every 30 minutes in the day (netlify.toml): each run wakes the free
// database, which counts the minutes it is awake, so it is not run at night. Nobody calls this; the host runs it.
export const handler = async () => {
    try {
        const { service, push } = await getApp();
        const sent = await service.dispatchMail();
        // Reminders that are due. Counts only: no content is ever logged.
        const reminders = push ? await push.store.sendDue() : null;
        console.log(JSON.stringify({ event: "housekeeping", sent, reminders }));
        return { statusCode: 200 };
    } catch {
        console.error(JSON.stringify({ event: "housekeeping_failed" }));
        return { statusCode: 500 };
    }
};
