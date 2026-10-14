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
        const { fetchFn, calls } = fakeFetch(() => json(200, { job: { id: "j", status: "done", createdAt: "", result: { status: 200, body: { sessions: [] } } } }));
        const api = createApiClient({ fetch: fetchFn });

        await api.createPlan(PLAN_REQUEST);
        await api.adjustPlan({ ...PLAN_REQUEST, progress: { today: "2026-10-15" } });
        await api.parse({ text: "abc", clientDate: "2026-10-14", timeZone: "Europe/Belgrade" });

        expect(calls.map((c) => [c.init.method, c.url])).toEqual([
            ["POST", "/api/jobs/create-plan"],
            ["POST", "/api/jobs/adjust-plan"],
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
            UNAUTHENTICATED: "unauthenticated", INVALID_CREDENTIALS: "invalid_credentials", FORBIDDEN_ORIGIN: "forbidden", EMAIL_NOT_VERIFIED: "unverified",
            EMAIL_INVALID: "validation", NAME_INVALID: "validation", AGE_NOT_CONFIRMED: "validation", PASSWORD_TOO_SHORT: "validation", PASSWORD_TOO_LONG: "validation",
            PASSWORD_INVALID: "validation", PASSWORD_COMPROMISED: "validation", PASSWORD_CHECK_UNAVAILABLE: "busy", TOKEN_INVALID: "validation",
            TOO_MANY_ATTEMPTS: "rate_limited", REVISION_CONFLICT: "conflict", MARK_CONFLICT: "conflict", PLAN_EXISTS: "conflict", PLAN_LIMIT: "validation",
            OPERATION_INVALID: "validation", STATUS_INVALID: "validation", BUSY: "busy",
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

    test("describing a plan: the host's start-up page (502 without our code) is repeated once, then it is a failure", async () => {
        let n = 0;
        const parsed = { startDate: null, endDate: null, subject: "matematikë", materialAmount: null, goal: null, planMode: null, weeklyAvailability: [], commitments: [], sessionPreferenceMinutes: null, energy: null, difficulty: null, clarifyingQuestions: [] };
        const recovered = fakeFetch(() => (++n === 1 ? new Response("<html>starting</html>", { status: 502 }) : json(200, { parsed })));
        const ok = await createApiClient({ fetch: recovered.fetchFn }).parse({ text: "abc", clientDate: "2026-10-14", timeZone: "UTC" });
        expect(ok.ok).toBe(true);
        expect(recovered.calls).toHaveLength(2);

        const down = fakeFetch(() => new Response("<html>down</html>", { status: 503 }));
        const failed = await createApiClient({ fetch: down.fetchFn }).parse({ text: "abc", clientDate: "2026-10-14", timeZone: "UTC" });
        expect(failed.ok).toBe(false);
        expect(down.calls).toHaveLength(2);

        // our own answers are never repeated
        const own = fakeFetch(() => json(502, { code: "AI_UNUSABLE_ANSWER", error: "x" }));
        await createApiClient({ fetch: own.fetchFn }).parse({ text: "abc", clientDate: "2026-10-14", timeZone: "UTC" });
        expect(own.calls).toHaveLength(1);
    }, 20_000);

    test("no connection is offline, in Albanian", async () => {
        const { fetchFn } = fakeFetch(() => {
            throw new TypeError("Failed to fetch");
        });
        const result = await createApiClient({ fetch: fetchFn }).createPlan(PLAN_REQUEST);
        expect(result).toEqual({ ok: false, kind: "offline", message: "Nuk u lidhëm dot me serverin. Kontrollo internetin dhe provo përsëri." });
    });
});

/** A server that holds one job: it is running for `runningPolls` questions and then ends as `end`. */
function jobServer(end: { status: "done" | "failed" | "cancelled"; result?: { status: number; body: unknown } }, runningPolls = 2) {
    let polls = 0;
    const handlers = fakeFetch(({ url, init }) => {
        if (url === "/api/jobs/create-plan" || url === "/api/jobs/adjust-plan") return json(202, { job: { id: "job-1", status: "running", createdAt: "t" } });
        if (url === "/api/jobs/job-1/cancel") return json(200, { ok: true });
        if (url === "/api/jobs/job-1" && init.method === "GET") {
            polls++;
            return json(200, { job: polls <= runningPolls ? { id: "job-1", status: "running", createdAt: "t" } : { id: "job-1", createdAt: "t", ...end } });
        }
        return json(404, { code: "NOT_FOUND", error: "Detyra nuk u gjet." });
    });
    return { ...handlers, polls: () => polls };
}

