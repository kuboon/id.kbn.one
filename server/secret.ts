import { getKvInstance } from "./kvInstance.ts";

const SecretKeys = ["signing_key", "push_vapid_keys"] as const;

export const Secret = async <T>(
  key: typeof SecretKeys[number],
  generator: () => T | Promise<T>,
  expireIn?: number,
) => {
  const kv = await getKvInstance();
  const stored = await kv.get<T>(["secret", key]);
  if (!stored.value) {
    console.info(`Generating new secret for: ${key}`);
    const newSecret = await generator();
    await kv.set(["secret", key], newSecret, { expireIn });
  }
  return {
    async get(): Promise<T> {
      const stored = await kv.get<T>(["secret", key]);
      if (stored.value) {
        return stored.value;
      }
      throw new Error(`Secret ${key} not found`);
    },
  };
};
