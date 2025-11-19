import { assert, assertEquals } from "@std/assert";
import { SessionManager } from "./session-manager.ts";

const createTestKv = async (): Promise<Deno.Kv> => {
  return await Deno.openKv(":memory:");
};

Deno.test("SessionManager - create and get session", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({ kv });

  const userId = "user123";
  const session = await manager.createSession(userId);

  assertEquals(session.userId, userId);
  assert(session.id);
  assert(session.createdAt > 0);
  assert(session.expiresAt > session.createdAt);
  assertEquals(session.lastAccessedAt, session.createdAt);

  const retrieved = await manager.getSession(session.id);
  assert(retrieved);
  assertEquals(retrieved.id, session.id);
  assertEquals(retrieved.userId, userId);

  kv.close();
});

Deno.test("SessionManager - get non-existent session returns null", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({ kv });

  const session = await manager.getSession("non-existent-id");
  assertEquals(session, null);

  kv.close();
});

Deno.test("SessionManager - refresh session updates lastAccessedAt", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({ kv });

  const userId = "user123";
  const session = await manager.createSession(userId);
  const originalAccessTime = session.lastAccessedAt;

  await new Promise((resolve) => setTimeout(resolve, 10));

  const refreshed = await manager.refreshSession(session.id);
  assert(refreshed);
  assert(refreshed.lastAccessedAt > originalAccessTime);
  assertEquals(refreshed.userId, userId);

  kv.close();
});

Deno.test("SessionManager - delete session removes it", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({ kv });

  const userId = "user123";
  const session = await manager.createSession(userId);

  await manager.deleteSession(session.id);

  const retrieved = await manager.getSession(session.id);
  assertEquals(retrieved, null);

  kv.close();
});

Deno.test("SessionManager - delete all user sessions", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({ kv });

  const userId = "user123";
  const session1 = await manager.createSession(userId);
  const session2 = await manager.createSession(userId);

  await manager.deleteUserSessions(userId);

  const retrieved1 = await manager.getSession(session1.id);
  const retrieved2 = await manager.getSession(session2.id);

  assertEquals(retrieved1, null);
  assertEquals(retrieved2, null);

  kv.close();
});

Deno.test("SessionManager - get user sessions", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({ kv });

  const userId = "user123";
  const session1 = await manager.createSession(userId);
  const session2 = await manager.createSession(userId);

  const sessions = await manager.getUserSessions(userId);
  assertEquals(sessions.length, 2);

  const sessionIds = sessions.map((s) => s.id).sort();
  const expectedIds = [session1.id, session2.id].sort();
  assertEquals(sessionIds, expectedIds);

  kv.close();
});

Deno.test("SessionManager - expired session returns null", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({
    kv,
    sessionDuration: 100,
  });

  const userId = "user123";
  const session = await manager.createSession(userId);

  await new Promise((resolve) => setTimeout(resolve, 150));

  const retrieved = await manager.getSession(session.id);
  assertEquals(retrieved, null);

  kv.close();
});

Deno.test("SessionManager - cleanup expired sessions", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({
    kv,
    sessionDuration: 100,
  });

  const userId1 = "user123";
  const userId2 = "user456";
  const session1 = await manager.createSession(userId1);
  await manager.createSession(userId2);

  await new Promise((resolve) => setTimeout(resolve, 150));

  const session3 = await manager.createSession("user789");

  const cleanedCount = await manager.cleanupExpiredSessions();
  assertEquals(cleanedCount, 2);

  const retrieved1 = await manager.getSession(session1.id);
  assertEquals(retrieved1, null);

  const retrieved3 = await manager.getSession(session3.id);
  assert(retrieved3);

  kv.close();
});

Deno.test("SessionManager - inactive session is removed", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({
    kv,
    sessionDuration: 10000,
    inactivityTimeout: 100,
  });

  const userId = "user123";
  const session = await manager.createSession(userId);

  await new Promise((resolve) => setTimeout(resolve, 150));

  const retrieved = await manager.getSession(session.id);
  assertEquals(retrieved, null);

  kv.close();
});

Deno.test("SessionManager - refresh extends session expiration", async () => {
  const kv = await createTestKv();
  const manager = new SessionManager({
    kv,
    sessionDuration: 1000,
  });

  const userId = "user123";
  const session = await manager.createSession(userId);
  const originalExpiresAt = session.expiresAt;

  await new Promise((resolve) => setTimeout(resolve, 50));

  const refreshed = await manager.refreshSession(session.id);
  assert(refreshed);
  assert(refreshed.expiresAt > originalExpiresAt);

  kv.close();
});
