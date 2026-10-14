/**
 * The three things that take time and can fail: reading a description, creating a plan, adjusting one.
 * Each is a small state machine with the same four states, so every screen can show the same things:
 * what is happening and a way to stop it, what went wrong and a way to retry, and the result.
 *
 * No React here. A flow is created once per screen; screens subscribe to it.
 */
import type { ApiClient, ApiFailure } from "../api/client.ts";
import type { CreatePlanRequest, FieldError } from "../api/types.ts";
import { clockFrom } from "../domain/clock.ts";
import { buildPlanInputs, formFromParsed } from "../domain/planForm.ts";
import type { PlanFormState } from "../domain/planForm.ts";
import { buildAdjustRequest, mergeReplan, planFromAnswer } from "../domain/replan.ts";
import type { StoredProfile } from "../storage/model.ts";
import type { PlanStore } from "./planStore.ts";

/** Why a flow stopped without a result. `storage` and `invalid` never involve the server. */
export type FlowFailure =
    | { kind: ApiFailure["kind"]; message: string; fields?: FieldError[]; retryAfterSeconds?: number }
    | { kind: "invalid"; message: string; fields: FieldError[] }
    | { kind: "storage"; message: string }
    | { kind: "gone"; message: string };

export type FlowState<TDone> =
    | { status: "idle" }
    | { status: "working"; startedAt: number }
    | { status: "failed"; failure: FlowFailure }
    | { status: "done"; result: TDone };

type Outcome<TDone> = { ok: true; result: TDone } | { ok: false; failure: FlowFailure } | { ok: false; cancelled: true };

const fromApi = (failure: ApiFailure): Outcome<never> =>
    failure.kind === "aborted"
        ? { ok: false, cancelled: true }
        : {
              ok: false,
              failure: {
                  kind: failure.kind,
                  message: failure.message,
                  ...(failure.fields ? { fields: failure.fields } : {}),
                  ...(failure.retryAfterSeconds ? { retryAfterSeconds: failure.retryAfterSeconds } : {}),
              },
          };

const STORAGE_FAILED: FlowFailure = { kind: "storage", message: "Plani u krijua, por nuk u ruajt dot në këtë pajisje. Provo përsëri." };

/**
 * The shared machine. One run at a time: start() while working is refused, which is what stops a
 * double tap from sending two requests. cancel() and reset() make any answer still on its way irrelevant:
 * it is ignored when it arrives and cannot overwrite a newer state.
 */
function createFlow<TInput, TDone>(run: (input: TInput, signal: AbortSignal) => Promise<Outcome<TDone>>, now: () => number) {
    let state: FlowState<TDone> = { status: "idle" };
    let controller: AbortController | null = null;
    let runId = 0;
    const listeners = new Set<() => void>();

    const set = (next: FlowState<TDone>) => {
        state = next;
        for (const listener of listeners) listener();
    };

    return {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },

        /** Starts a run. Returns false, and does nothing, if one is already going. */
        start(input: TInput): boolean {
            if (state.status === "working") return false;
            const mine = ++runId;
            controller = new AbortController();
            set({ status: "working", startedAt: now() });

            run(input, controller.signal)
                .catch((): Outcome<TDone> => ({ ok: false, failure: { kind: "server", message: "Ndodhi një gabim i papritur. Provo përsëri." } }))
                .then((outcome) => {
                    if (mine !== runId) return; // cancelled, reset or superseded while it ran
                    if (outcome.ok) set({ status: "done", result: outcome.result });
                    else if ("cancelled" in outcome) set({ status: "idle" });
                    else set({ status: "failed", failure: outcome.failure });
                });
            return true;
        },

        /** Stops the run in progress: the request is aborted and the flow is idle again at once. */
        cancel(): void {
            if (state.status !== "working") return;
            runId++;
            controller?.abort();
            set({ status: "idle" });
        },

        /** Back to the beginning from any state (dismissing a failure, or starting over after a result). */
        reset(): void {
            runId++;
            controller?.abort();
            set({ status: "idle" });
        },
    };
}

export interface FlowDeps {
    api: ApiClient;
    store: PlanStore;
    /** The current moment; replaced in tests. */
    now?: () => Date;
    timeZone?: () => string;
    newId?: () => string;
}

