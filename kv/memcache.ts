import type { KvKey } from "./types.ts";

const memoryCache = new Map<string, { data: unknown; expireAt: number }>();

const stringifyKey = (key: KvKey): string => JSON.stringify(key);

function fetchOrNull(key: KvKey): unknown {
  const strKey = stringifyKey(key);
  if (memoryCache.has(strKey)) {
    const { data, expireAt } = memoryCache.get(strKey)!;
    if (Date.now() < expireAt) {
      return data;
    } else {
      memoryCache.delete(strKey);
    }
  }
  return undefined;
}

async function fetchOrStore<T>(
  key: KvKey,
  getter: () => Promise<T>,
  expireIn: number,
): Promise<T | null> {
  const cache = fetchOrNull(key);
  if (cache !== undefined) {
    return cache as T;
  }
  const now = Date.now();
  const data = await getter();
  memoryCache.set(stringifyKey(key), { data, expireAt: now + expireIn });
  return data;
}

export function memcache(key: KvKey, expireIn: number = 5 * 1000) {
  const strKey = stringifyKey(key);
  return {
    get<T>(getter: () => Promise<T | null>) {
      return fetchOrStore(key, getter, expireIn);
    },
    set(data: unknown) {
      const now = Date.now();
      memoryCache.set(strKey, { data, expireAt: now + expireIn });
    },
    delete() {
      memoryCache.delete(strKey);
    },
  };
}
