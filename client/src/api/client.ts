import { uuid } from "../ids.ts";
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
    /** English, safe to show. From the server when it sent one. */
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
    /** How often a started plan job is asked about. */
    pollMs?: number;
    /** Makes the key that lets a repeated start be recognised by the server as the same job. */
    newKey?: () => string;
}

/** A job as the server describes it. `result` is only there once it is done or failed: the status and body the direct route would have answered. */
export interface JobSnapshot {
    id: string;
    status: "running" | "done" | "failed" | "cancelled";
    createdAt: string;
    result?: { status: number; body: unknown };
}

const FALLBACK: Record<ApiFailureKind, string> = {
    validation: "Some of the details are not right.",
    rate_limited: "You have made too many requests in a row. Wait a few minutes and try again.",
    busy: "The service is busy right now. Try again in a moment.",
    provider_unavailable: "The AI service is not available right now. Try again later.",
    timeout: "The AI is taking longer than usual. Try again in a moment.",
    aborted: "The request was stopped.",
    not_configured: "The AI is not configured yet.",
    ai_failed: "The AI could not create the plan. Try again.",
    offline: "Could not reach the server. Check your internet connection and try again.",
    unauthenticated: "You need to sign in.",
    invalid_credentials: "The e-mail or password is not correct.",
    unverified: "Confirm your e-mail to use the AI.",
    conflict: "This was changed elsewhere. Showing the latest version.",
    forbidden: "The request was not accepted from this page.",
    server: "Something unexpected went wrong. Try again.",
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

const makeFailure = (kind: ApiFailureKind, extra: Partial<ApiFailure> = {}): ApiFailure => ({ ok: false, kind, message: FALLBACK[kind], ...extra });

/** What an error answer (from a route, or carried inside a failed job) means for the screens. */
function failureFromAnswer(status: number, payload: unknown, seconds?: number): ApiFailure {
    const record = (payload ?? {}) as { code?: unknown; error?: unknown; fields?: unknown };
    const serverMessage = typeof record.error === "string" && record.error ? record.error : undefined;
    const code = isErrorCode(record.code) ? record.code : undefined;
    const kind = code ? KIND_FOR_CODE[code] : kindForStatus(status);
    return makeFailure(kind, {
        status,
        ...(code ? { code } : {}),
        ...(serverMessage ? { message: serverMessage } : {}),
        ...(isFieldErrors(record.fields) ? { fields: record.fields } : {}),
        ...(seconds ? { retryAfterSeconds: seconds } : {}),
    });
}

/** Waits, and wakes at once if the caller cancels. */
const pause = (ms: number, signal?: AbortSignal) =>
    new Promise<void>((resolve) => {
        if (signal?.aborted) return resolve();
        const timer = setTimeout(done, ms);
        function done() {
            clearTimeout(timer);
            signal?.removeEventListener("abort", done);
            resolve();
        }
        signal?.addEventListener("abort", done, { once: true });
    });

export function createApiClient({
    baseUrl = "",
    fetch: fetchFn = globalThis.fetch,
    aiTimeoutMs = 85_000,
    timeoutMs = 10_000,
    pollMs = 1_500,
    newKey = () => uuid(),
}: ApiClientOptions = {}) {
    async function request<T>(
        method: "GET" | "POST",
        path: string,
        body: unknown,
        limitMs: number,
        options: RequestOptions,
        extraHeaders: Record<string, string> = {},
    ): Promise<ApiResult<T>> {
        const failure = makeFailure;

        if (options.signal?.aborted) return failure("aborted");

        // One signal that ends on the caller's cancel or on the time limit. AbortSignal.any and AbortSignal.timeout are
        // not available in older phone browsers (Safari before 17.4, older Android WebViews); building it by hand
        // keeps every request working there.
        const controller = new AbortController();
        let timedOut = false;
        const timer = setTimeout(() => {
            timedOut = true;
            controller.abort();
        }, limitMs);
        const onCallerAbort = () => controller.abort();
        options.signal?.addEventListener("abort", onCallerAbort, { once: true });
        const signal = controller.signal;
        const release = () => {
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", onCallerAbort);
        };
        const timeout = { get aborted() { return timedOut; } };

        let response: Response;
        try {
            response = await fetchFn(baseUrl + path, {
                method,
                signal,
                ...(method === "POST" ? { headers: { "Content-Type": "application/json", ...extraHeaders }, body: JSON.stringify(body) } : {}),
            });
        } catch {
            release();
            if (options.signal?.aborted) return failure("aborted");
            if (timeout.aborted) return failure("timeout");
            return failure("offline");
        }

        let payload: unknown;
        try {
            payload = await response.json();
        } catch {
            release();
            if (options.signal?.aborted) return failure("aborted");
            if (timeout.aborted) return failure("timeout");
            // Not JSON: a proxy's error page, or a connection cut half-way.
            return failure(response.ok ? "server" : kindForStatus(response.status), { status: response.status });
        }
        release();

        if (response.ok) return { ok: true, data: payload as T };

        return failureFromAnswer(response.status, payload, retryAfter(response));
    }

    /**
     * A plan operation as a job: started, asked about until it ends, cancelled on the server when the caller
     * gives up. The answer has the same shape as the direct route's, so a screen cannot tell the difference.
     * Jobs live in the server's memory: after a restart or expiry a poll answers "not found", which is a
     * failure the person can retry, never a wrong plan.
     */
    async function runJob<T>(kind: "create-plan" | "adjust-plan", input: unknown, options: RequestOptions): Promise<ApiResult<T>> {
        if (options.signal?.aborted) return makeFailure("aborted");
        const deadline = Date.now() + aiTimeoutMs;
        const key = newKey();
        const cancelOnServer = (id: string) => {
            // Best effort and not waited for: the screen is already free. Without it the server's own deadline ends the work.
            void request("POST", `/api/jobs/${id}/cancel`, {}, timeoutMs, {}).catch(() => undefined);
        };

        // No single call may wait past the whole job's own limit.
        const limit = () => Math.max(1, Math.min(timeoutMs, deadline - Date.now()));
        // The start is not tied to the caller's signal: a request cut off in flight may still have created the job,
        // and then nobody would know its id to cancel it. It is short, and bounded by `limit()`.
        const startJob = () => request<{ job: JobSnapshot }>("POST", `/api/jobs/${kind}`, input, limit(), {}, { "Idempotency-Key": key });
        const startWithRetry = async () => {
            let result = await startJob();
            // A start whose answer was lost (the connection failed; the server said nothing) is safe to repeat once:
            // the same key names the same job.
            if (!result.ok && result.status === undefined && (result.kind === "offline" || result.kind === "timeout") && Date.now() < deadline) {
                result = await startJob();
            }
            return result;
        };

        const starting = startWithRetry();
        const gaveUp = new Promise<"aborted">((resolve) => {
            const signal = options.signal;
            if (!signal) return;
            if (signal.aborted) resolve("aborted");
            else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
        });
        const started = await Promise.race([starting, gaveUp]);
        if (started === "aborted") {
            // Given up before the server answered: the job may exist anyway, so it is cancelled the moment its id is known.
            void starting.then((late) => {
                if (late.ok && late.data?.job?.id) cancelOnServer(late.data.job.id);
            });
            return makeFailure("aborted");
        }
        if (!started.ok) return started;
        if (!started.data?.job?.id) return makeFailure("server");

        const id = started.data.job.id;
        let job = started.data.job;
        let lost = 0;
        while (job.status === "running") {
            if (options.signal?.aborted) {
                cancelOnServer(id);
                return makeFailure("aborted");
            }
            if (Date.now() >= deadline) {
                cancelOnServer(id);
                return makeFailure("timeout");
            }
            await pause(pollMs, options.signal);
            if (options.signal?.aborted) continue;
            const polled = await request<{ job: JobSnapshot }>("GET", `/api/jobs/${id}`, undefined, limit(), options);
            if (!polled.ok) {
                if (polled.kind === "aborted") continue;
                // A passing network error is tolerated a few times; anything the server said is final.
                if ((polled.kind === "offline" || polled.kind === "timeout") && ++lost < 4) continue;
                return polled;
            }
            lost = 0;
            job = polled.data.job;
        }

        if (job.status === "cancelled" || !job.result) return makeFailure("server");
        const { status, body } = job.result;
        return job.status === "done" && status >= 200 && status < 300 ? { ok: true, data: body as T } : failureFromAnswer(status, body);
    }

    return {
        health: (options: RequestOptions = {}) => request<HealthAnswer>("GET", "/api/health", undefined, timeoutMs, options),

        /** Free text to structured plan inputs. The server gets the person's own date and time zone. */
        parse: async (input: ParseRequest, options: RequestOptions = {}): Promise<ApiResult<ParsedDescription>> => {
            let result = await request<{ parsed: ParsedDescription }>("POST", "/api/parse", input, aiTimeoutMs, options);
            // Parsing changes nothing on the server, so one repeat after the host's start-up page is safe.
            if (!result.ok && result.kind === "server" && result.code === undefined && (result.status === 502 || result.status === 503)) {
                await pause(4000, options.signal);
                if (!options.signal?.aborted) result = await request<{ parsed: ParsedDescription }>("POST", "/api/parse", input, aiTimeoutMs, options);
            }
            return result.ok ? { ok: true, data: result.data.parsed } : result;
        },

        /** Plan creation and re-planning run as server jobs that are polled; the result is the same as the direct routes' (`/api/create-plan`, `/api/adjust-plan`, which still exist). */
        createPlan: (input: CreatePlanRequest, options: RequestOptions = {}) => runJob<PlanAnswer>("create-plan", input, options),

        adjustPlan: (input: AdjustPlanRequest, options: RequestOptions = {}) => runJob<PlanAnswer>("adjust-plan", input, options),

        /**
         * Accounts. Same result shape as everything else. Cookies travel by themselves (same origin); the
         * session token is never visible to this code. When the server runs without accounts every call
         * but status answers 404, which is a `server` failure, and status says "off".
         */
        account: {
            status: (options: RequestOptions = {}) => request<{ accounts: "off" | "memory" | "postgres" }>("GET", "/api/account/status", undefined, timeoutMs, options),
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
            updateName: (name: string, options: RequestOptions = {}) => request<{ ok: true; user: AccountUser }>("POST", "/api/account/profile", { name }, timeoutMs, options),
            changeEmail: (input: { newEmail: string; currentPassword: string }, options: RequestOptions = {}) =>
                request<{ ok: true; status: "check_email" }>("POST", "/api/account/email/change", input, timeoutMs, options),
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
