import type { SessionData, SessionRepository } from "./types.ts";

export class DenoKvSessionRepository implements SessionRepository {
  constructor(private kv: Deno.Kv) {}

  async get(sessionKey: string): Promise<SessionData> {
    const result = await this.kv.get<SessionData>(this.kvKey(sessionKey));
    return result.value || {};
  }

  async update(
    sessionKey: string,
    updater: (current: SessionData | null) => SessionData | null,
  ): Promise<void> {
    const current = await this.get(sessionKey);
    const updated = updater(current);
    if (updated === null) {
      await this.kv.delete(this.kvKey(sessionKey));
    } else {
      const expireIn = 1000 * 60 * 60 * 24 * 7; // 7 days
      await this.kv.set(this.kvKey(sessionKey), updated, { expireIn });
    }
  }
  private kvKey(sessionKey: string): Deno.KvKey {
    return ["session", sessionKey];
  }
}
