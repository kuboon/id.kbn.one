import type { SessionData, SessionRepository } from "./types.ts";

export class DenoKvSessionRepository implements SessionRepository {
  constructor(private kv: Deno.Kv) {}

  async get(thumbprint: string): Promise<SessionData> {
    const result = await this.kv.get<SessionData>(this.kvKey(thumbprint));
    return result.value || {};
  }

  async update(
    thumbprint: string,
    updater: (current: SessionData | null) => SessionData | null,
  ): Promise<void> {
    const current = await this.get(thumbprint);
    const updated = updater(current);
    if (updated === null) {
      await this.kv.delete(this.kvKey(thumbprint));
    } else {
      const expireIn = 1000 * 60 * 60 * 24 * 7; // 7 days
      await this.kv.set(this.kvKey(thumbprint), updated, { expireIn });
    }
  }
  private kvKey(thumbprint: string): Deno.KvKey {
    return ["session", thumbprint];
  }
}
