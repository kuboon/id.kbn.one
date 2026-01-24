import { getKvInstance } from "./kvInstance.ts";

const SecretKeys = ["signing_key", "push_vapid_keys"] as const;

export const Secret = async <T>(
  key: typeof SecretKeys[number],
  generator: () => T | Promise<T>,
  expireIn?: number, // in milliseconds
) => {
  const kv = await getKvInstance();
  const kvKey = ["secret", key] as const;
  const stored = await kv.get<T>(kvKey);
  if (!stored.value) {
    console.info(`Generating new secret for: ${key}`);
    const newSecret = await generator();
    await kv.set(kvKey, newSecret, { expireIn });
  }
  return {
    async get(): Promise<T> {
      const stored = await kv.get<T>(kvKey);
      if (stored.value) {
        return stored.value;
      }
      throw new Error(`Secret ${key} not found`);
    },
  };
};
