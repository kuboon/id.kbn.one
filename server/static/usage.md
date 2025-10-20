# Cross-origin passkey usage guide

This guide explains how to call the passkey endpoints that run on this server
from applications that are hosted on a different subdomain of the same
registrable domain (for example, using `id.example.com` as the passkey server
and `app.example.com` as a relying party UI).

## Server prerequisites

The server already exposes WebAuthn and session management endpoints under the
`/webauthn` mount path. When you deploy to production, make sure the following
environment variables are set so cross-subdomain requests are accepted:

- `RP_ID`: set this to the registrable domain (e.g. `example.com`). The default
  is `id.kbn.one`, which is suitable only for local testing.
- `RP_NAME`: human-friendly name shown in authenticator prompts. This is
  optional for cross-origin usage but recommended.
- `ORIGINS`: comma-separated list of HTTPS origins that are allowed to talk to
  the passkey middleware. Include every subdomain that needs to perform passkey
  registration or authentication, such as `https://app.example.com`. The server
  publishes this list at `/.well-known/webauthn` so browsers can confirm the
  relationship between
  origins.【F:server/config.ts†L1-L14】【F:server/app.ts†L76-L85】

Deploy the passkey server on its own subdomain (for example,
`https://id.example.com`). All clients will talk to that origin and the browser
will store the `passkey_session` cookie there. Because the middleware marks the
cookie as `SameSite=Lax`, it will be sent when your client performs `fetch`
calls to that origin with `credentials: "include"`.

## Client integration from another subdomain

The `createClient` helper from `@passkeys-middleware/hono` is published from
this server. Import it over HTTPS and pass the public origin so requests are
sent to the correct host when you run on another subdomain.

```ts
import { createClient } from "https://id.kbn.one/webauthn/client.js";

const ID_ORIGIN = "https://id.example.com";

const client = createClient({ origin: ID_ORIGIN });
```

The library always passes relative paths, so the `origin` option is enough for
browsers and Fetch-capable runtimes. The middleware already sets
`credentials: "include"`, so cookies travel automatically.

With that client you can register and authenticate users from any approved
origin:

```ts
await client.register({ username: "alice" });
await client.authenticate({ username: "alice" });
```

To keep a local session in sync with the central server, poll the session
endpoint on the passkey server. This allows your UI to check if a user is
already signed in or to log them out.

```ts
const response = await fetch(`${ID_ORIGIN}/session`, {
  credentials: "include",
});
const session = await response.json();
```

When signing the user out, call the logout endpoint on the server and clear any
local state.

```ts
await fetch(`${ID_ORIGIN}/session/logout`, {
  method: "POST",
  credentials: "include",
});
```

If the user deletes their account through the central UI, they will lose all
registered passkeys. Your applications should listen for `404` or `401`
responses from authenticated endpoints and prompt the user to sign in again.

## Browser coordination

Modern browsers require a trust relationship between your subdomain and the
passkey server before they let WebAuthn flows succeed. The
`/.well-known/webauthn` endpoint advertises the related origins that you listed
in the `ORIGINS` environment variable. Call it once at startup to fail fast if
the current origin is missing from the list:

```ts
const metadata = await fetch(`${ID_ORIGIN}/.well-known/webauthn`).then(
  (res) => res.json(),
);
if (!metadata.origins.includes(window.location.origin)) {
  throw new Error("Current origin is not registered for passkey usage.");
}
```

This check is optional but makes debugging configuration issues easier,
especially for automated agents.

## Summary

1. Deploy the passkey server on a dedicated subdomain and configure `RP_ID`,
   `RP_NAME`, and `ORIGINS` to describe your environment.
2. In each client application, instantiate the `createClient` helper with the
   `origin` option pointing at the passkey server.
3. Use the `/session` and `/session/logout` endpoints to mirror authentication
   state locally.
4. Validate that your origin appears in `/.well-known/webauthn` so browsers
   accept the cross-subdomain WebAuthn flow.
