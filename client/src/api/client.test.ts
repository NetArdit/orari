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

    test("validation: the server's message and its fields are passed on", async () => {
        const fields = [{ path: "structured.endDate", message: "Data nuk është e vlefshme." }];
        const result = await failing(json(400, { error: "Datat e planit nuk janë valide.", fields }));
        expect(result).toEqual({ ok: false, kind: "validation", status: 400, message: "Datat e planit nuk janë valide.", fields });
    });

    test("validation without fields (a date rule) has no fields property", async () => {
        const result = await failing(json(400, { error: "Data e fillimit duhet të jetë para datës së mbarimit." }));
        expect(result.kind).toBe("validation");
        expect("fields" in result).toBe(false);
    });

    test("malformed fields from the server are ignored, not trusted", async () => {
        const result = await failing(json(400, { error: "x", fields: [{ path: 5 }] }));
        expect("fields" in result).toBe(false);
    });

    test("rate limited, with the server's retry time", async () => {
        const result = await failing(json(429, { error: "Ke bërë shumë kërkesa njëra pas tjetrës. Prit pak minuta dhe provo përsëri." }, { "Retry-After": "412" }));
        expect(result.kind).toBe("rate_limited");
        expect(result.retryAfterSeconds).toBe(412);
    });

    test("the three meanings of 503 are told apart by the server's message", async () => {
        expect((await failing(json(503, { error: "AI nuk është konfiguruar ende." }))).kind).toBe("not_configured");
        const busy = await failing(json(503, { error: "Shërbimi është i zënë për momentin. Provo përsëri pas pak." }, { "Retry-After": "15" }));
        expect([busy.kind, busy.retryAfterSeconds]).toEqual(["busy", 15]);
        expect((await failing(json(503, { error: "Shërbimi AI ka arritur kufirin e përdorimit. Provo më vonë." }))).kind).toBe("rate_limited");
    });

    test("the server's AI deadline is a timeout; an unusable AI answer is ai_failed", async () => {
        expect((await failing(json(504, { error: "AI po vonon më shumë se zakonisht. Provo përsëri pas pak." }))).kind).toBe("timeout");
        const failed = await failing(json(502, { error: "AI gjeneroi një plan të paplotë. Provo përsëri." }));
        expect([failed.kind, failed.message]).toEqual(["ai_failed", "AI gjeneroi një plan të paplotë. Provo përsëri."]);
    });

    test("an unexpected status is a server failure with a message of our own", async () => {
        const result = await failing(json(500, {}));
        expect(result).toEqual({ ok: false, kind: "server", status: 500, message: "Ndodhi një gabim i papritur. Provo përsëri." });
    });

    test("an answer that is not JSON never throws", async () => {
        const html = await failing(new Response("<html>Bad gateway</html>", { status: 502 }));
        expect([html.kind, html.status]).toEqual(["ai_failed", 502]);
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
