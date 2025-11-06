# Session Manager

A robust session management system for the ID provider, built on Deno KV.

## Features

- **Session lifecycle management**: Create, retrieve, refresh, and delete
  sessions
- **User session management**: Manage all sessions for a specific user
- **Automatic expiration**: Sessions expire based on both absolute duration and
  inactivity timeout
- **Cleanup utilities**: Efficiently clean up expired sessions
- **Deno KV-backed**: Uses Deno KV for persistent, distributed session storage
  with automatic TTL

## Usage

### Basic Setup

```typescript
import { SessionManager } from "./session-manager.ts";
import { getKvInstance } from "./kvInstance.ts";

const kv = await getKvInstance();
const sessionManager = new SessionManager({
  kv,
  sessionDuration: 7 * 24 * 60 * 60 * 1000, // 7 days
  inactivityTimeout: 30 * 24 * 60 * 60 * 1000, // 30 days
});
```

### Creating a Session

```typescript
const session = await sessionManager.createSession(userId);
console.log(session.id); // Session ID
console.log(session.expiresAt); // Expiration timestamp
```

### Retrieving a Session

```typescript
const session = await sessionManager.getSession(sessionId);
if (session) {
  console.log(`Session for user ${session.userId}`);
} else {
  console.log("Session not found or expired");
}
```

### Refreshing a Session

Refreshing a session updates the last accessed time and extends the expiration:

```typescript
const refreshedSession = await sessionManager.refreshSession(sessionId);
```

### Deleting Sessions

Delete a specific session:

```typescript
await sessionManager.deleteSession(sessionId);
```

Delete all sessions for a user (e.g., logout from all devices):

```typescript
await sessionManager.deleteUserSessions(userId);
```

### Getting All User Sessions

```typescript
const sessions = await sessionManager.getUserSessions(userId);
console.log(`User has ${sessions.length} active sessions`);
```

### Cleanup Expired Sessions

Run periodic cleanup to remove expired sessions:

```typescript
const cleanedCount = await sessionManager.cleanupExpiredSessions();
console.log(`Cleaned up ${cleanedCount} expired sessions`);
```

## Configuration Options

### `SessionManagerOptions`

- **`kv`** (required): Deno KV instance for storage
- **`sessionDuration`** (optional): Maximum session lifetime in milliseconds
  (default: 7 days)
- **`inactivityTimeout`** (optional): Maximum inactivity period in milliseconds
  (default: 30 days)

## Session Interface

```typescript
interface Session {
  id: string; // Unique session identifier
  userId: string; // User ID associated with this session
  createdAt: number; // Session creation timestamp
  expiresAt: number; // Session expiration timestamp
  lastAccessedAt: number; // Last access timestamp
}
```

## Integration Example

See `session-manager-integration-example.ts` for a complete example of
integrating the session manager with your application, including:

- API endpoints for session management
- Session cleanup background job
- User session listing and deletion

## Testing

The session manager includes comprehensive tests covering:

- Session creation and retrieval
- Session refresh and expiration
- User session management
- Cleanup operations
- Inactivity timeout handling

Run tests with:

```bash
deno test server/session-manager.test.ts
```

## Storage Schema

The session manager uses the following Deno KV key patterns:

- `["sessions", sessionId]`: Stores session data
- `["sessions_by_user", userId, sessionId]`: Indexes sessions by user ID

Both key types include automatic TTL based on the configured session duration.
