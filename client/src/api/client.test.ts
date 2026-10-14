import { describe, expect, test } from "vitest";
import { createApiClient } from "./client.ts";
import type { CreatePlanRequest } from "./types.ts";

type Call = { url: string; init: RequestInit };

/** A fetch that answers from a function and remembers what it was asked. */
function fakeFetch(answer: (call: Call) => Response | Promise<Response>) {
    const calls: Call[] = [];
    const fetchFn = (async (url: string | URL | Request, init: RequestInit = {}) => {
        const call = { url: String(url), init };
        calls.push(call);
        return answer(call);
    }) as typeof fetch;
    return { fetchFn, calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });

/** A fetch that never answers until its signal fires, like a stalled connection. */
const stalled = fakeFetch(
    ({ init }) =>
        new Promise<Response>((_, reject) => {
            init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        })
);

const PLAN_REQUEST: CreatePlanRequest = {
    profile: { name: "Arta" },
    structured: { startDate: "2026-10-14", endDate: "2026-10-20", subject: "Matematikë" },
};

describe("requests", () => {
    test("POST routes send JSON to the right path with a signal", async () => {
        const { fetchFn, calls } = fakeFetch(() => json(200, { sessions: [] }));
        const api = createApiClient({ fetch: fetchFn });

        await api.createPlan(PLAN_REQUEST);
        await api.adjustPlan({ ...PLAN_REQUEST, progress: { today: "2026-10-15" } });
        await api.parse({ text: "abc", clientDate: "2026-10-14", timeZone: "Europe/Belgrade" });

        expect(calls.map((c) => [c.init.method, c.url])).toEqual([
            ["POST", "/api/create-plan"],
            ["POST", "/api/adjust-plan"],
            ["POST", "/api/parse"],
        ]);
        expect(JSON.parse(String(calls[0]!.init.body))).toEqual(PLAN_REQUEST);
        expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ text: "abc", clientDate: "2026-10-14", timeZone: "Europe/Belgrade" });
        for (const call of calls) {
            expect(new Headers(call.init.headers).get("Content-Type")).toBe("application/json");
            expect(call.init.signal).toBeInstanceOf(AbortSignal);
        }
    });

    test("health is a GET without a body; baseUrl is prefixed", async () => {
        const { fetchFn, calls } = fakeFetch(() => json(200, { success: true, message: "ok", aiConfigured: false }));
        const result = await createApiClient({ fetch: fetchFn, baseUrl: "http://localhost:3000" }).health();

        expect(result).toEqual({ ok: true, data: { success: true, message: "ok", aiConfigured: false } });
        expect(calls[0]!.url).toBe("http://localhost:3000/api/health");
        expect(calls[0]!.init.method).toBe("GET");
        expect(calls[0]!.init.body).toBeUndefined();
    });

    test("parse unwraps { parsed }", async () => {
        const { fetchFn } = fakeFetch(() => json(200, { parsed: { subject: "JavaScript" } }));
        const result = await createApiClient({ fetch: fetchFn }).parse({ text: "abc" });
        expect(result).toEqual({ ok: true, data: { subject: "JavaScript" } });
    });
});

