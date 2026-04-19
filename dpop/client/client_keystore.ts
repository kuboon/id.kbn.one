export interface KeyRepository {
  getKeyPair(): Promise<CryptoKeyPair | undefined>;
  saveKeyPair(keyPair: CryptoKeyPair): Promise<void>;
}

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

// Browser-only IndexedDB
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
