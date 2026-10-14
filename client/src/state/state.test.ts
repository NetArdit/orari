import { describe, expect, test } from "vitest";
import type { ApiClient, ApiResult } from "../api/client.ts";
import type { ParsedDescription, PlanAnswer } from "../api/types.ts";
import { emptyPlanForm } from "../domain/planForm.ts";
import type { PlanFormState } from "../domain/planForm.ts";
import type { StoredPlan, StoredProfile, StoredSession } from "../storage/model.ts";
import { createRepository } from "../storage/repository.ts";
import { createMemoryStore } from "../storage/store.ts";
import { createParseFlow, createPlanFlow, createReplanFlow } from "./flows.ts";
import { createPlanStore } from "./planStore.ts";

// Wednesday 14 October 2026, 12:00 local time.
const NOW = new Date(2026, 9, 14, 12, 0);
const now = () => NOW;
const profile: StoredProfile = { id: "u1", name: "Arta", educationLevel: "university", school: "", createdAt: "2026-09-01T08:00:00.000Z" };

const session = (id: string, date: string, status: StoredSession["status"] = "pending", startTime = "08:00", endTime = "09:00"): StoredSession => ({
    id, status, date, startTime, endTime, type: "learning", title: "Seancë " + id, goal: "", tasks: [], material: null, difficulty: "medium",
});

const plan = (id: string, sessions: StoredSession[], createdAt = "2026-10-01T08:00:00.000Z"): StoredPlan => ({
    id, createdAt, subject: "Matematikë", startDate: "2026-10-10", endDate: "2026-10-30", planMode: "exam", strategy: "E vjetra", explanations: [], warnings: [],
    structured: { startDate: "2026-10-10", endDate: "2026-10-30", subject: "Matematikë" }, sessions,
});

const answer = (sessions: StoredSession[], extra: Partial<PlanAnswer> = {}): PlanAnswer => ({
    profile: { name: "Arta" }, subject: "Matematikë", startDate: "2026-10-14", endDate: "2026-10-30", planMode: "exam", strategy: "E reja", explanations: ["Sepse"], warnings: ["Kujdes"],
    stats: { totalSessions: sessions.length, totalMinutes: 0, totalHours: 0 }, sessions: sessions.map((s) => ({ ...s, status: "pending" as const })), ...extra,
});

/** A promise the test resolves when it chooses, to hold a request "in flight". */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((r) => (resolve = r));
    return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

async function setup(plans: StoredPlan[] = []) {
    const memory = createMemoryStore();
    const repository = createRepository(memory, now);
    await repository.initialise(profile, plans, { fromLegacy: false });
    const store = createPlanStore(repository);
    await store.load();
    return { memory, repository, store };
}

const readyState = (store: ReturnType<typeof createPlanStore>) => {
    const state = store.getState();
    if (state.status !== "ready") throw new Error("store not ready: " + state.status);
    return state;
};
const statuses = (store: ReturnType<typeof createPlanStore>, planId = "p1") => readyState(store).plans.find((p) => p.id === planId)?.sessions.map((s) => s.status);

/** An API whose calls are recorded and answered by the test. Aborting a call rejects it as the real client reports it. */
function fakeApi() {
    const calls: { route: string; input: unknown; signal: AbortSignal | undefined }[] = [];
    let respond: (route: string, input: unknown) => Promise<ApiResult<unknown>> = async () => ({ ok: false, kind: "server", message: "no answer set" });

    const call = (route: string) => (input: unknown, options: { signal?: AbortSignal } = {}) => {
        calls.push({ route, input, signal: options.signal });
        return new Promise<ApiResult<unknown>>((resolve) => {
            options.signal?.addEventListener("abort", () => resolve({ ok: false, kind: "aborted", message: "Kërkesa u ndal." }), { once: true });
            respond(route, input).then(resolve);
        });
    };

    const api = { health: call("health"), parse: call("parse"), createPlan: call("create"), adjustPlan: call("adjust") } as unknown as ApiClient;
    return { api, calls, answerWith: (fn: typeof respond) => (respond = fn) };
}

