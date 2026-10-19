import { secretRepo } from "./repositories.ts";

const SecretKeys = ["signing_key"] as const;

export const Secret = async <T>(
  key: typeof SecretKeys[number],
  generator: () => T | Promise<T>,
  expireIn?: number, // in milliseconds
) => {
  const entry = secretRepo.entry<T>(key);
  if (!await entry.get()) {
    console.info(`Generating new secret for: ${key}`);
    const newSecret = await generator();
    // `current ?? newSecret` keeps the first writer's value: two instances
    // starting at once must not end up signing with different keys.
    await entry.update((current) => current ?? newSecret, { expireIn });
  }
  return {
    async get(): Promise<T> {
      const stored = await entry.get();
      if (stored) return stored;
      throw new Error(`Secret ${key} not found`);
    },
  };
};