describe("failures are sorted into kinds the screens can act on", () => {
    const failing = async (response: Response) => {
        const { fetchFn } = fakeFetch(() => response);
        const result = await createApiClient({ fetch: fetchFn }).createPlan(PLAN_REQUEST);
        if (result.ok) throw new Error("expected a failure");
        return result;
    };

    test("validation: the server's code, message and fields are passed on", async () => {
        const fields = [{ path: "structured.endDate", message: "Data nuk është e vlefshme." }];
        const result = await failing(json(400, { code: "VALIDATION", error: "Datat e planit nuk janë valide.", fields }));
        expect(result).toEqual({ ok: false, kind: "validation", status: 400, code: "VALIDATION", message: "Datat e planit nuk janë valide.", fields });
    });

    test("validation without fields (a date rule) has no fields property", async () => {
        const result = await failing(json(400, { code: "DATES_REVERSED", error: "Data e fillimit duhet të jetë para datës së mbarimit." }));
        expect([result.kind, result.code]).toEqual(["validation", "DATES_REVERSED"]);
        expect("fields" in result).toBe(false);
    });

    test("malformed fields from the server are ignored, not trusted", async () => {
        const result = await failing(json(400, { code: "VALIDATION", error: "x", fields: [{ path: 5 }] }));
        expect("fields" in result).toBe(false);
    });

    test("every code the server publishes has a kind", async () => {
        const { ERROR_CODES } = await import("../../../lib/schema.js");
        const expected: Record<string, string> = {
            VALIDATION: "validation", BAD_JSON: "validation", BAD_REQUEST: "validation", BODY_TOO_LARGE: "validation", INVALID_DATES: "validation",
            DATES_REVERSED: "validation", PERIOD_TOO_LONG: "validation", NO_FREE_TIME: "validation", PLAN_FINISHED: "validation",
            RATE_LIMITED: "rate_limited", SERVER_BUSY: "busy", AI_NOT_CONFIGURED: "not_configured",
            PROVIDER_RATE_LIMITED: "provider_unavailable", PROVIDER_UNAVAILABLE: "provider_unavailable", AI_TIMEOUT: "timeout",
            AI_REJECTED_REQUEST: "ai_failed", AI_UNUSABLE_ANSWER: "ai_failed", AI_NO_USABLE_SESSIONS: "ai_failed", AI_FAILED: "ai_failed",
            NOT_FOUND: "server", INTERNAL: "server",
        };
        expect([...ERROR_CODES].sort()).toEqual(Object.keys(expected).sort());
        for (const code of ERROR_CODES) {
            // The status is deliberately misleading: the code decides.
            const result = await failing(json(500, { code, error: "Teksti mund të ndryshojë." }));
            expect([code, result.kind, result.code]).toEqual([code, expected[code], code]);
        }
    });

    test("the three 503s are told apart by code even when the wording changes", async () => {
        const reworded = "Një fjali krejt tjetër.";
        expect((await failing(json(503, { code: "AI_NOT_CONFIGURED", error: reworded }))).kind).toBe("not_configured");
        const busy = await failing(json(503, { code: "SERVER_BUSY", error: reworded }, { "Retry-After": "15" }));
        expect([busy.kind, busy.retryAfterSeconds, busy.message]).toEqual(["busy", 15, reworded]);
        expect((await failing(json(503, { code: "PROVIDER_RATE_LIMITED", error: reworded }))).kind).toBe("provider_unavailable");
    });

    test("rate limited, with the server's retry time", async () => {
        const result = await failing(json(429, { code: "RATE_LIMITED", error: "Ke bërë shumë kërkesa." }, { "Retry-After": "412" }));
        expect([result.kind, result.retryAfterSeconds]).toEqual(["rate_limited", 412]);
    });

    test("without a code, only the status is used, and an unknown code is not trusted", async () => {
        expect((await failing(json(400, { error: "x" }))).kind).toBe("validation");
        expect((await failing(json(429, {}))).kind).toBe("rate_limited");
        expect((await failing(json(504, {}))).kind).toBe("timeout");
        // A 502 or 503 without our code is a proxy or an outage in front of the server, not an AI result.
        expect((await failing(json(502, {}))).kind).toBe("server");
        expect((await failing(json(503, { error: "AI nuk është konfiguruar ende." }))).kind).toBe("server");

        const unknown = await failing(json(503, { code: "SOMETHING_NEW", error: "x" }));
        expect(unknown.kind).toBe("server");
        expect("code" in unknown).toBe(false);
        const inherited = await failing(json(500, { code: "toString", error: "x" }));
        expect("code" in inherited).toBe(false);
    });

    test("an unexpected status is a server failure with a message of our own", async () => {
        const result = await failing(json(500, {}));
        expect(result).toEqual({ ok: false, kind: "server", status: 500, message: "Ndodhi një gabim i papritur. Provo përsëri." });
    });

    test("an answer that is not JSON never throws", async () => {
        const html = await failing(new Response("<html>Bad gateway</html>", { status: 502 }));
        expect([html.kind, html.status]).toEqual(["server", 502]);
        const okButNotJson = await failing(new Response("ok", { status: 200 }));
        expect(okButNotJson.kind).toBe("server");
    });

    test("no connection is offline, in Albanian", async () => {
        const { fetchFn } = fakeFetch(() => {
            throw new TypeError("Failed to fetch");
        });
        const result = await createApiClient({ fetch: fetchFn }).createPlan(PLAN_REQUEST);
        expect(result).toEqual({ ok: false, kind: "offline", message: "Nuk u lidhëm dot me serverin. Kontrollo internetin dhe provo përsëri." });
    });
});

describe("waiting and cancelling", () => {
    test("a request that outlasts the time limit ends as a timeout", async () => {
        const api = createApiClient({ fetch: stalled.fetchFn, aiTimeoutMs: 30 });
        const startedAt = Date.now();
        const result = await api.createPlan(PLAN_REQUEST);
        expect(result).toMatchObject({ ok: false, kind: "timeout" });
        expect(Date.now() - startedAt).toBeLessThan(1000);
    });

    test("AI routes and health have separate limits", async () => {
        const api = createApiClient({ fetch: stalled.fetchFn, aiTimeoutMs: 5_000, timeoutMs: 30 });
        expect(await api.health()).toMatchObject({ ok: false, kind: "timeout" });
    });

    test("cancelling ends the request as aborted, and the fetch is told", async () => {
        const local = fakeFetch(
            ({ init }) =>
                new Promise<Response>((_, reject) => {
                    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
                })
        );
        const api = createApiClient({ fetch: local.fetchFn });
        const person = new AbortController();

        const pending = api.createPlan(PLAN_REQUEST, { signal: person.signal });
        await new Promise((r) => setTimeout(r, 10));
        person.abort();

        expect(await pending).toMatchObject({ ok: false, kind: "aborted" });
        expect(local.calls[0]!.init.signal?.aborted).toBe(true);
    });

    test("a request that is already cancelled is never sent", async () => {
        const { fetchFn, calls } = fakeFetch(() => json(200, {}));
        const result = await createApiClient({ fetch: fetchFn }).createPlan(PLAN_REQUEST, { signal: AbortSignal.abort() });
        expect(result).toMatchObject({ ok: false, kind: "aborted" });
        expect(calls).toHaveLength(0);
    });

    test("cancelling while the answer is still being read is aborted, not a server error", async () => {
        const person = new AbortController();
        const { fetchFn } = fakeFetch(() => {
            const response = new Response("{}", { status: 200 });
            response.json = () => {
                person.abort();
                return Promise.reject(new DOMException("aborted", "AbortError"));
            };
            return response;
        });
        const result = await createApiClient({ fetch: fetchFn }).createPlan(PLAN_REQUEST, { signal: person.signal });
        expect(result).toMatchObject({ ok: false, kind: "aborted" });
    });
});
