import type { KeyValueStore, Write } from "./store.ts";

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

            resolve({
                get: (key) => done(db.transaction(STORE, "readonly").objectStore(STORE).get(key)),

                keys: async (prefix) => {
                    // "￿" sorts after every character a key can continue with.
                    const range = IDBKeyRange.bound(prefix, prefix + "￿");
                    const keys = await done(db.transaction(STORE, "readonly").objectStore(STORE).getAllKeys(range));
                    return keys.map(String).sort();
                },

                commit: (writes: Write[]) =>
                    new Promise<void>((res, rej) => {
                        const tx = db.transaction(STORE, "readwrite");
                        tx.oncomplete = () => res();
                        tx.onerror = () => rej(tx.error ?? new Error("indexeddb_write_failed"));
                        tx.onabort = () => rej(tx.error ?? new Error("indexeddb_write_aborted"));
                        const store = tx.objectStore(STORE);
                        try {
                            for (const w of writes) {
                                if ("delete" in w) store.delete(w.key);
                                else store.put(w.value, w.key);
                            }
                        } catch (error) {
                            tx.abort();
                            rej(error);
                        }
                    }),
            });
        };
    });
}