const validForm = (): PlanFormState => ({ ...emptyPlanForm("2026-10-14"), subject: "Matematikë", endDate: "2026-10-30" });

describe("the plan store", () => {
    test("starts loading, then holds the profile and the plans newest first", async () => {
        const repository = createRepository(createMemoryStore(), now);
        await repository.initialise(profile, [plan("old", [], "2026-09-01T00:00:00.000Z"), plan("new", [], "2026-10-05T00:00:00.000Z")], { fromLegacy: false });
        const store = createPlanStore(repository);
        expect(store.getState()).toEqual({ status: "loading" });

        await store.load();

        const state = readyState(store);
        expect([state.profile?.name, state.plans.map((p) => p.id), state.unreadable, state.saveError]).toEqual(["Arta", ["new", "old"], [], null]);
    });

    test("an empty device is ready with no profile and no plans", async () => {
        const store = createPlanStore(createRepository(createMemoryStore(), now));
        await store.load();
        expect(readyState(store)).toMatchObject({ profile: null, plans: [] });
    });

    test("storage that cannot be read gives a failed state, not an exception", async () => {
        const store = createPlanStore(createRepository(createMemoryStore({ meta: { schemaVersion: 99, createdAt: "x", migratedFromLegacyAt: null } }), now));
        await store.load();
        expect(store.getState()).toEqual({ status: "failed", reason: "storage_newer_than_app" });
    });

    test("subscribers are told of every change and can stop listening", async () => {
        const { store } = await setup([plan("p1", [session("s1", "2026-10-14")])]);
        let calls = 0;
        const stop = store.subscribe(() => calls++);
        await store.markSession("p1", "s1", "completed");
        expect(calls).toBeGreaterThan(0);
        const seen = calls;
        stop();
        await store.markSession("p1", "s1", "pending");
        expect(calls).toBe(seen);
    });

    test("marking shows at once and is then kept in storage", async () => {
        const { store, repository } = await setup([plan("p1", [session("s1", "2026-10-14"), session("s2", "2026-10-15")])]);

        const kept = store.markSession("p1", "s1", "completed");
        expect(statuses(store)).toEqual(["completed", "pending"]); // before the write has finished

        expect(await kept).toBe(true);
        expect((await repository.getPlan("p1"))?.sessions.map((s) => s.status)).toEqual(["completed", "pending"]);
        expect(readyState(store).saveError).toBeNull();
    });

    test("if the write fails the mark is taken back and the failure is reported", async () => {
        const { store, memory, repository } = await setup([plan("p1", [session("s1", "2026-10-14", "partial")])]);
        memory.failNextCommit();

        const kept = store.markSession("p1", "s1", "completed");
        expect(statuses(store)).toEqual(["completed"]);

        expect(await kept).toBe(false);
        expect(statuses(store)).toEqual(["partial"]);
        expect(readyState(store).saveError).toEqual({ planId: "p1", sessionId: "s1" });
        expect((await repository.getPlan("p1"))?.sessions[0]?.status).toBe("partial");

        store.dismissSaveError();
        expect(readyState(store).saveError).toBeNull();
    });

    test("quick marks on one session all apply in order; the last one is what stays", async () => {
        const { store, repository } = await setup([plan("p1", [session("s1", "2026-10-14")])]);

        const results = await Promise.all([store.markSession("p1", "s1", "completed"), store.markSession("p1", "s1", "partial"), store.markSession("p1", "s1", "skipped")]);

        expect(results).toEqual([true, true, true]);
        expect(statuses(store)).toEqual(["skipped"]);
        expect((await repository.getPlan("p1"))?.sessions[0]?.status).toBe("skipped");
    });

    test("an earlier mark that fails late does not undo a newer mark", async () => {
        const { store, memory, repository } = await setup([plan("p1", [session("s1", "2026-10-14")])]);
        memory.failNextCommit(); // the first write fails, the second succeeds

        const first = store.markSession("p1", "s1", "completed");
        const second = store.markSession("p1", "s1", "partial");

        expect(await Promise.all([first, second])).toEqual([false, true]);
        expect(statuses(store)).toEqual(["partial"]);
        expect((await repository.getPlan("p1"))?.sessions[0]?.status).toBe("partial");
        expect(readyState(store).saveError).toBeNull();
    });

    test("when the newest mark fails, the screen goes back to what storage really holds", async () => {
        const { store, memory, repository } = await setup([plan("p1", [session("s1", "2026-10-14")])]);

        const first = store.markSession("p1", "s1", "completed");
        const second = store.markSession("p1", "s1", "skipped");
        await first;
        memory.failNextCommit();

        expect(await second).toBe(false);
        expect(statuses(store)).toEqual(["completed"]);
        expect((await repository.getPlan("p1"))?.sessions[0]?.status).toBe("completed");
    });

    test("marks on different sessions of one plan do not overwrite each other", async () => {
        const { store, repository } = await setup([plan("p1", [session("s1", "2026-10-14"), session("s2", "2026-10-14"), session("s3", "2026-10-14")])]);
        await Promise.all([store.markSession("p1", "s1", "completed"), store.markSession("p1", "s2", "partial"), store.markSession("p1", "s3", "skipped")]);
        expect(statuses(store)).toEqual(["completed", "partial", "skipped"]);
        expect((await repository.getPlan("p1"))?.sessions.map((s) => s.status)).toEqual(["completed", "partial", "skipped"]);
    });

    test("marking something that is not there does nothing and says so", async () => {
        const { store } = await setup([plan("p1", [session("s1", "2026-10-14")])]);
        expect(await store.markSession("p1", "nope", "completed")).toBe(false);
        expect(await store.markSession("nope", "s1", "completed")).toBe(false);
        expect(statuses(store)).toEqual(["pending"]);
    });

    test("saving a plan shows it only once it is stored; a failed save shows nothing and reports it", async () => {
        const { store, memory } = await setup([]);

        expect(await store.savePlan(plan("p1", []))).toBe(true);
        expect(readyState(store).plans.map((p) => p.id)).toEqual(["p1"]);

        memory.failNextCommit();
        expect(await store.savePlan(plan("p2", []))).toBe(false);
        expect(readyState(store).plans.map((p) => p.id)).toEqual(["p1"]);
        expect(readyState(store).saveError).toEqual({ planId: "p2" });
    });

    test("deleting removes the plan from storage and from the screen; a failed delete leaves it", async () => {
        const { store, memory, repository } = await setup([plan("p1", []), plan("p2", [])]);

        memory.failNextCommit();
        expect(await store.deletePlan("p1")).toBe(false);
        expect(readyState(store).plans).toHaveLength(2);

        expect(await store.deletePlan("p1")).toBe(true);
        expect(readyState(store).plans.map((p) => p.id)).toEqual(["p2"]);
        expect(await repository.getPlan("p1")).toBeNull();
    });

    test("a second load started while the first is running wins", async () => {
        const memory = createMemoryStore();
        const repository = createRepository(memory, now);
        await repository.initialise(profile, [plan("p1", [])], { fromLegacy: false });
        const store = createPlanStore(repository);

        const first = store.load();
        await repository.savePlan(plan("p2", [], "2026-10-09T00:00:00.000Z"));
        const second = store.load();
        await Promise.all([first, second]);

        expect(readyState(store).plans.map((p) => p.id)).toEqual(["p2", "p1"]);
    });
});

