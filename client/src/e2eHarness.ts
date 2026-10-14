/**
 * Test harness page, only in builds made with E2E=1 (`npm run client:build:e2e`); never in a normal build.
 * It puts the real repository over the real IndexedDB adapter within reach of the browser journeys, so
 * that two tabs can be made to write at the same moment (e2e/app-two-tabs.mjs). Each call names its own
 * database, so one round of a journey cannot disturb another or the app's own data.
 */
import { openIndexedDbStore } from "./storage/idb.ts";
import { createRepository } from "./storage/repository.ts";
import type { Repository } from "./storage/repository.ts";
import type { KeyValueStore } from "./storage/store.ts";

const opened = new Map<string, Promise<{ store: KeyValueStore; repository: Repository }>>();

function open(database: string) {
    let entry = opened.get(database);
    if (!entry) {
        entry = openIndexedDbStore(database).then((store) => ({ store, repository: createRepository(store) }));
        opened.set(database, entry);
    }
    return entry;
}

type Outcome = { ok: true; value: unknown } | { ok: false; error: string; name: string };

const harness = {
    /** Calls a repository method by name and reports the outcome as data, so a refusal is a result and not a crash. */
    async call(database: string, method: keyof Repository, ...args: unknown[]): Promise<Outcome> {
        try {
            const { repository } = await open(database);
            const value = await (repository[method] as (...a: unknown[]) => Promise<unknown>).apply(repository, args);
            return { ok: true, value: value ?? null };
        } catch (error) {
            return { ok: false, error: error instanceof Error ? error.message : String(error), name: error instanceof Error ? error.constructor.name : "unknown" };
        }
    },

    /** Everything in a database as { key: value }, read through the adapter. */
    async dump(database: string): Promise<Record<string, unknown>> {
        const { store } = await open(database);
        const out: Record<string, unknown> = {};
        for (const key of await store.keys("")) out[key] = await store.get(key);
        return out;
    },
};

declare global {
    interface Window {
        harness: typeof harness;
    }
}

window.harness = harness;
document.body.dataset.harness = "ready";
