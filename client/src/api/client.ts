import type {
    AdjustPlanRequest,
    CreatePlanRequest,
    FieldError,
    HealthAnswer,
    ParsedDescription,
    ParseRequest,
    PlanAnswer,
} from "./types.ts";

/**
 * Why a request did not succeed, in terms the screens can act on:
 *  - validation: the server refused the input; `fields` says where.
 *  - rate_limited / busy: come back later; `retryAfterSeconds` when the server said when.
 *  - timeout: we stopped waiting, or the server's own AI deadline passed.
 *  - aborted: the caller cancelled (the person pressed "Ndale" or left the screen). Not an error to show.
 *  - not_configured: the server has no AI key.
 *  - ai_failed: the AI answered but nothing usable came out; trying again may work.
 *  - offline: the request never reached the server.
 *  - server: anything else.
 */
export type ApiFailureKind =
    | "validation"
    | "rate_limited"
    | "busy"
    | "timeout"
    | "aborted"
    | "not_configured"
    | "ai_failed"
    | "offline"
    | "server";

export interface ApiFailure {
    ok: false;
    kind: ApiFailureKind;
    /** Albanian, safe to show. From the server when it sent one. */
    message: string;
    status?: number;
    fields?: FieldError[];
    retryAfterSeconds?: number;
}

export type ApiResult<T> = { ok: true; data: T } | ApiFailure;

export interface RequestOptions {
    /** Cancels the request; the result is then { kind: "aborted" }. */
    signal?: AbortSignal;
}

export interface ApiClientOptions {
    /** "" for same origin. */
    baseUrl?: string;
    fetch?: typeof fetch;
    /** How long to wait for an AI route. The server gives up at 75 s; a little more leaves room for its answer. */
    aiTimeoutMs?: number;
    timeoutMs?: number;
}

const FALLBACK: Record<ApiFailureKind, string> = {
    validation: "Disa të dhëna nuk janë në rregull.",
    rate_limited: "Ke bërë shumë kërkesa njëra pas tjetrës. Prit pak minuta dhe provo përsëri.",
    busy: "Shërbimi është i zënë për momentin. Provo përsëri pas pak.",
    timeout: "AI po vonon më shumë se zakonisht. Provo përsëri pas pak.",
    aborted: "Kërkesa u ndal.",
    not_configured: "AI nuk është konfiguruar ende.",
    ai_failed: "AI nuk mundi ta krijojë planin. Provo përsëri.",
    offline: "Nuk u lidhëm dot me serverin. Kontrollo internetin dhe provo përsëri.",
    server: "Ndodhi një gabim i papritur. Provo përsëri.",
};

/** The server uses 503 for three different situations; its message tells them apart. */
function kindForStatus(status: number, message: string): ApiFailureKind {
    if (status === 400 || status === 413) return "validation";
    if (status === 429) return "rate_limited";
    if (status === 504) return "timeout";
    if (status === 502) return "ai_failed";
    if (status === 503) {
        if (message === FALLBACK.not_configured) return "not_configured";
        if (message === FALLBACK.busy) return "busy";
        return "rate_limited"; // the AI provider's own usage limit, or a model that is unavailable
    }
    return "server";
}

function retryAfter(response: Response): number | undefined {
    const seconds = Number(response.headers.get("Retry-After"));
    return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

function isFieldErrors(value: unknown): value is FieldError[] {
    return Array.isArray(value) && value.every((f) => typeof f?.path === "string" && typeof f?.message === "string");
}

export function createApiClient({ baseUrl = "", fetch: fetchFn = globalThis.fetch, aiTimeoutMs = 85_000, timeoutMs = 10_000 }: ApiClientOptions = {}) {
    async function request<T>(method: "GET" | "POST", path: string, body: unknown, limitMs: number, options: RequestOptions): Promise<ApiResult<T>> {
        const failure = (kind: ApiFailureKind, extra: Partial<ApiFailure> = {}): ApiFailure => ({ ok: false, kind, message: FALLBACK[kind], ...extra });

        if (options.signal?.aborted) return failure("aborted");

        const timeout = AbortSignal.timeout(limitMs);
        const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;

        let response: Response;
        try {
            response = await fetchFn(baseUrl + path, {
                method,
                signal,
                ...(method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
            });
        } catch {
            if (options.signal?.aborted) return failure("aborted");
            if (timeout.aborted) return failure("timeout");
            return failure("offline");
        }

        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            if (options.signal?.aborted) return failure("aborted");
            if (timeout.aborted) return failure("timeout");
            // Not JSON: a proxy's error page, or a connection cut half-way.
            return failure(response.ok ? "server" : kindForStatus(response.status, ""), { status: response.status });
        }

        if (response.ok) return { ok: true, data: payload as T };

        const record = (payload ?? {}) as { error?: unknown; fields?: unknown };
        const serverMessage = typeof record.error === "string" && record.error ? record.error : undefined;
        const kind = kindForStatus(response.status, serverMessage ?? "");
        const seconds = retryAfter(response);

        return failure(kind, {
            status: response.status,
            ...(serverMessage ? { message: serverMessage } : {}),
            ...(isFieldErrors(record.fields) ? { fields: record.fields } : {}),
            ...(seconds ? { retryAfterSeconds: seconds } : {}),
        });
    }

    return {
        health: (options: RequestOptions = {}) => request<HealthAnswer>("GET", "/api/health", undefined, timeoutMs, options),

        /** Free text to structured plan inputs. The server gets the person's own date and time zone. */
        parse: async (input: ParseRequest, options: RequestOptions = {}): Promise<ApiResult<ParsedDescription>> => {
            const result = await request<{ parsed: ParsedDescription }>("POST", "/api/parse", input, aiTimeoutMs, options);
            return result.ok ? { ok: true, data: result.data.parsed } : result;
        },

        createPlan: (input: CreatePlanRequest, options: RequestOptions = {}) => request<PlanAnswer>("POST", "/api/create-plan", input, aiTimeoutMs, options),

        adjustPlan: (input: AdjustPlanRequest, options: RequestOptions = {}) => request<PlanAnswer>("POST", "/api/adjust-plan", input, aiTimeoutMs, options),
    };
}

export type ApiClient = ReturnType<typeof createApiClient>;