describe("reading a description", () => {
    const parsed = (extra: Partial<ParsedDescription> = {}): ParsedDescription => ({
        startDate: null, endDate: "2026-10-30", subject: "JavaScript", materialAmount: null, goal: null, planMode: null, weeklyAvailability: [], commitments: [],
        sessionPreferenceMinutes: null, energy: null, difficulty: null, clarifyingQuestions: ["A ke pushim dreke?"], ...extra,
    });

    test("sends the text with the person's own date and time zone, and gives back an editable form with the AI's questions", async () => {
        const { store } = await setup();
        const { api, calls, answerWith } = fakeApi();
        answerWith(async () => ({ ok: true, data: parsed() }));
        const flow = createParseFlow({ api, store, now, timeZone: () => "Europe/Belgrade" });

        expect(flow.start("  Du me msu JavaScript deri në fund të tetorit  ")).toBe(true);
        expect(flow.getState()).toEqual({ status: "working", startedAt: NOW.getTime() });
        await tick();

        expect(calls[0]?.input).toEqual({ text: "Du me msu JavaScript deri në fund të tetorit", clientDate: "2026-10-14", timeZone: "Europe/Belgrade" });
        const state = flow.getState();
        expect(state.status === "done" && [state.result.form.subject, state.result.form.startDate, state.result.form.endDate, state.result.questions]).toEqual(["JavaScript", "2026-10-14", "2026-10-30", ["A ke pushim dreke?"]]);
    });

    test("a description that is too short never reaches the server", async () => {
        const { store } = await setup();
        const { api, calls } = fakeApi();
        const flow = createParseFlow({ api, store, now });
        flow.start(" a ");
        await tick();
        expect(calls).toHaveLength(0);
        expect(flow.getState()).toMatchObject({ status: "failed", failure: { kind: "invalid" } });
    });

    test("a failure keeps its kind, message and retry time", async () => {
        const { store } = await setup();
        const { api, answerWith } = fakeApi();
        answerWith(async () => ({ ok: false, kind: "busy", message: "Shërbimi është i zënë.", retryAfterSeconds: 15 }));
        const flow = createParseFlow({ api, store, now });
        flow.start("abc def");
        await tick();
        expect(flow.getState()).toEqual({ status: "failed", failure: { kind: "busy", message: "Shërbimi është i zënë.", retryAfterSeconds: 15 } });
    });
});

