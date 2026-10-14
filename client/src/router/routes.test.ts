import { describe, expect, test } from "vitest";
import { hrefFor, isInternalNavigation, parsePath } from "./routes.ts";
import type { Route } from "./routes.ts";

describe("addresses", () => {
    const cases: [string, Route][] = [
        ["/app", { name: "today" }],
        ["/app/", { name: "today" }],
        ["/app/orari", { name: "week" }],
        ["/app/orari/", { name: "week" }],
        ["/app/plan-i-ri", { name: "newPlan" }],
        ["/app/planet", { name: "plans" }],
        ["/app/planet/abc-123", { name: "plan", planId: "abc-123" }],
        ["/app/planet/abc-123/seanca/s-9", { name: "session", planId: "abc-123", sessionId: "s-9" }],
        ["/app/une", { name: "me" }],
        ["/app/hyr", { name: "signIn" }],
        ["/app/regjistrohu", { name: "signUp" }],
        ["/app/harrova", { name: "forgot" }],
        ["/app/reset", { name: "reset" }],
        ["/app/verify", { name: "verify" }],
    ];

    test.each(cases)("%s", (path, route) => {
        expect(parsePath(path)).toEqual(route);
    });

    test("unknown, incomplete, over-long and foreign addresses are notFound and never throw", () => {
        for (const path of ["/app/nuk-ekziston", "/app/orari/extra", "/app/planet/a/seanca", "/app/planet/a/tjeter/b", "/app/planet/a/seanca/b/c", "/", "/application", "/app/%E0%A4%A", ""]) {
            expect(parsePath(path)).toEqual({ name: "notFound", path });
        }
    });

    test("every route's address leads back to the same route, including ids with awkward characters", () => {
        const routes: Exclude<Route, { name: "notFound" }>[] = [
            { name: "today" }, { name: "week" }, { name: "newPlan" }, { name: "plans" }, { name: "me" },
            { name: "signIn" }, { name: "signUp" }, { name: "forgot" }, { name: "reset" }, { name: "verify" },
            { name: "plan", planId: "3f2b-uuid" },
            { name: "plan", planId: "me hapësirë/pjerrëse?#ë" },
            { name: "session", planId: "p 1", sessionId: "s/2" },
        ];
        for (const route of routes) expect(parsePath(hrefFor(route))).toEqual(route);
    });

    test("addresses are plain and readable", () => {
        expect(hrefFor({ name: "today" })).toBe("/app/");
        expect(hrefFor({ name: "session", planId: "p1", sessionId: "s1" })).toBe("/app/planet/p1/seanca/s1");
    });
});

describe("which link clicks stay inside the app", () => {
    const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false };
    const origin = "http://localhost:3000";

    test("a plain left click on an app address", () => {
        expect(isInternalNavigation(click, null, "/app/orari", origin)).toBe(true);
        expect(isInternalNavigation(click, "_self", "http://localhost:3000/app", origin)).toBe(true);
    });

    test("new-tab gestures, other buttons and handled clicks are left to the browser", () => {
        for (const change of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
            expect(isInternalNavigation({ ...click, ...change }, null, "/app/orari", origin)).toBe(false);
        }
        expect(isInternalNavigation(click, "_blank", "/app/orari", origin)).toBe(false);
    });

    test("the old page, the API, other sites and broken addresses are real navigations", () => {
        for (const href of ["/", "/api/health", "/application", "https://example.com/app/orari", "http://[broken"]) {
            expect(isInternalNavigation(click, null, href, origin)).toBe(false);
        }
    });
});
