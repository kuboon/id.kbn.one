import { memcache } from "./memcache.ts";
import type {
  KvEntryInterface,
  KvKey,
  KvKeyPart,
  KvOptions,
  KvRepo,
  KvUpdateResult,
} from "./types.ts";
import { monotonicUlid } from "@std/ulid";

let kvPromise: Promise<Deno.Kv> | undefined;
export const getKvInstance = (): Promise<Deno.Kv> => {
  if (!kvPromise) {
    kvPromise = Deno.openKv();
  }
  return kvPromise;
};

export const test = {
  overwriteKvPromise: (kvP: Promise<Deno.Kv>) => {
    kvPromise = kvP;
  },
};

export class DenoKvRepo<TVal> implements KvRepo<TVal, KvKeyPart, KvOptions> {
  constructor(
    public prefix: KvKey = [],
    public options: KvOptions = {},
    private readonly kvProvider: () => Promise<Deno.Kv> = getKvInstance,
  ) {}

  genKey(): string {
    return monotonicUlid();
  }

  entry<TEntryVal = TVal>(
    key: KvKeyPart,
  ): KvEntryInterface<TEntryVal, KvKeyPart, KvOptions> {
    const fullKey = [...this.prefix, key];
    const repoOptions = this.options;
    const provider = this.kvProvider;
    return {
      key,
      fullKey,
      async get(): Promise<TEntryVal | null> {
        return await memcache(fullKey).get(async () => {
          const kv = await provider();
          return kv.get<TEntryVal>(fullKey).then((x) => x.value);
        });
      },
      async update(
        updater: (current: TEntryVal | null) => TEntryVal | null,
        opts: KvOptions = {},
      ): Promise<KvUpdateResult> {
        const kv = await provider();
        const current = await kv.get<TEntryVal>(fullKey);
        const updated = updater(current.value);
        const atomic = kv.atomic().check(current);
        const cache = memcache(fullKey);
        if (updated === null) {
          cache.delete();
          const result = await atomic.delete(fullKey).commit();
          return { ok: result.ok };
        }
        cache.set(updated);
        const expireIn = opts.expireIn ?? repoOptions.expireIn;
        const setOpts = expireIn != null ? { expireIn } : undefined;
        const result = await atomic.set(fullKey, updated, setOpts).commit();
        return { ok: result.ok };
      },
    };
  }

  async *[Symbol.asyncIterator](): AsyncIterableIterator<
    KvEntryInterface<TVal, KvKeyPart, KvOptions>
  > {
    const kv = await this.kvProvider();
    const list = kv.list({ prefix: this.prefix });
    for await (const entry of list) {
      const fullKey = entry.key as KvKey;
      const key = fullKey.slice(this.prefix.length)[0];
      yield this.entry<TVal>(key);
    }
  }
}
