import type {
    AccountSession,
    AccountUser,
    AdjustPlanRequest,
    CreatePlanRequest,
    ErrorCode,
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
 *  - provider_unavailable: the AI service behind the server is at its limit or out of reach.
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
    | "provider_unavailable"
    | "timeout"
    | "aborted"
    | "not_configured"
    | "ai_failed"
    | "offline"
    | "unauthenticated"
    | "invalid_credentials"
    | "unverified"
    | "conflict"
    | "forbidden"
    | "server";

export interface ApiFailure {
    ok: false;
    kind: ApiFailureKind;
    /** Albanian, safe to show. From the server when it sent one. */
    message: string;
    /** The server's own name for what happened, when it sent one. */
    code?: ErrorCode;
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
    provider_unavailable: "Shërbimi AI nuk është i disponueshëm për momentin. Provo më vonë.",
    timeout: "AI po vonon më shumë se zakonisht. Provo përsëri pas pak.",
    aborted: "Kërkesa u ndal.",
    not_configured: "AI nuk është konfiguruar ende.",
    ai_failed: "AI nuk mundi ta krijojë planin. Provo përsëri.",
    offline: "Nuk u lidhëm dot me serverin. Kontrollo internetin dhe provo përsëri.",
    unauthenticated: "Duhet të hysh në llogari.",
    invalid_credentials: "Email-i ose fjalëkalimi nuk është i saktë.",
    unverified: "Konfirmo email-in që të përdorësh sinkronizimin dhe AI-n.",
    conflict: "Kjo u ndryshua diku tjetër. Po e shfaqim versionin e fundit.",
    forbidden: "Kërkesa nuk u pranua nga kjo faqe.",
    server: "Ndodhi një gabim i papritur. Provo përsëri.",
};

/** Every code the server can send, and what the screens should do about it. A new server code will not compile until it is placed here. */
const KIND_FOR_CODE: Record<ErrorCode, ApiFailureKind> = {
    VALIDATION: "validation",
    BAD_JSON: "validation",
    BAD_REQUEST: "validation",
    BODY_TOO_LARGE: "validation",
    INVALID_DATES: "validation",
    DATES_REVERSED: "validation",
    PERIOD_TOO_LONG: "validation",
    NO_FREE_TIME: "validation",
    PLAN_FINISHED: "validation",
    RATE_LIMITED: "rate_limited",
    SERVER_BUSY: "busy",
    AI_NOT_CONFIGURED: "not_configured",
    PROVIDER_RATE_LIMITED: "provider_unavailable",
    PROVIDER_UNAVAILABLE: "provider_unavailable",
    AI_TIMEOUT: "timeout",
    AI_REJECTED_REQUEST: "ai_failed",
    AI_UNUSABLE_ANSWER: "ai_failed",
    AI_NO_USABLE_SESSIONS: "ai_failed",
    AI_FAILED: "ai_failed",
    NOT_FOUND: "server",
    INTERNAL: "server",
    UNAUTHENTICATED: "unauthenticated",
    INVALID_CREDENTIALS: "invalid_credentials",
    FORBIDDEN_ORIGIN: "forbidden",
    EMAIL_NOT_VERIFIED: "unverified",
    EMAIL_INVALID: "validation",
    NAME_INVALID: "validation",
    AGE_NOT_CONFIRMED: "validation",
    PASSWORD_TOO_SHORT: "validation",
    PASSWORD_TOO_LONG: "validation",
    PASSWORD_INVALID: "validation",
    PASSWORD_COMPROMISED: "validation",
    PASSWORD_CHECK_UNAVAILABLE: "busy",
    TOKEN_INVALID: "validation",
    TOO_MANY_ATTEMPTS: "rate_limited",
    REVISION_CONFLICT: "conflict",
    MARK_CONFLICT: "conflict",
    PLAN_EXISTS: "conflict",
    PLAN_LIMIT: "validation",
    OPERATION_INVALID: "validation",
    STATUS_INVALID: "validation",
    BUSY: "busy",
};

const isErrorCode = (value: unknown): value is ErrorCode => typeof value === "string" && Object.hasOwn(KIND_FOR_CODE, value);

/** Without a code (a proxy's own error page, an older server) only the status is left to go by. */
function kindForStatus(status: number): ApiFailureKind {
    if (status === 400 || status === 413) return "validation";
    if (status === 429) return "rate_limited";
    if (status === 504) return "timeout";
    if (status === 401) return "unauthenticated";
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
            return failure(response.ok ? "server" : kindForStatus(response.status), { status: response.status });
        }

        if (response.ok) return { ok: true, data: payload as T };

        const record = (payload ?? {}) as { code?: unknown; error?: unknown; fields?: unknown };
        const serverMessage = typeof record.error === "string" && record.error ? record.error : undefined;
        const code = isErrorCode(record.code) ? record.code : undefined;
        const kind = code ? KIND_FOR_CODE[code] : kindForStatus(response.status);
        const seconds = retryAfter(response);

        return failure(kind, {
            status: response.status,
            ...(code ? { code } : {}),
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

        /**
         * Accounts. Same result shape as everything else. Cookies travel by themselves (same origin); the
         * session token is never visible to this code. When the server runs without accounts every call
         * but status answers 404, which is a `server` failure, and status says "off".
         */
        account: {
            status: (options: RequestOptions = {}) => request<{ accounts: "off" | "memory" }>("GET", "/api/account/status", undefined, timeoutMs, options),
            me: (options: RequestOptions = {}) => request<{ user: AccountUser; canSync: boolean }>("GET", "/api/account/me", undefined, timeoutMs, options),
            signUp: (input: { email: string; password: string; name: string; confirmsAge16: boolean }, options: RequestOptions = {}) =>
                request<{ ok: true; status: "check_email" }>("POST", "/api/account/signup", input, timeoutMs, options),
            verify: (token: string, options: RequestOptions = {}) => request<{ ok: true }>("POST", "/api/account/verify", { token }, timeoutMs, options),
            resendVerification: (options: RequestOptions = {}) => request<{ ok: true }>("POST", "/api/account/resend-verification", {}, timeoutMs, options),
            logIn: (input: { email: string; password: string }, options: RequestOptions = {}) =>
                request<{ ok: true; user: AccountUser }>("POST", "/api/account/login", input, timeoutMs, options),
            logOut: (options: RequestOptions = {}) => request<{ ok: true }>("POST", "/api/account/logout", {}, timeoutMs, options),
            forgotPassword: (email: string, options: RequestOptions = {}) => request<{ ok: true }>("POST", "/api/account/password/forgot", { email }, timeoutMs, options),
            resetPassword: (input: { token: string; newPassword: string }, options: RequestOptions = {}) =>
                request<{ ok: true }>("POST", "/api/account/password/reset", input, timeoutMs, options),
            changePassword: (input: { currentPassword: string; newPassword: string }, options: RequestOptions = {}) =>
                request<{ ok: true }>("POST", "/api/account/password/change", input, timeoutMs, options),
            sessions: (options: RequestOptions = {}) => request<{ sessions: AccountSession[] }>("GET", "/api/account/sessions", undefined, timeoutMs, options),
            revokeSession: (sessionId: string, options: RequestOptions = {}) => request<{ ok: true }>("POST", "/api/account/sessions/revoke", { sessionId }, timeoutMs, options),
            revokeOtherSessions: (options: RequestOptions = {}) => request<{ ok: true; removed: number }>("POST", "/api/account/sessions/revoke-others", {}, timeoutMs, options),
            deleteAccount: (password: string, options: RequestOptions = {}) => request<{ ok: true }>("POST", "/api/account/delete", { password }, timeoutMs, options),
        },

        /** Plan sync; needs a session and a confirmed e-mail address. */
        sync: {
            listPlans: (options: RequestOptions = {}) => request<{ plans: Array<{ id: string } & Record<string, unknown>> }>("GET", "/api/sync/plans", undefined, timeoutMs, options),
            createPlan: (plan: unknown, options: RequestOptions = {}) => request<{ plan: unknown }>("POST", "/api/sync/plans", { plan }, timeoutMs, options),
        },
    };
}

export type ApiClient = ReturnType<typeof createApiClient>;