export interface ParsedResult {
    /** The form filled with what the AI understood, every part of it editable. */
    form: PlanFormState;
    /** What the AI still wants to know. Shown beside the form so each can be answered in place. */
    questions: string[];
}

/** Free text to an editable form. */
export function createParseFlow({ api, now = () => new Date(), timeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone }: FlowDeps) {
    return createFlow<string, ParsedResult>(async (text, signal) => {
        const trimmed = text.trim();
        if (trimmed.length < 3) {
            return { ok: false, failure: { kind: "invalid", message: "Shkruaj pak më shumë për atë që ke për të mësuar.", fields: [{ path: "text", message: "Shkruaj pak më shumë për atë që ke për të mësuar." }] } };
        }
        const today = clockFrom(now()).today;
        const result = await api.parse({ text: trimmed.slice(0, 2000), clientDate: today, timeZone: timeZone() }, { signal });
        if (!result.ok) return fromApi(result);
        return { ok: true, result: { form: formFromParsed(result.data, today), questions: result.data.clarifyingQuestions } };
    }, () => now().getTime());
}

export interface CreatedResult {
    planId: string;
    sessions: number;
    warnings: string[];
}

/** A checked form to a stored plan. The form is validated here first; an invalid form never reaches the server. */
export function createPlanFlow({ api, store, now = () => new Date(), newId }: FlowDeps) {
    return createFlow<{ form: PlanFormState; profile: Pick<StoredProfile, "name" | "educationLevel"> }, CreatedResult>(async ({ form, profile }, signal) => {
        const built = buildPlanInputs(form);
        if (!built.ok) return { ok: false, failure: { kind: "invalid", message: "Disa fusha duhen ndrequr.", fields: built.errors } };

        const request: CreatePlanRequest = { profile: { name: profile.name, educationLevel: profile.educationLevel }, structured: built.structured };
        const result = await api.createPlan(request, { signal });
        if (!result.ok) return fromApi(result);
        if (signal.aborted) return { ok: false, cancelled: true };

        const plan = planFromAnswer(result.data, built.structured as Record<string, unknown>, now(), newId);
        // addPlan never replaces a plan that is already stored; on an id clash it stores under another id.
        const planId = await store.addPlan(plan, newId);
        if (!planId) return { ok: false, failure: STORAGE_FAILED };
        return { ok: true, result: { planId, sessions: plan.sessions.length, warnings: plan.warnings } };
    }, () => now().getTime());
}

export interface ReplannedResult {
    planId: string;
    replaced: number;
    added: number;
    alreadyOver: number;
    warnings: string[];
}

/**
 * Adjusting a plan. The server's answer is joined with the plan as it is when the answer arrives, not
 * as it was when the request left: a session the person ticks while waiting is kept, not overwritten.
 */
export function createReplanFlow({ api, store, now = () => new Date(), newId }: FlowDeps) {
    return createFlow<{ planId: string; profile: Pick<StoredProfile, "name" | "educationLevel"> }, ReplannedResult>(async ({ planId, profile }, signal) => {
        const gone: Outcome<never> = { ok: false, failure: { kind: "gone", message: "Ky plan nuk është më në këtë pajisje." } };
        const before = store.getPlan(planId);
        if (!before) return gone;

        const result = await api.adjustPlan(buildAdjustRequest(before, profile, clockFrom(now())), { signal });
        if (!result.ok) return fromApi(result);
        if (signal.aborted) return { ok: false, cancelled: true };

        await store.settled(); // any marks made while waiting are in the plan before it is merged
        const current = store.getPlan(planId);
        if (!current) return gone;

        const merged = mergeReplan(current, result.data, clockFrom(now()), newId);
        if (!(await store.savePlan(merged.plan))) return { ok: false, failure: { kind: "storage", message: "Plani i ri nuk u ruajt dot në këtë pajisje. Plani yt i mëparshëm është i paprekur." } };
        return { ok: true, result: { planId, replaced: merged.replaced, added: merged.added, alreadyOver: merged.alreadyOver, warnings: merged.plan.warnings } };
    }, () => now().getTime());
}
