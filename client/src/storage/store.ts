/**
 * The smallest storage the repository needs: named values, and a way to change several of them
 * together or not at all. Two implementations: IndexedDB in the browser (idb.ts) and memory in tests.
 *
 * Anything a write depends on ("only if no profile exists yet", "remove every other plan") is stated
 * as part of the commit and evaluated inside it. Checking first and writing afterwards would let a
 * second tab slip in between the two.
 */
export type Write =
    | { key: string; value: unknown }
    | { key: string; delete: true }
    /** Removes every key with the prefix except the ones listed, as they are at the moment of the commit. */
    | { deletePrefix: string; except: string[] };

export interface CommitOptions {
    /** The commit happens only if none of these keys exists; otherwise it fails with PreconditionFailedError and changes nothing. */
    onlyIfAbsent?: string[];
}

export class PreconditionFailedError extends Error {
    constructor(public readonly key: string) {
        super("storage_precondition_failed");
    }
}

export interface KeyValueStore {
    get(key: string): Promise<unknown>;
    /** Keys that start with the prefix, sorted. */
    keys(prefix: string): Promise<string[]>;
    /** All writes succeed or none does. */
    commit(writes: Write[], options?: CommitOptions): Promise<void>;
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
        // No await inside: like an IndexedDB transaction, nothing else can run in the middle of a commit.
        async commit(writes, options = {}) {
            if (failNext) {
                failNext = false;
                throw new Error("storage_write_failed");
            }
            for (const key of options.onlyIfAbsent ?? []) {
                if (data.has(key)) throw new PreconditionFailedError(key);
            }
            // Cloning first means a value that cannot be stored fails before anything is changed.
            const prepared = writes.map((w) => ("value" in w ? { key: w.key, value: structuredClone(w.value) } : w));
            for (const w of prepared) {
                if ("deletePrefix" in w) {
                    for (const key of [...data.keys()]) if (key.startsWith(w.deletePrefix) && !w.except.includes(key)) data.delete(key);
                } else if ("delete" in w) data.delete(w.key);
                else data.set(w.key, w.value);
            }
        },
        dump: () => Object.fromEntries(structuredClone([...data.entries()])),
        failNextCommit: () => {
            failNext = true;
        },
    };
}
