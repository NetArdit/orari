/**
 * The app's data in memory, kept in step with storage. No React here: screens subscribe to it
 * (useSyncExternalStore) and tests drive it directly.
 *
 * Marking a session is shown at once and written afterwards. If the write fails the mark is taken
 * back and the failure is reported, so the screen never claims progress the device did not keep.
 */
import type { Repository, UnreadablePlan } from "../storage/repository.ts";
import type { SessionStatus, StoredPlan, StoredProfile } from "../storage/model.ts";

export type StoreState =
    | { status: "loading" }
    | { status: "failed"; reason: string }
    | {
          status: "ready";
          profile: StoredProfile | null;
          /** Newest first. */
          plans: StoredPlan[];
          unreadable: UnreadablePlan[];
          /** The last thing that could not be saved, until the screen dismisses it. */
          saveError: { planId: string; sessionId?: string } | null;
      };

type Ready = Extract<StoreState, { status: "ready" }>;

export function createPlanStore(repository: Repository) {
    let state: StoreState = { status: "loading" };
    const listeners = new Set<() => void>();

    const set = (next: StoreState) => {
        state = next;
        for (const listener of listeners) listener();
    };
    const ready = (): Ready | null => (state.status === "ready" ? state : null);
    const patch = (change: Partial<Ready>) => {
        const current = ready();
        if (current) set({ ...current, ...change });
    };
    const withPlan = (plans: StoredPlan[], plan: StoredPlan) => [plan, ...plans.filter((p) => p.id !== plan.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    // Writes to one plan happen one after another, in the order they were asked for.
    const queues = new Map<string, Promise<unknown>>();
    const enqueue = <T>(planId: string, job: () => Promise<T>): Promise<T> => {
        const run = (queues.get(planId) ?? Promise.resolve()).then(job, job);
        queues.set(planId, run.catch(() => undefined));
        return run;
    };

    // For each session: the status storage is known to hold, and the latest mark asked for.
    const stored = new Map<string, SessionStatus>();
    const latestMark = new Map<string, number>();
    let markCounter = 0;
    const keyOf = (planId: string, sessionId: string) => `${planId}\u0000${sessionId}`;

    let loadCounter = 0;

    return {
        getState: () => state,
        subscribe(listener: () => void) {
            listeners.add(listener);
            return () => {
                listeners.delete(listener);
            };
        },

        /** Reads everything from storage. A second call while one is running wins; the older result is dropped. */
        async load(): Promise<void> {
            const mine = ++loadCounter;
            try {
                // Refuses data written by a newer version of the app before anything is read from it.
                await repository.readMeta();
                const profile = await repository.getProfile();
                const { plans, unreadable } = await repository.listPlans();
                if (mine !== loadCounter) return;
                stored.clear();
                for (const plan of plans) for (const s of plan.sessions) stored.set(keyOf(plan.id, s.id), s.status);
                set({ status: "ready", profile, plans, unreadable, saveError: null });
            } catch (error) {
                if (mine !== loadCounter) return;
                set({ status: "failed", reason: error instanceof Error ? error.message : String(error) });
            }
        },

        dismissSaveError() {
            patch({ saveError: null });
        },

        /**
         * Marks a session. The screen changes immediately; the returned promise says whether it was kept.
         * Marks made quickly one after another on the same session all take effect in order, and only the
         * last one decides what is shown: an earlier mark finishing late, or failing late, does not undo a newer one.
         */
        markSession(planId: string, sessionId: string, status: SessionStatus): Promise<boolean> {
            const current = ready();
            const plan = current?.plans.find((p) => p.id === planId);
            if (!current || !plan || !plan.sessions.some((s) => s.id === sessionId)) return Promise.resolve(false);

            const key = keyOf(planId, sessionId);
            const mark = ++markCounter;
            latestMark.set(key, mark);

            const apply = (value: SessionStatus) => {
                const now = ready();
                const target = now?.plans.find((p) => p.id === planId);
                if (!now || !target) return;
                patch({ plans: now.plans.map((p) => (p.id === planId ? { ...p, sessions: p.sessions.map((s) => (s.id === sessionId ? { ...s, status: value } : s)) } : p)) });
            };
            apply(status);

            return enqueue(planId, async () => {
                try {
                    const saved = await repository.setSessionStatus(planId, sessionId, status);
                    if (!saved) throw new Error("not_found");
                    stored.set(key, status);
                    // If the plan was replaced on screen while this write waited its turn (a re-plan
                    // finishing), show the mark again: storage has it.
                    if (latestMark.get(key) === mark) apply(status);
                    return true;
                } catch {
                    // Take the mark back only if nothing newer has been asked for this session since.
                    if (latestMark.get(key) === mark) {
                        const fallback = stored.get(key);
                        if (fallback) apply(fallback);
                        patch({ saveError: { planId, sessionId } });
                    }
                    return false;
                }
            });
        },

        /** Stores a plan (new, or a changed version of an existing one) and shows it. Nothing is shown if the write fails. */
        savePlan(plan: StoredPlan): Promise<boolean> {
            return enqueue(plan.id, async () => {
                try {
                    await repository.savePlan(plan);
                } catch {
                    patch({ saveError: { planId: plan.id } });
                    return false;
                }
                for (const s of plan.sessions) stored.set(keyOf(plan.id, s.id), s.status);
                const current = ready();
                if (current) patch({ plans: withPlan(current.plans, plan) });
                return true;
            });
        },

        deletePlan(planId: string): Promise<boolean> {
            return enqueue(planId, async () => {
                try {
                    await repository.deletePlan(planId);
                } catch {
                    patch({ saveError: { planId } });
                    return false;
                }
                const current = ready();
                if (current) patch({ plans: current.plans.filter((p) => p.id !== planId) });
                return true;
            });
        },

        /** The plan as it is right now, after any marks that have been made. */
        getPlan(planId: string): StoredPlan | null {
            return ready()?.plans.find((p) => p.id === planId) ?? null;
        },

        /** Resolves when every write asked for so far has finished. For tests and for leaving a screen safely. */
        async settled(): Promise<void> {
            await Promise.all([...queues.values()]);
        },
    };
}

export type PlanStore = ReturnType<typeof createPlanStore>;