describe("creating a plan", () => {
    const start = (flow: ReturnType<typeof createPlanFlow>, form = validForm()) => flow.start({ form, profile });

    test("a valid form becomes a stored plan with the server's sessions, unmarked", async () => {
        const { store, repository } = await setup();
        const { api, calls, answerWith } = fakeApi();
        answerWith(async () => ({ ok: true, data: answer([session("x1", "2026-10-15"), session("x2", "2026-10-16")]) }));
        let n = 0;
        const flow = createPlanFlow({ api, store, now, newId: () => `id-${++n}` });

        start(flow);
        expect(flow.getState().status).toBe("working");
        await tick();
        await store.settled();
        await tick();

        expect(calls[0]?.input).toMatchObject({ profile: { name: "Arta", educationLevel: "university" }, structured: { subject: "Matematikë", startDate: "2026-10-14", endDate: "2026-10-30" } });
        expect(flow.getState()).toEqual({ status: "done", result: { planId: "id-1", sessions: 2, warnings: ["Kujdes"] } });
        const saved = await repository.getPlan("id-1");
        expect([saved?.subject, saved?.sessions.map((s) => [s.id, s.status]), saved?.structured.subject]).toEqual(["Matematikë", [["x1", "pending"], ["x2", "pending"]], "Matematikë"]);
        expect(readyState(store).plans.map((p) => p.id)).toEqual(["id-1"]);
    });

    test("an invalid form is refused with its field errors and nothing is sent", async () => {
        const { store } = await setup();
        const { api, calls } = fakeApi();
        const flow = createPlanFlow({ api, store, now });
        start(flow, emptyPlanForm("2026-10-14"));
        await tick();
        expect(calls).toHaveLength(0);
        const state = flow.getState();
        expect(state.status === "failed" && state.failure.kind === "invalid" && state.failure.fields.map((f) => f.path)).toEqual(["structured.subject", "structured.endDate"]);
    });

    test("a second tap while working sends nothing more", async () => {
        const { store } = await setup();
        const { api, calls, answerWith } = fakeApi();
        const held = deferred<ApiResult<unknown>>();
        answerWith(() => held.promise);
        const flow = createPlanFlow({ api, store, now });

        expect(start(flow)).toBe(true);
        expect(start(flow)).toBe(false);
        expect(start(flow)).toBe(false);
        await tick();
        expect(calls).toHaveLength(1);
        held.resolve({ ok: true, data: answer([session("x1", "2026-10-15")]) });
    });

    test("the server's refusal is shown with its fields and nothing is stored; the flow can be tried again", async () => {
        const { store } = await setup();
        const { api, answerWith } = fakeApi();
        const fields = [{ path: "structured.endDate", message: "Data nuk është e vlefshme." }];
        answerWith(async () => ({ ok: false, kind: "validation", message: "Datat e planit nuk janë valide.", fields }));
        const flow = createPlanFlow({ api, store, now });

        start(flow);
        await tick();
        expect(flow.getState()).toEqual({ status: "failed", failure: { kind: "validation", message: "Datat e planit nuk janë valide.", fields } });
        expect(readyState(store).plans).toEqual([]);

        answerWith(async () => ({ ok: true, data: answer([session("x1", "2026-10-15")]) }));
        expect(start(flow)).toBe(true); // retry from the failed state
        await tick();
        await store.settled();
        await tick();
        expect(flow.getState().status).toBe("done");
    });

    test("cancelling stops the request, returns to idle at once, and a late answer changes nothing", async () => {
        const { store } = await setup();
        const { api, calls, answerWith } = fakeApi();
        const held = deferred<ApiResult<unknown>>();
        answerWith(() => held.promise);
        const flow = createPlanFlow({ api, store, now });

        start(flow);
        await tick();
        flow.cancel();
        expect(flow.getState()).toEqual({ status: "idle" });
        expect(calls[0]?.signal?.aborted).toBe(true);

        held.resolve({ ok: true, data: answer([session("x1", "2026-10-15")]) }); // the server answered anyway
        await tick();
        await store.settled();
        expect(flow.getState()).toEqual({ status: "idle" });
        expect(readyState(store).plans).toEqual([]);
    });

    test("an answer from a cancelled run does not overwrite the run started after it", async () => {
        const { store } = await setup();
        const { api, answerWith } = fakeApi();
        const firstAnswer = deferred<ApiResult<unknown>>();
        answerWith(() => firstAnswer.promise);
        const flow = createPlanFlow({ api, store, now });

        start(flow);
        await tick();
        flow.cancel();

        answerWith(async () => ({ ok: false, kind: "timeout", message: "AI po vonon." }));
        start(flow);
        await tick();
        expect(flow.getState()).toMatchObject({ status: "failed", failure: { kind: "timeout" } });

        firstAnswer.resolve({ ok: true, data: answer([session("x1", "2026-10-15")]) });
        await tick();
        await store.settled();
        expect(flow.getState()).toMatchObject({ status: "failed", failure: { kind: "timeout" } });
        expect(readyState(store).plans).toEqual([]);
    });

    test("with a connection that ignores cancelling, the old run's late answer still cannot touch the new run or storage", async () => {
        const { store } = await setup();
        // Unlike fakeApi, this one never reacts to the abort signal: answers arrive whenever the test says.
        const pending: ((result: ApiResult<PlanAnswer>) => void)[] = [];
        const api = { createPlan: () => new Promise<ApiResult<PlanAnswer>>((resolve) => pending.push(resolve)) } as unknown as ApiClient;
        let n = 0;
        const flow = createPlanFlow({ api, store, now, newId: () => `id-${++n}` });

        start(flow);
        await tick();
        flow.cancel();
        start(flow);
        await tick();
        expect(pending).toHaveLength(2);

        pending[0]!({ ok: true, data: answer([session("from-cancelled-run", "2026-10-15")]) });
        await tick();
        await store.settled();
        await tick();
        expect(flow.getState().status).toBe("working"); // the second run is still the one that counts
        expect(readyState(store).plans).toEqual([]);

        pending[1]!({ ok: true, data: answer([session("from-current-run", "2026-10-16")]) });
        await tick();
        await store.settled();
        await tick();
        expect(flow.getState()).toMatchObject({ status: "done", result: { sessions: 1 } });
        expect(readyState(store).plans.map((p) => p.sessions.map((s) => s.id))).toEqual([["from-current-run"]]);
    });

    test("if the plan cannot be stored the person is told so, and it is not shown as created", async () => {
        const { store, memory } = await setup();
        const { api, answerWith } = fakeApi();
        answerWith(async () => {
            memory.failNextCommit();
            return { ok: true, data: answer([session("x1", "2026-10-15")]) };
        });
        const flow = createPlanFlow({ api, store, now });

        start(flow);
        await tick();
        await store.settled();
        await tick();

        expect(flow.getState()).toMatchObject({ status: "failed", failure: { kind: "storage" } });
        expect(readyState(store).plans).toEqual([]);
    });

    test("reset returns to the beginning from a result or a failure", async () => {
        const { store } = await setup();
        const { api, answerWith } = fakeApi();
        answerWith(async () => ({ ok: false, kind: "offline", message: "Pa lidhje." }));
        const flow = createPlanFlow({ api, store, now });
        start(flow);
        await tick();
        expect(flow.getState().status).toBe("failed");
        flow.reset();
        expect(flow.getState()).toEqual({ status: "idle" });
    });

    test("something unexpected inside the flow becomes a failure, not an unhandled error", async () => {
        const { store } = await setup();
        const { api, answerWith } = fakeApi();
        answerWith(async () => ({ ok: true, data: { not: "a plan" } }));
        const flow = createPlanFlow({ api, store, now });
        start(flow);
        await tick();
        await tick();
        expect(flow.getState()).toMatchObject({ status: "failed", failure: { kind: "server" } });
    });
});

