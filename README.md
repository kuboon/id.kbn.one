# Passkeys and WebPush ready ID provider

[![Deploy on Deno](https://deno.com/button)](https://console.deno.com/new?clone=kuboon/id.kbn.one)

## Prerequisites

Install deno

```sh
curl -fsSL https://deno.land/install.sh | sh
```

via mise

```sh
curl https://mise.run | sh
mise use -g deno
```

## Environment variables

for more details, see `server/config.ts`.

- `RP_ID` (relying party id, e.g. `localhost`)
- `RP_NAME` (relying party display name, e.g. `My ID Provider`)
- `RP_ORIGIN` (origin used when running behind a proxy, e.g.
  `http://localhost:8000`)
- `IDP_ORIGIN` (the origin of the ID provider, e.g. `http://localhost:8000`)
- `ORIGINS` (a comma-separated list of allowed origins for Passkeys & CORS, e.g.
  `http://localhost:8000,http://example.com`)

## Project layout

```
/
├─ dpop/               # DPoP key + proof helpers
├─ passkeys/    # Passkeys / WebAuthn middleware for Hono
└─ server/             # ID provider server
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
deno fmt && deno lint && deno test -C . -P
```

You can also run module-local tasks. Examples:

```bash
deno task --cwd server dev
```

Notes:

- The `@scope/passkeys` package includes an `InMemoryPasskeyStore` intended for
  local development only. Replace it with a persistent storage implementation
  for production.
- `dpop/` exports `createDpopProof` and `verifyDpopProof` helpers for working
  with DPoP-bound access tokens.

If you'd like, I can also add a short example showing how to call
`dpop/createDpopProof` from the demo UI.
