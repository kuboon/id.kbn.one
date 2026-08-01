/**
 * Pluggable persistence for the client's DPoP key pair.
 *
 * Keys should be **non-extractable** whenever possible so they cannot be
 * exfiltrated from the browser — `init()` creates them that way by default.
 * That means the underlying key material cannot be serialized; the key pair
 * must be stored as-is by a backend that accepts `CryptoKey` objects (such as
 * IndexedDB), not encoded via `exportKey`.
 *
 * @module
 */

/** A storage backend for a single `CryptoKeyPair`. */
export interface KeyRepository {
  /** Returns the stored key pair, or `undefined` if nothing is stored yet. */
  getKeyPair(): Promise<CryptoKeyPair | undefined>;
  /** Persist a key pair, overwriting any previous value. */
  saveKeyPair(keyPair: CryptoKeyPair): Promise<void>;
  /**
   * Atomically return the stored key pair, or persist and return the result of
   * `generate()` if none exists yet. Concurrency-safe: when several callers
   * race (e.g. parallel `init()` calls in different bundles or tabs), they all
   * converge on a single key — the losers discard their freshly generated
   * candidate and adopt the winner's.
   *
   * Required, because a non-atomic get→create can leave parallel callers
   * holding different keys; `init()` throws if a store omits it.
   */
  getOrCreateKeyPair(
    generate: () => Promise<CryptoKeyPair>,
  ): Promise<CryptoKeyPair>;
}

/**
 * Non-persistent in-memory implementation — intended for tests and
 * non-browser runtimes where you don't need keys to survive a restart.
 */
export class InMemoryKeyRepository implements KeyRepository {
  private store = new Map<string, CryptoKeyPair>();
  private creating?: Promise<CryptoKeyPair>;

  getKeyPair(): Promise<CryptoKeyPair | undefined> {
    return Promise.resolve(this.store.get("default"));
  }

  saveKeyPair(keyPair: CryptoKeyPair): Promise<void> {
    this.store.set("default", keyPair);
    return Promise.resolve();
  }

  getOrCreateKeyPair(
    generate: () => Promise<CryptoKeyPair>,
  ): Promise<CryptoKeyPair> {
    const existing = this.store.get("default");
    if (existing) return Promise.resolve(existing);
    // Share a single in-flight generation so concurrent callers converge.
    this.creating ??= generate().then((keyPair) => {
      this.store.set("default", keyPair);
      return keyPair;
    });
    return this.creating;
  }
}

/**
 * Browser-only. Persists the key pair in an IndexedDB database named
 * `dpop-keys-v1`, object store `keys`, under the key `"default"`.
 *
 * Works with non-extractable keys because IndexedDB can store `CryptoKey`
 * objects natively (the structured-clone algorithm is used).
 */
export class IndexedDbKeyRepository implements KeyRepository {
  private dbName = "dpop-keys-v1";

  private openDb() {
    const req = indexedDB.open(this.dbName, 1);
    return new Promise<IDBDatabase>((resolve, reject) => {
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("keys")) {
          db.createObjectStore("keys");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async getKeyPair(): Promise<CryptoKeyPair | undefined> {
    const db = await this.openDb();
    const tx = db.transaction("keys", "readonly");
    const store = tx.objectStore("keys");
    const req = store.get("default");
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async saveKeyPair(keyPair: CryptoKeyPair): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction("keys", "readwrite");
    const store = tx.objectStore("keys");
    const req = store.put(keyPair, "default");
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  async getOrCreateKeyPair(
    generate: () => Promise<CryptoKeyPair>,
  ): Promise<CryptoKeyPair> {
    const existing = await this.getKeyPair();
    if (existing) return existing;

    // Generate BEFORE opening the transaction: an IndexedDB transaction
    // auto-commits once the microtask queue drains with no pending request, so
    // awaiting a non-IDB promise mid-transaction would kill it. Inside the tx
    // we only chain synchronous IDB requests (get → put).
    const candidate = await generate();
    const db = await this.openDb();
    return new Promise<CryptoKeyPair>((resolve, reject) => {
      const tx = db.transaction("keys", "readwrite");
      const store = tx.objectStore("keys");
      const get = store.get("default");
      get.onsuccess = () => {
        const current = get.result as CryptoKeyPair | undefined;
        if (current) {
          resolve(current); // lost the race — adopt the winner's key
          return;
        }
        const put = store.put(candidate, "default");
        put.onsuccess = () => resolve(candidate);
        put.onerror = () => reject(put.error);
      };
      get.onerror = () => reject(get.error);
    });
  }
}
