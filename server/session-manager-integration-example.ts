/**
 * Example: Integrating SessionManager with the application
 *
 * This file demonstrates how to integrate the SessionManager into app.ts
 * to provide enhanced session management capabilities.
 */

import { SessionManager } from "./session-manager.ts";
import { getKvInstance } from "./kvInstance.ts";
import { Hono } from "hono";

// Initialize session manager
const kv = await getKvInstance();
const sessionManager = new SessionManager({
  kv,
  sessionDuration: 30 * 24 * 60 * 60 * 1000, // 30 days
  inactivityTimeout: 7 * 24 * 60 * 60 * 1000, // 7 days
});

const app = new Hono();

// Example: Get current user sessions
app.get("/api/sessions", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const sessions = await sessionManager.getUserSessions(user.id);
  return c.json({ sessions });
});

// Example: Delete a specific session
app.delete("/api/sessions/:sessionId", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const sessionId = c.req.param("sessionId");
  const session = await sessionManager.getSession(sessionId);

  if (!session || session.userId !== user.id) {
    return c.json({ error: "Session not found" }, 404);
  }

  await sessionManager.deleteSession(sessionId);
  return c.json({ success: true });
});

// Example: Delete all sessions for current user (logout from all devices)
app.post("/api/logout-all", async (c) => {
  const user = c.get("user");
  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  await sessionManager.deleteUserSessions(user.id);
  return c.json({ success: true });
});

// Example: Background job to cleanup expired sessions
const cleanupExpiredSessions = async () => {
  try {
    const count = await sessionManager.cleanupExpiredSessions();
    console.log(`Cleaned up ${count} expired sessions`);
  } catch (error) {
    console.error("Error cleaning up sessions:", error);
  }
};

// Run cleanup every hour
setInterval(cleanupExpiredSessions, 60 * 60 * 1000);

export { app, sessionManager };
