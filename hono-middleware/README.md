# @scope/hono-passkeys-middleware

A reusable [Hono](https://hono.dev/) middleware that adds
[passkey / WebAuthn](https://passkeys.dev/) registration and authentication
endpoints powered by
[`@simplewebauthn/server`](https://github.com/MasterKale/SimpleWebAuthn).

The middleware exposes a ready-to-serve `client.js` bundle based on
[`@simplewebauthn/client`](https://github.com/MasterKale/SimpleWebAuthn/tree/master/packages/client)
and a JSON API for bootstrapping and verifying passkey ceremonies. It is
designed so the package can be published to both npm and [JSR](https://jsr.io/)
as-is.

## Installation

```bash
npm install @scope/hono-passkeys-middleware
```

or using the `npm:` specifier in Deno/JSR projects:

```ts
import { createPasskeyMiddleware } from "jsr:@scope/hono-passkeys-middleware";
```

## Usage

```ts
import { Hono } from "hono";
import {
  createPasskeyMiddleware,
  InMemoryPasskeyStore,
} from "@scope/hono-passkeys-middleware";

const app = new Hono();
const storage = new InMemoryPasskeyStore();

app.use(
  createPasskeyMiddleware({
    rpID: "example.com",
    rpName: "Example Passkeys Demo",
    storage,
    // Optional: customise the mount path (defaults to '/webauthn')
    path: "/webauthn",
  }),
);

app.get("/", (c) => c.text("Hello passkeys!"));
```

The middleware exposes the following endpoints relative to the configured `path`
(default `/webauthn`):

| Method   | Path                                         | Description                                                                                         |
| -------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `GET`    | `/client.js`                                 | Returns the pre-built `@simplewebauthn/client` bundle.                                              |
| `GET`    | `/credentials?username=<name>`               | Lists stored credentials for the account.                                                           |
| `DELETE` | `/credentials/:credentialId?username=<name>` | Removes a stored credential (if the storage implementation supports deletion).                      |
| `POST`   | `/register/options`                          | Generates registration options for the provided username (auto-provisions the account when needed). |
| `POST`   | `/register/verify`                           | Verifies a registration ceremony and stores the resulting credential with the provided nickname.    |
| `POST`   | `/authenticate/options`                      | Generates authentication options for the stored credentials of the given user.                      |
| `POST`   | `/authenticate/verify`                       | Verifies an authentication ceremony and updates the stored credential counter.                      |

All JSON endpoints return `4xx` errors when required parameters are missing or a
credential/user cannot be resolved. After a successful authentication the
middleware stores the session in `c.get('passkey')` so downstream handlers can
inspect the authenticated user.

The middleware derives the relying-party origin for each request from the
incoming `Origin` header (falling back to the request URL) and packages it with
the generated challenge inside an HMAC-signed cookie. The cookie is verified and
cleared during the `/verify` steps to ensure the challenge cannot be tampered
with while still avoiding server-side storage.

### Storage

`@scope/hono-passkeys-middleware` ships with `InMemoryPasskeyStore` for quick
experiments. For production use you should implement the `PasskeyStorage`
interface with your own persistence layer and session handling. Challenge data
is automatically signed and stored client-side in cookies using a secret kept in
`Deno.Kv`.

### DPoP Support

The middleware includes built-in support for [DPoP (Demonstrating Proof-of-Possession)](https://datatracker.ietf.org/doc/html/rfc9449) to bind sessions to a cryptographic key pair, providing enhanced security against token theft and replay attacks. DPoP is always enabled.

#### Server-side

The middleware automatically handles DPoP proofs when clients include them:

1. During registration/authentication, if a `dpopProof` is included in the request body, the middleware verifies it and binds the DPoP public key (JWK) to the session.
2. On subsequent requests, if the session has a bound DPoP key, the middleware verifies the `DPoP` header matches the stored key.
3. The verified DPoP JWK is available in `c.get('dpopJwk')` for use in protected endpoints.

#### Client-side

DPoP is automatically enabled in the client. Initialize the DPoP key pair after creating the client:

```ts
import { createClient } from "/webauthn/client.js";

const client = createClient();
await client.initDpop(); // Generate DPoP key pair

// DPoP proofs are automatically included in registration/authentication
await client.register({ username: "alice" });
await client.authenticate({ username: "alice" });
```

You can also manually generate DPoP proofs:

```ts
import { generateDpopKeyPair, createDpopProof } from "/webauthn/client.js";

const keyPair = await generateDpopKeyPair();
const proof = await createDpopProof({
  keyPair,
  method: "POST",
  url: "https://example.com/api/resource",
});

// Include proof in DPoP header
await fetch("/api/resource", {
  method: "POST",
  headers: { DPoP: proof },
});
```

### Client bundle caching

`client.js` is read from disk on first request and cached in-memory for
subsequent responses. If you need custom caching headers you can wrap the
middleware with your own handler.

## Local development

Use the demo server in `../server` to exercise the middleware during
development:

```bash
cd ../server
deno task dev
```
