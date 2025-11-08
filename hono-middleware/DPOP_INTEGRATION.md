# DPoP Integration Example

This document provides examples of how to use the DPoP integration with passkeys authentication.

## Overview

DPoP (Demonstrating Proof-of-Possession) adds an additional layer of security by binding authentication sessions to a cryptographic key pair. This prevents token theft and replay attacks by requiring the client to prove possession of the private key for each request.

DPoP is always enabled in the passkeys middleware.

## Basic Client Usage

### Using DPoP with the client

```html
<script type="module">
  import { createClient } from "/webauthn/client.js";

  // Create client (DPoP is always enabled)
  const client = createClient();
  
  // Initialize DPoP key pair
  await client.initDpop();

  // Register with DPoP
  const result = await client.register({ username: "alice" });
  console.log("Registration successful:", result);

  // Authenticate with DPoP
  const authResult = await client.authenticate({ username: "alice" });
  console.log("Authentication successful:", authResult);
</script>
```

### Manual DPoP Proof Generation

```javascript
import {
  generateDpopKeyPair,
  createDpopProof,
} from "/webauthn/client.js";

// Generate a DPoP key pair
const keyPair = await generateDpopKeyPair();

// Create a DPoP proof for a request
const proof = await createDpopProof({
  keyPair,
  method: "POST",
  url: "https://example.com/api/protected-resource",
});

// Make request with DPoP header
const response = await fetch("/api/protected-resource", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "DPoP": proof,
  },
  credentials: "include",
  body: JSON.stringify({ data: "value" }),
});
```

## Server-Side Usage

### Accessing DPoP Information

```typescript
import { Hono } from "hono";

const app = new Hono();

// Protected endpoint that requires DPoP
app.get("/api/protected", (c) => {
  const user = c.get("user");
  const dpopJwk = c.get("dpopJwk");

  if (!user) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  if (dpopJwk) {
    // Session is DPoP-bound
    console.log("Request verified with DPoP key:", dpopJwk);
    return c.json({
      message: "Protected resource with DPoP",
      user,
      dpopBound: true,
    });
  } else {
    // Regular session without DPoP
    return c.json({
      message: "Protected resource",
      user,
      dpopBound: false,
    });
  }
});
```

### Enforcing DPoP for Specific Endpoints

```typescript
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

const app = new Hono();

// Middleware to require DPoP
const requireDpop = async (c, next) => {
  const dpopJwk = c.get("dpopJwk");
  if (!dpopJwk) {
    throw new HTTPException(403, {
      message: "DPoP proof required for this endpoint",
    });
  }
  await next();
};

// Endpoint that requires DPoP
app.get("/api/high-security", requireDpop, (c) => {
  const user = c.get("user");
  return c.json({
    message: "High security resource",
    user,
  });
});
```

## How It Works

1. **Client Registration/Authentication:**
   - Client generates a DPoP key pair (ECDSA P-256)
   - Client creates a DPoP proof JWT signed with the private key
   - Client includes the proof in the `dpopProof` field of the request body
   - Server verifies the proof and extracts the public key (JWK)
   - Server stores the JWK in the session data

2. **Subsequent Requests:**
   - Client creates a new DPoP proof for each request
   - Client includes the proof in the `DPoP` HTTP header
   - Server verifies the proof matches the stored JWK
   - Server sets `c.get('dpopJwk')` if verification succeeds

3. **Security Benefits:**
   - Even if a session cookie is stolen, the attacker cannot use it without the private key
   - Each request includes a fresh proof with timestamp, preventing replay attacks
   - The `htm` (HTTP method) and `htu` (HTTP URI) claims bind the proof to specific requests

## Demo UI

The demo UI at `/` automatically initializes DPoP when the page loads:

```javascript
const client = createClient();
await client.initDpop();
```

When checked, the client automatically generates DPoP proofs for all authentication operations.

## Testing

Run the integration tests:

```bash
cd hono-middleware
deno test src/dpop-integration.test.ts
```

## Additional Resources

- [RFC 9449 - OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://datatracker.ietf.org/doc/html/rfc9449)
- [DPoP Module Documentation](../dpop/mod.ts)
- [Passkeys Middleware Documentation](./README.md)
