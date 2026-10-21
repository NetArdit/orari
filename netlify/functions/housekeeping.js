import { getApp } from "./_shared.js";

// Retries mail that did not go out the first time. Hourly (netlify.toml): every run wakes the free database, which
// counts the minutes it is awake. Nobody calls this; the host runs it.
export const handler = async () => {
    try {
        const { service } = await getApp();
        const sent = await service.dispatchMail();
        console.log(JSON.stringify({ event: "housekeeping", sent }));
        return { statusCode: 200 };
    } catch {
        console.error(JSON.stringify({ event: "housekeeping_failed" }));
        return { statusCode: 500 };
    }
};
