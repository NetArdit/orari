import { useSyncExternalStore } from "react";
import { hrefFor, isInternalNavigation, parsePath } from "./routes.ts";
import type { Route } from "./routes.ts";

const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => {
    listeners.add(listener);
    window.addEventListener("popstate", listener);
    return () => {
        listeners.delete(listener);
        window.removeEventListener("popstate", listener);
    };
};

/** Goes to a screen and adds it to the browser's history, so Back works. */
export function navigate(route: Exclude<Route, { name: "notFound" }>): void {
    const href = hrefFor(route);
    if (href === window.location.pathname) return;
    window.history.pushState(null, "", href);
    for (const listener of listeners) listener();
}

/** The current screen, re-read whenever the address changes. */
export function useRoute(): Route {
    const pathname = useSyncExternalStore(subscribe, () => window.location.pathname);
    return parsePath(pathname);
}

/** For onClick on ordinary <a href> links: in-app addresses change the screen without reloading the page. */
export function handleLinkClick(event: React.MouseEvent<HTMLAnchorElement>): void {
    const link = event.currentTarget;
    if (!isInternalNavigation(event, link.getAttribute("target"), link.href, window.location.origin)) return;
    const route = parsePath(new URL(link.href).pathname);
    if (route.name === "notFound") return;
    event.preventDefault();
    navigate(route);
}
