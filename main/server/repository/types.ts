export interface SessionData {
  userId?: string;
  [key: string]: unknown;
}

export interface SessionRepository {
  get(sessionKey: string): Promise<SessionData>;
  update(
    sessionKey: string,
    updater: (current: SessionData | null) => SessionData | null,
  ): Promise<void>;
}