describe("adjusting a plan", () => {
    const original = () =>
        plan("p1", [
            session("past-done", "2026-10-10", "completed"),
            session("past-missed", "2026-10-13"),
            session("today-done", "2026-10-14", "completed"),
            session("today-open", "2026-10-14", "pending", "20:00", "21:00"),
            session("future-open", "2026-10-16"),
        ]);

    test("tells the server what was done and missed, then keeps the past and the marked and replaces the rest", async () => {
        const { store, repository } = await setup([original()]);
        const { api, calls, answerWith } = fakeApi();
        answerWith(async () => ({ ok: true, data: answer([session("new-1", "2026-10-15"), session("new-2", "2026-10-17")]) }));
        const flow = createReplanFlow({ api, store, now });

        flow.start({ planId: "p1", profile });
        await tick();
        await store.settled();
        await tick();

        expect(calls[0]?.input).toMatchObject({
            structured: original().structured,
            progress: { today: "2026-10-14", completedSessionSummaries: ["2026-10-10 Seancë past-done (completed)", "2026-10-14 Seancë today-done (completed)"], missedSessionSummaries: ["2026-10-13 Seancë past-missed"] },
        });
        expect(flow.getState()).toEqual({ status: "done", result: { planId: "p1", replaced: 2, added: 2, alreadyOver: 0, warnings: ["Kujdes"] } });
        const ids = ["past-done", "past-missed", "today-done", "new-1", "new-2"];
        expect((await repository.getPlan("p1"))?.sessions.map((s) => s.id)).toEqual(ids);
        expect(store.getPlan("p1")?.sessions.map((s) => s.id)).toEqual(ids);
        expect(store.getPlan("p1")?.strategy).toBe("E reja");
    });

    test("a session ticked while the request was in flight is kept, not overwritten by the answer", async () => {
        const { store, repository } = await setup([original()]);
        const { api, answerWith } = fakeApi();
        const held = deferred<ApiResult<unknown>>();
        answerWith(() => held.promise);
        const flow = createReplanFlow({ api, store, now });

        flow.start({ planId: "p1", profile });
        await tick();
        await store.markSession("p1", "today-open", "completed"); // done while waiting for the AI
        held.resolve({ ok: true, data: answer([session("new-1", "2026-10-15")]) });
        await tick();
        await store.settled();
        await tick();

        const sessions = (await repository.getPlan("p1"))?.sessions.map((s) => [s.id, s.status]);
        expect(sessions).toEqual([["past-done", "completed"], ["past-missed", "pending"], ["today-done", "completed"], ["today-open", "completed"], ["new-1", "pending"]]);
        expect(flow.getState()).toMatchObject({ status: "done", result: { replaced: 1, added: 1 } });
    });

    test("a failure leaves the plan exactly as it was", async () => {
        const { store, repository } = await setup([original()]);
        const { api, answerWith } = fakeApi();
        answerWith(async () => ({ ok: false, kind: "ai_failed", message: "AI nuk arriti të vendoste asnjë seancë." }));
        const flow = createReplanFlow({ api, store, now });

        flow.start({ planId: "p1", profile });
        await tick();

        expect(flow.getState()).toEqual({ status: "failed", failure: { kind: "ai_failed", message: "AI nuk arriti të vendoste asnjë seancë." } });
        expect(await repository.getPlan("p1")).toEqual(original());
    });

    test("cancelling leaves the plan as it was even if the answer arrives afterwards", async () => {
        const { store, repository } = await setup([original()]);
        const { api, answerWith } = fakeApi();
        const held = deferred<ApiResult<unknown>>();
        answerWith(() => held.promise);
        const flow = createReplanFlow({ api, store, now });

        flow.start({ planId: "p1", profile });
        await tick();
        flow.cancel();
        held.resolve({ ok: true, data: answer([session("new-1", "2026-10-15")]) });
        await tick();
        await store.settled();

        expect(flow.getState()).toEqual({ status: "idle" });
        expect(await repository.getPlan("p1")).toEqual(original());
    });

    test("if the new plan cannot be stored, the old one is untouched and the person is told", async () => {
        const { store, memory, repository } = await setup([original()]);
        const { api, answerWith } = fakeApi();
        answerWith(async () => {
            memory.failNextCommit();
            return { ok: true, data: answer([session("new-1", "2026-10-15")]) };
        });
        const flow = createReplanFlow({ api, store, now });

        flow.start({ planId: "p1", profile });
        await tick();
        await store.settled();
        await tick();

        expect(flow.getState()).toMatchObject({ status: "failed", failure: { kind: "storage" } });
        expect(await repository.getPlan("p1")).toEqual(original());
        expect(store.getPlan("p1")).toEqual(original());
    });

    test("a plan that is not there, or is deleted while waiting, ends as gone without touching storage", async () => {
        const { store } = await setup([original()]);
        const { api, calls, answerWith } = fakeApi();
        const flow = createReplanFlow({ api, store, now });

        flow.start({ planId: "nope", profile });
        await tick();
        expect(flow.getState()).toMatchObject({ status: "failed", failure: { kind: "gone" } });
        expect(calls).toHaveLength(0);

        const held = deferred<ApiResult<unknown>>();
        answerWith(() => held.promise);
        flow.start({ planId: "p1", profile });
        await tick();
        await store.deletePlan("p1");
        held.resolve({ ok: true, data: answer([session("new-1", "2026-10-15")]) });
        await tick();
        await store.settled();
        await tick();

        expect(flow.getState()).toMatchObject({ status: "failed", failure: { kind: "gone" } });
        expect(readyState(store).plans).toEqual([]);
    });
});
