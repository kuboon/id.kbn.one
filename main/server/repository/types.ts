export interface SessionData {
  userId?: string;
  [key: string]: unknown;
}

export interface SessionRepository {
  get(thumbprint: string): Promise<SessionData>;
  update(
    thumbprint: string,
    updater: (current: SessionData | null) => SessionData | null,
  ): Promise<void>;
}