describe("plan jobs", () => {
    const answer = { subject: "Biologji", sessions: [] };

    test("a plan is started with an idempotency key, polled until done, and answered like the direct route", async () => {
        const server = jobServer({ status: "done", result: { status: 200, body: answer } });
        const api = createApiClient({ fetch: server.fetchFn, pollMs: 1, newKey: () => "key-0001-abcdef" });

        const result = await api.createPlan(PLAN_REQUEST);

        expect(result).toEqual({ ok: true, data: answer });
        expect(server.calls[0]!.url).toBe("/api/jobs/create-plan");
        expect(new Headers(server.calls[0]!.init.headers).get("Idempotency-Key")).toBe("key-0001-abcdef");
        expect(server.calls.filter((c) => c.init.method === "GET")).toHaveLength(3);
        expect(server.calls.some((c) => c.url.endsWith("/cancel"))).toBe(false);
    });

    test("a failed job carries the direct route's error through, with its kind, message and fields", async () => {
        const fields = [{ path: "structured.endDate", message: "Data nuk është e vlefshme." }];
        const server = jobServer({ status: "failed", result: { status: 400, body: { code: "VALIDATION", error: "Datat e planit nuk janë valide.", fields } } }, 0);
        const result = await createApiClient({ fetch: server.fetchFn, pollMs: 1 }).createPlan(PLAN_REQUEST);
        expect(result).toEqual({ ok: false, kind: "validation", status: 400, code: "VALIDATION", message: "Datat e planit nuk janë valide.", fields });
    });

    test("an AI failure inside a job is an ai_failed failure, not a server error", async () => {
        const server = jobServer({ status: "failed", result: { status: 502, body: { code: "AI_NO_USABLE_SESSIONS", error: "AI nuk arriti." } } }, 1);
        const result = await createApiClient({ fetch: server.fetchFn, pollMs: 1 }).adjustPlan({ ...PLAN_REQUEST, progress: { today: "2026-10-15" } });
        expect(result).toMatchObject({ ok: false, kind: "ai_failed", code: "AI_NO_USABLE_SESSIONS" });
    });

    test("cancelling stops the polling at once and asks the server to cancel the job", async () => {
        const server = jobServer({ status: "done", result: { status: 200, body: answer } }, 1_000);
        const api = createApiClient({ fetch: server.fetchFn, pollMs: 5 });
        const person = new AbortController();

        const pending = api.createPlan(PLAN_REQUEST, { signal: person.signal });
        await new Promise((r) => setTimeout(r, 30));
        person.abort();

        expect(await pending).toMatchObject({ ok: false, kind: "aborted" });
        const pollsAtCancel = server.polls();
        await new Promise((r) => setTimeout(r, 30));
        expect(server.polls()).toBe(pollsAtCancel);
        expect(server.calls.filter((c) => c.url === "/api/jobs/job-1/cancel")).toHaveLength(1);
    });

    test("cancelling while the start is still unanswered returns at once and cancels the job when its id arrives", async () => {
        let answerStart: (() => void) | undefined;
        const { fetchFn, calls } = fakeFetch(({ url }) => {
            if (url === "/api/jobs/create-plan") {
                return new Promise<Response>((resolve) => {
                    answerStart = () => resolve(json(202, { job: { id: "job-9", status: "running", createdAt: "t" } }));
                });
            }
            return json(200, { ok: true });
        });
        const person = new AbortController();
        const pending = createApiClient({ fetch: fetchFn, pollMs: 1 }).createPlan(PLAN_REQUEST, { signal: person.signal });
        await new Promise((r) => setTimeout(r, 10));
        person.abort();

        expect(await pending).toMatchObject({ ok: false, kind: "aborted" });
        expect(calls.some((c) => c.url.endsWith("/cancel"))).toBe(false);

        answerStart!();
        await new Promise((r) => setTimeout(r, 20));
        expect(calls.filter((c) => c.url === "/api/jobs/job-9/cancel")).toHaveLength(1);
        expect(calls.some((c) => c.init.method === "GET")).toBe(false);
    });

    test("giving up after the time limit is a timeout and the server is asked to cancel", async () => {
        const server = jobServer({ status: "done", result: { status: 200, body: answer } }, 1_000_000);
        const result = await createApiClient({ fetch: server.fetchFn, pollMs: 5, aiTimeoutMs: 60 }).createPlan(PLAN_REQUEST);
        expect(result).toMatchObject({ ok: false, kind: "timeout" });
        expect(server.calls.filter((c) => c.url === "/api/jobs/job-1/cancel")).toHaveLength(1);
    });

    test("a job the server no longer knows (restart, expiry) ends as a retryable failure, without a plan", async () => {
        let started = false;
        const { fetchFn } = fakeFetch(() => {
            if (!started) {
                started = true;
                return json(202, { job: { id: "job-1", status: "running", createdAt: "t" } });
            }
            return json(404, { code: "NOT_FOUND", error: "Detyra nuk u gjet. Mund të ketë skaduar ose serveri të jetë rinisur." });
        });
        const result = await createApiClient({ fetch: fetchFn, pollMs: 1 }).createPlan(PLAN_REQUEST);
        expect(result).toMatchObject({ ok: false, kind: "server", status: 404, code: "NOT_FOUND" });
    });

    test("a start refused as busy is a busy failure with nothing polled", async () => {
        const { fetchFn, calls } = fakeFetch(() => json(429, { code: "BUSY", error: "Një plan po krijohet tashmë. Prit sa të mbarojë." }));
        const result = await createApiClient({ fetch: fetchFn, pollMs: 1 }).createPlan(PLAN_REQUEST);
        expect(result).toMatchObject({ ok: false, kind: "busy", code: "BUSY" });
        expect(calls).toHaveLength(1);
    });

    test("a start whose connection failed is repeated once with the same key; a second failure is offline", async () => {
        const { fetchFn, calls } = fakeFetch(() => {
            throw new TypeError("network");
        });
        const result = await createApiClient({ fetch: fetchFn, pollMs: 1, newKey: () => "key-0001-abcdef" }).createPlan(PLAN_REQUEST);
        expect(result).toMatchObject({ ok: false, kind: "offline" });
        expect(calls).toHaveLength(2);
        expect(calls.map((c) => new Headers(c.init.headers).get("Idempotency-Key"))).toEqual(["key-0001-abcdef", "key-0001-abcdef"]);
    });

    test("a lost poll is tolerated; a connection that stays down ends as offline", async () => {
        let n = 0;
        const flaky = fakeFetch(({ init }) => {
            if (init.method === "POST") return json(202, { job: { id: "job-1", status: "running", createdAt: "t" } });
            n++;
            if (n === 1) throw new TypeError("network");
            return json(200, { job: { id: "job-1", createdAt: "t", status: "done", result: { status: 200, body: { sessions: [] } } } });
        });
        expect(await createApiClient({ fetch: flaky.fetchFn, pollMs: 1 }).createPlan(PLAN_REQUEST)).toEqual({ ok: true, data: { sessions: [] } });

        const down = fakeFetch(({ init }) => {
            if (init.method === "POST") return json(202, { job: { id: "job-1", status: "running", createdAt: "t" } });
            throw new TypeError("network");
        });
        expect(await createApiClient({ fetch: down.fetchFn, pollMs: 1 }).createPlan(PLAN_REQUEST)).toMatchObject({ ok: false, kind: "offline" });
    });

    test("a job cancelled by someone else, or an answer without a job, is a server failure, never a plan", async () => {
        const cancelled = jobServer({ status: "cancelled" }, 0);
        expect(await createApiClient({ fetch: cancelled.fetchFn, pollMs: 1 }).createPlan(PLAN_REQUEST)).toMatchObject({ ok: false, kind: "server" });

        const odd = fakeFetch(() => json(202, { nope: true }));
        expect(await createApiClient({ fetch: odd.fetchFn, pollMs: 1 }).createPlan(PLAN_REQUEST)).toMatchObject({ ok: false, kind: "server" });
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

    test("cancelling ends the request as aborted at once, while the job's start is still on its way", async () => {
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
        // The start itself is deliberately not cut off (it may already have created the job; see "plan jobs"),
        // but it ends by its own limit, so nothing waits on it.
        expect(local.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
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
