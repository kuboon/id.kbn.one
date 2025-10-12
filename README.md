# Passkeys and DPoP utilities monorepo

This repository contains three cooperating modules demonstrating Deno-first
implementations for passkeys (WebAuthn) and DPoP utilities:

- `hono-middleware/` — a reusable Hono middleware that exposes WebAuthn
  registration and authentication endpoints and serves a bundled `client.js`.
- `server/` — a small demo Hono server that mounts the middleware (defaults to
  `/webauthn`) and provides a minimal UI under `server/static/` for trying
  registration and authentication flows locally.
- `dpop/` — utilities for generating and verifying DPoP proofs (create/verify
  DPoP JWTs). Useful when building OAuth flows that require DPoP-bound access
  tokens.

## Project layout

```
/
├─ dpop/               # DPoP key + proof helpers
├─ hono-middleware/    # Passkeys / WebAuthn middleware for Hono
└─ server/             # Demo server that uses the middleware and static UI
```

## Quick start — run the demo server

This workspace is configured for Deno. The project includes a `mise` helper in
`AGENTS.md` for consistent tool versions, but Deno can be invoked directly if
you have a compatible version installed.

Recommended (uses mise if available):

```bash
# from repository root
mise exec -- deno task -C server dev
```

Or, without mise:

```bash
cd server
deno task dev
```

The demo server listens on http://localhost:8000. You can override relying-party
values with environment variables when needed:

- `RP_ID` (relying party id)
- `RP_NAME` (relying party display name)
- `RP_ORIGIN` (origin used when running behind a proxy)

Open the browser at http://localhost:8000 to try registering and authenticating
passkeys using the UI in `server/static/index.html`.

## Development & checks

Run formatting, linting and tests as recommended in `AGENTS.md`:

```bash
mise exec -- deno fmt && mise exec -- deno lint && mise exec -- deno test -C . -P
```

You can also run module-local tasks. Examples:

```bash
cd server
mise exec -- deno task dev

cd hono-middleware
mise exec -- deno task check
```

Notes:

- The `hono-middleware` package includes an `InMemoryPasskeyStore` intended for
  local development only. Replace it with a persistent storage implementation
  for production.
- `dpop/` exports `createDpopProof` and `verifyDpopProof` helpers for working
  with DPoP-bound access tokens.

If you'd like, I can also add a short example showing how to call
`dpop/createDpopProof` from the demo UI.
