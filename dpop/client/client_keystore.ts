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
}

/**
 * Non-persistent in-memory implementation — intended for tests and
 * non-browser runtimes where you don't need keys to survive a restart.
 */
export class InMemoryKeyRepository implements KeyRepository {
  private store = new Map<string, CryptoKeyPair>();

  getKeyPair(): Promise<CryptoKeyPair | undefined> {
    return Promise.resolve(this.store.get("default"));
  }

  saveKeyPair(keyPair: CryptoKeyPair): Promise<void> {
    this.store.set("default", keyPair);
    return Promise.resolve();
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
}
