/**
 * The smallest storage the repository needs: named values, and a way to change several of them
 * together or not at all. Two implementations: IndexedDB in the browser (idb.ts) and memory in tests.
 */
export type Write = { key: string; value: unknown } | { key: string; delete: true };

export interface KeyValueStore {
    get(key: string): Promise<unknown>;
    /** Keys that start with the prefix, sorted. */
    keys(prefix: string): Promise<string[]>;
    /** All writes succeed or none does. */
    commit(writes: Write[]): Promise<void>;
}

export function createMemoryStore(initial: Record<string, unknown> = {}): KeyValueStore & { dump(): Record<string, unknown>; failNextCommit(): void } {
    const data = new Map<string, unknown>(Object.entries(structuredClone(initial)));
    let failNext = false;

    return {
        async get(key) {
            return structuredClone(data.get(key));
        },
        async keys(prefix) {
            return [...data.keys()].filter((k) => k.startsWith(prefix)).sort();
        },
        async commit(writes) {
            if (failNext) {
                failNext = false;
                throw new Error("storage_write_failed");
            }
            // Cloning first means a value that cannot be stored fails before anything is changed.
            const prepared = writes.map((w) => ("delete" in w ? w : { key: w.key, value: structuredClone(w.value) }));
            for (const w of prepared) {
                if ("delete" in w) data.delete(w.key);
                else data.set(w.key, w.value);
            }
        },
        dump: () => Object.fromEntries(structuredClone([...data.entries()])),
        failNextCommit: () => {
            failNext = true;
        },
    };
}
