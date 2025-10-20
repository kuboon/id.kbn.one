# Relying party guide for id.kbn.one

This document explains how to integrate your application as a relying party with
the passkey endpoints hosted at `https://id.kbn.one`. The service exposes
WebAuthn registration and authentication flows together with session management
APIs so that a single passkey server can serve multiple subdomains.

## Getting the client helper

Import the prebuilt `createClient` helper from the hosted origin. The bundle
already knows the passkey server domain through its configuration (`config.rpID`
is set to `id.kbn.one`), so you can instantiate it without additional options.

```ts
import { createClient } from "https://id.kbn.one/webauthn/client.js";

const PASSKEY_ORIGIN = "https://id.kbn.one";
const client = createClient();
```

Use the client to trigger WebAuthn flows from your RP UI. All requests are
performed against `https://id.kbn.one`, so make sure your fetch calls use
`credentials: "include"` when you talk to that origin directly or when you call
the endpoints yourself.

```ts
await client.register({ username: "alice" });
await client.authenticate({ username: "alice" });
```

## Session coordination

Relying parties can stay in sync with the central passkey session by calling the
provided endpoints. Use them to populate local state, detect logout events, and
clear credentials.

```ts
const response = await fetch(`${PASSKEY_ORIGIN}/session`, {
  credentials: "include",
});
const session = await response.json();
```

Log users out through the shared session endpoint and handle any local cleanup
in your application.

```ts
await fetch(`${PASSKEY_ORIGIN}/session/logout`, {
  method: "POST",
  credentials: "include",
});
```

If a user deletes their account centrally, subsequent authenticated requests may
return `401` or `404`. Treat these responses as a signal to prompt the user to
sign in again.
