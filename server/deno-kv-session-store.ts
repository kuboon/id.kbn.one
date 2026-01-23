export interface SessionData {
  [key: string]: unknown;
}

export class DenoKvSessionRepository {
  constructor(private kv: Deno.Kv) {}

  async get(sessionKey: string): Promise<SessionData | null> {
    const result = await this.kv.get<SessionData>(["session", sessionKey]);
    return result.value;
  }

  async set(
    sessionKey: string,
    data: SessionData,
    expiresIn?: number,
  ): Promise<void> {
    const options = expiresIn ? { expireIn: expiresIn } : undefined;
    await this.kv.set(["session", sessionKey], data, options);
  }

  async delete(sessionKey: string): Promise<void> {
    await this.kv.delete(["session", sessionKey]);
  }

  async update(
    sessionKey: string,
    updater: (current: SessionData | null) => SessionData | null,
  ): Promise<void> {
    const current = await this.get(sessionKey);
    const updated = updater(current);
    if (updated === null) {
      await this.delete(sessionKey);
    } else {
      await this.set(sessionKey, updated);
    }
  }
}
