// deno-lint-ignore-file require-await
import type {
  KvEntryInterface,
  KvKey,
  KvKeyPart,
  KvOptions,
  KvRepo,
  KvUpdateResult,
} from "./types.ts";
import { monotonicUlid } from "@std/ulid";

type Entry<T> = { value: T; expireAt: number | null };

function keyToString(key: KvKey): string {
  return JSON.stringify(key);
}

export class MemoryKvRepo<T> implements KvRepo<T, KvKeyPart, KvOptions> {
  private store = new Map<string, Entry<T>>();

  constructor(public prefix: KvKey = [], public options: KvOptions = {}) {}

  genKey(): string {
    return monotonicUlid();
  }

  private fullKey(key: KvKeyPart): KvKey {
    return [...this.prefix, key];
  }

  private isExpired(entry: Entry<T>): boolean {
    return entry.expireAt !== null && Date.now() >= entry.expireAt;
  }

  entry<TEntryVal = T>(
    key: KvKeyPart,
  ): KvEntryInterface<TEntryVal, KvKeyPart, KvOptions> {
    const fullKey = this.fullKey(key);
    const strKey = keyToString(fullKey);
    const store = this.store;
    const isExpired = this.isExpired.bind(this);
    const repoOptions = this.options;

    return {
      key,
      fullKey,
      async get(): Promise<TEntryVal | null> {
        const entry = store.get(strKey);
        if (!entry || isExpired(entry)) {
          store.delete(strKey);
          return null;
        }
        return entry.value as unknown as TEntryVal;
      },
      async update(
        updater: (current: TEntryVal | null) => TEntryVal | null,
        opts: KvOptions = {},
      ): Promise<KvUpdateResult> {
        const entry = store.get(strKey);
        const current = entry && !isExpired(entry)
          ? entry.value as unknown as TEntryVal
          : null;
        const updated = updater(current);
        if (updated === null) {
          store.delete(strKey);
        } else {
          const expireIn = opts.expireIn ?? repoOptions.expireIn;
          store.set(strKey, {
            value: updated as unknown as T,
            expireAt: expireIn != null ? Date.now() + expireIn : null,
          });
        }
        return { ok: true };
      },
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<
    KvEntryInterface<T, KvKeyPart, KvOptions>
  > {
    for await (const key of this.store.keys()) {
      const kvEntry = this.entry(JSON.parse(key).pop()!);
      yield kvEntry;
    }
  }
}
