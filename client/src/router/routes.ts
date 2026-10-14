/**
 * The screens and their addresses. Pure functions, so every address can be tested without a browser.
 * The app is served under /app; everything below is relative to that.
 */
export const BASE = "/app";

export type Route =
    | { name: "today" }
    | { name: "week" }
    | { name: "newPlan" }
    | { name: "plans" }
    | { name: "plan"; planId: string }
    | { name: "session"; planId: string; sessionId: string }
    | { name: "me" }
    | { name: "signIn" }
    | { name: "signUp" }
    | { name: "forgot" }
    /** Reached from the link in an e-mail: /app/reset#token=... The token is in the fragment and is read by the page, never sent in the address. */
    | { name: "reset" }
    | { name: "verify" }
    | { name: "notFound"; path: string };

const decode = (part: string): string | null => {
    try {
        return decodeURIComponent(part);
    } catch {
        return null; // a malformed %-sequence typed into the address bar
    }
};

/** The route for a location path such as "/app/planet/abc". Unknown addresses give notFound, never an error. */
export function parsePath(pathname: string): Route {
    const notFound: Route = { name: "notFound", path: pathname };

    if (pathname !== BASE && !pathname.startsWith(BASE + "/")) return notFound;
    const parts = pathname.slice(BASE.length).split("/").filter(Boolean);
    const decoded = parts.map(decode);
    if (decoded.some((p) => p === null)) return notFound;
    const [first, second, third, fourth, ...rest] = decoded as string[];
    if (rest.length > 0) return notFound;

    if (first === undefined) return { name: "today" };
    if (first === "orari" && second === undefined) return { name: "week" };
    if (first === "plan-i-ri" && second === undefined) return { name: "newPlan" };
    if (first === "une" && second === undefined) return { name: "me" };
    if (first === "hyr" && second === undefined) return { name: "signIn" };
    if (first === "regjistrohu" && second === undefined) return { name: "signUp" };
    if (first === "harrova" && second === undefined) return { name: "forgot" };
    // These two paths are the ones the server puts in e-mails (lib/accounts/service.js); keep them in step.
    if (first === "reset" && second === undefined) return { name: "reset" };
    if (first === "verify" && second === undefined) return { name: "verify" };
    if (first === "planet") {
        if (second === undefined) return { name: "plans" };
        if (third === undefined) return { name: "plan", planId: second };
        if (third === "seanca" && fourth !== undefined) return { name: "session", planId: second, sessionId: fourth };
    }
    return notFound;
}

/** The address of a route. parsePath(hrefFor(route)) gives the route back. */
export function hrefFor(route: Exclude<Route, { name: "notFound" }>): string {
    const id = encodeURIComponent;
    switch (route.name) {
        case "today":
            return BASE + "/";
        case "week":
            return BASE + "/orari";
        case "newPlan":
            return BASE + "/plan-i-ri";
        case "plans":
            return BASE + "/planet";
        case "plan":
            return `${BASE}/planet/${id(route.planId)}`;
        case "session":
            return `${BASE}/planet/${id(route.planId)}/seanca/${id(route.sessionId)}`;
        case "me":
            return BASE + "/une";
        case "signIn":
            return BASE + "/hyr";
        case "signUp":
            return BASE + "/regjistrohu";
        case "forgot":
            return BASE + "/harrova";
        case "reset":
            return BASE + "/reset";
        case "verify":
            return BASE + "/verify";
    }
}

/** Whether a click on a link should be handled in the page instead of loading a new one. */
export function isInternalNavigation(event: { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; defaultPrevented: boolean }, target: string | null, href: string, origin: string): boolean {
    if (event.defaultPrevented || event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false; // new tab, new window, download
    if (target && target !== "_self") return false;
    let url: URL;
    try {
        url = new URL(href, origin);
    } catch {
        return false;
    }
    return url.origin === origin && (url.pathname === BASE || url.pathname.startsWith(BASE + "/"));
}
