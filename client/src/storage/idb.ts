import { PreconditionFailedError } from "./store.ts";
import type { CommitOptions, KeyValueStore, Write } from "./store.ts";

const DATABASE = "planifikues";
const STORE = "kv";

/**
 * IndexedDB as a key-value store. One object store; the repository's own schema version lives in the
 * data ("meta"), so the IndexedDB version only ever changes if this object store itself must change.
 * Exercised in a real browser by e2e/app-foundation.mjs; there is no IndexedDB in the unit tests.
 */
export function openIndexedDbStore(name: string = DATABASE): Promise<KeyValueStore> {
    return new Promise((resolve, reject) => {
        const open = indexedDB.open(name, 1);
        open.onupgradeneeded = () => {
            open.result.createObjectStore(STORE);
        };
        open.onerror = () => reject(open.error ?? new Error("indexeddb_open_failed"));
        open.onblocked = () => reject(new Error("indexeddb_blocked"));
        open.onsuccess = () => {
            const db = open.result;
            // Another tab upgrading the database must not be held up by this one.
            db.onversionchange = () => db.close();

            const done = <T>(request: IDBRequest<T>) =>
                new Promise<T>((res, rej) => {
                    request.onsuccess = () => res(request.result);
                    request.onerror = () => rej(request.error ?? new Error("indexeddb_request_failed"));
                });

            // "￿" sorts after every character a key can continue with.
            const withPrefix = (prefix: string) => IDBKeyRange.bound(prefix, prefix + "￿");

            resolve({
                get: (key) => done(db.transaction(STORE, "readonly").objectStore(STORE).get(key)),

                keys: async (prefix) => {
                    const keys = await done(db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys(withPrefix(prefix)));
                    return keys.map(String).sort();
                },

                /**
                 * One readwrite transaction. Readwrite transactions on the same object store run one
                 * after another, across tabs too, so the checks below and the writes that follow them
                 * cannot be interleaved with another commit. Requests are issued from inside each
                 * other's callbacks, which keeps the transaction alive until the last one.
                 */
                commit: (writes: Write[], options: CommitOptions = {}) =>
                    new Promise<void>((res, rej) => {
                        const tx = db.transaction(STORE, "readwrite");
                        const store = tx.objectStore(STORE);
                        let refusal: Error | null = null;

                        tx.oncomplete = () => res();
                        tx.onerror = () => rej(refusal ?? tx.error ?? new Error("indexeddb_write_failed"));
                        tx.onabort = () => rej(refusal ?? tx.error ?? new Error("indexeddb_write_aborted"));

                        const refuse = (error: unknown) => {
                            refusal = error instanceof Error ? error : new Error(String(error));
                            try {
                                tx.abort();
                            } catch {
                                /* already finished or aborted */
                            }
                        };

                        const apply = () => {
                            try {
                                for (const w of writes) {
                                    if ("deletePrefix" in w) {
                                        const listing = store.getAllKeys(withPrefix(w.deletePrefix));
                                        listing.onsuccess = () => {
                                            for (const key of listing.result) if (!w.except.includes(String(key))) store.delete(key);
                                        };
                                    } else if ("delete" in w) store.delete(w.key);
                                    else store.put(w.value, w.key);
                                }
                            } catch (error) {
                                refuse(error); // for example a value that cannot be cloned
                            }
                        };

                        const mustBeAbsent = [...(options.onlyIfAbsent ?? [])];
                        const checkNext = () => {
                            const key = mustBeAbsent.shift();
                            if (key === undefined) return apply();
                            const lookup = store.getKey(key);
                            lookup.onsuccess = () => (lookup.result === undefined ? checkNext() : refuse(new PreconditionFailedError(key)));
                        };
                        checkNext();
                    }),
            });
        };
    });
}
