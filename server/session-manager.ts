const DEFAULT_SESSION_DURATION = 30 * 24 * 60 * 60 * 1000; // 30 days
const DEFAULT_INACTIVITY_TIMEOUT = 7 * 24 * 60 * 60 * 1000; // 7 days

export interface Session {
  id: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
  lastAccessedAt: number;
}

export interface SessionManagerOptions {
  kv: Deno.Kv;
  sessionDuration?: number;
  inactivityTimeout?: number;
}

export class SessionManager {
  private kv: Deno.Kv;
  private sessionDuration: number;
  private inactivityTimeout: number;

  constructor(options: SessionManagerOptions) {
    this.kv = options.kv;
    this.sessionDuration = options.sessionDuration ?? DEFAULT_SESSION_DURATION;
    this.inactivityTimeout = options.inactivityTimeout ??
      DEFAULT_INACTIVITY_TIMEOUT;
  }

  async createSession(userId: string): Promise<Session> {
    const sessionId = crypto.randomUUID();
    const now = Date.now();
    const session: Session = {
      id: sessionId,
      userId,
      createdAt: now,
      expiresAt: now + this.sessionDuration,
      lastAccessedAt: now,
    };

    await this.kv.set(["sessions", sessionId], session, {
      expireIn: this.sessionDuration,
    });
    await this.kv.set(["sessions_by_user", userId, sessionId], sessionId, {
      expireIn: this.sessionDuration,
    });

    return session;
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const result = await this.kv.get<Session>(["sessions", sessionId]);
    if (!result.value) {
      return null;
    }

    const session = result.value;
    const now = Date.now();

    // Check absolute expiration
    if (now > session.expiresAt) {
      await this.deleteSession(sessionId);
      return null;
    }

    // Check inactivity timeout (KV TTL handles absolute expiration)
    if (now - session.lastAccessedAt > this.inactivityTimeout) {
      await this.deleteSession(sessionId);
      return null;
    }

    return session;
  }

  async refreshSession(sessionId: string): Promise<Session | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    const now = Date.now();
    const refreshedSession: Session = {
      ...session,
      lastAccessedAt: now,
      expiresAt: now + this.sessionDuration,
    };

    await this.kv.set(["sessions", sessionId], refreshedSession, {
      expireIn: this.sessionDuration,
    });
    await this.kv.set(
      ["sessions_by_user", refreshedSession.userId, sessionId],
      sessionId,
      {
        expireIn: this.sessionDuration,
      },
    );

    return refreshedSession;
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.kv.get<Session>(["sessions", sessionId]);
    if (session.value) {
      await this.kv.delete([
        "sessions_by_user",
        session.value.userId,
        sessionId,
      ]);
    }
    await this.kv.delete(["sessions", sessionId]);
  }

  async deleteUserSessions(userId: string): Promise<void> {
    const sessions = this.kv.list<string>({
      prefix: ["sessions_by_user", userId],
    });
    for await (const entry of sessions) {
      const sessionId = entry.value;
      await this.kv.delete(["sessions", sessionId]);
      await this.kv.delete(entry.key);
    }
  }

  async getUserSessions(userId: string): Promise<Session[]> {
    const sessionIds = this.kv.list<string>({
      prefix: ["sessions_by_user", userId],
    });
    const sessions: Session[] = [];

    for await (const entry of sessionIds) {
      const sessionId = entry.value;
      const session = await this.getSession(sessionId);
      if (session) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  async cleanupExpiredSessions(): Promise<number> {
    const sessions = this.kv.list<Session>({ prefix: ["sessions"] });
    let cleanedCount = 0;
    const now = Date.now();

    for await (const entry of sessions) {
      const session = entry.value;
      // Check absolute expiration or inactivity timeout
      if (now > session.expiresAt || now - session.lastAccessedAt > this.inactivityTimeout) {
        await this.deleteSession(session.id);
        cleanedCount++;
      }
    }

    return cleanedCount;
  }
}
