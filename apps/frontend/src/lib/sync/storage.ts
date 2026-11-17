import type { SyncedStorage } from "@elumixor/synced/client";

const DB = "keep";
const STORE = "synced";

/**
 * The device's copy of the synced records, in IndexedDB: every page body of every workspace outgrows what
 * `localStorage` holds. IndexedDB only answers asynchronously, so everything is read into memory once (`preload`)
 * before the client hydrates, and `readSync` answers from there; writes go to both.
 */
export class IdbStorage implements SyncedStorage {
  readonly #memory = new Map<string, string>();
  #db: Promise<IDBDatabase | null> | null = null;

  #open() {
    this.#db ??= new Promise((resolve) => {
      try {
        const request = indexedDB.open(DB, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        // Private windows and blocked storage still get a working app, only without a copy on the device.
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return this.#db;
  }

  async #run<T>(mode: IDBTransactionMode, use: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
    const db = await this.#open();
    if (!db) return undefined;
    return new Promise((resolve) => {
      const request = use(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
    });
  }

  /** Reads every stored entry into memory. */
  async preload() {
    const db = await this.#open();
    if (!db) return;
    await new Promise<void>((resolve) => {
      const request = db.transaction(STORE).objectStore(STORE).openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return resolve();
        if (typeof cursor.value === "string") this.#memory.set(String(cursor.key), cursor.value);
        cursor.continue();
      };
      request.onerror = () => resolve();
    });
  }

  readSync(key: string) {
    return this.#memory.get(key) ?? null;
  }

  async read(key: string) {
    return this.readSync(key);
  }

  async write(key: string, value: string) {
    if (this.#memory.get(key) === value) return;
    this.#memory.set(key, value);
    await this.#run("readwrite", (store) => store.put(value, key));
  }

  async remove(key: string) {
    this.#memory.delete(key);
    await this.#run("readwrite", (store) => store.delete(key));
  }

  async keys() {
    return [...this.#memory.keys()];
  }
}
