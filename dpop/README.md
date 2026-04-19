# @kuboon/dpop

[DPoP (Demonstrating Proof of Possession) / RFC 9449](https://www.rfc-editor.org/rfc/rfc9449)
helpers for both the client (proof generation) and the server (proof
verification), built on the Web Crypto API.

- Zero runtime dependencies beyond
  [`@std/encoding`](https://jsr.io/@std/encoding)
- Uses the platform `crypto.subtle` — runs on Deno, Bun, Node ≥ 20, Cloudflare
  Workers, and modern browsers
- Supports `ES256` (ECDSA P-256) keys — the profile required by DPoP-capable
  OAuth 2.0 servers
- Ships a browser key store backed by IndexedDB and an `InMemory` variant for
  tests

## Install

```sh
# Deno
deno add jsr:@kuboon/dpop

# Node / Bun
npx jsr add @kuboon/dpop
```

## Entry points

| Import specifier         | Purpose                                                 |
| ------------------------ | ------------------------------------------------------- |
| `@kuboon/dpop`           | Browser / client-side proof generator (`init`)          |
| `@kuboon/dpop/server.ts` | Server-side verification (`verifyDpopProof*`)           |
| `@kuboon/dpop/common.ts` | Shared helpers (`computeThumbprint`, normalizers, etc.) |
| `@kuboon/dpop/types.ts`  | Shared TypeScript types                                 |

## Client usage (browser)

`init()` generates — or loads, on second run — a non-extractable ECDSA key pair,
persists it in IndexedDB, and returns a `fetchDpop` function with the same
signature as `fetch`. Every call automatically attaches a freshly-signed `DPoP`
header bound to the request's method and URL.

```ts
import { init } from "@kuboon/dpop";

const { fetchDpop, thumbprint, publicJwk } = await init();

// `thumbprint` is the RFC 7638 JWK SHA-256 thumbprint (a.k.a. `jkt`).
// Send it to the IdP/authorization server so it can bind sessions or
// access tokens to this browser's key.
// @see https://github.com/kuboon/id.kbn.one
const url = new URL("https://id.kbn.one/authorize");
url.searchParams.set("dpop_jkt", encodeURIComponent(thumbprint));
url.searchParams.set("redirect_url", location.href);
location.href = url;

// Then use `fetchDpop` anywhere you would use `fetch`.
const res = await fetchDpop("/api/profile");
```

## Server usage

```ts
import { verifyDpopProofFromRequest } from "@kuboon/dpop/server.ts";

Deno.serve(async (req) => {
  const result = await verifyDpopProofFromRequest(req, {
    // optional — reject replayed `jti` values by consulting your store
    checkReplay: async (jti) => !(await seenJtis.has(jti)),
  });
  if (!result.valid) {
    return new Response(result.error, { status: 401 });
  }
  // `result.payload` — htm, htu, jti, iat, [nonce], [ath]
  // `result.jwk`     — the public key that signed this proof
  const thumbprint = 
  return new Response("ok");
});
```

If you already have the raw `DPoP` header string (e.g. from a custom transport),
use the lower-level entry point:

```ts
import { verifyDpopProof } from "@kuboon/dpop/server.ts";

const result = await verifyDpopProof({
  proof: dpopHeader,
  method: "POST",
  url: "https://api.example.com/resource",
});
```

### Options

| Option             | Default                       | Meaning                                                      |
| ------------------ | ----------------------------- | ------------------------------------------------------------ |
| `maxAgeSeconds`    | `300`                         | Maximum accepted age of the proof's `iat` claim.             |
| `clockSkewSeconds` | `60`                          | How far into the future `iat` may be.                        |
| `checkReplay(jti)` | `() => true` (accept all)     | Plug in your replay-cache; return `false` to reject replays. |
| `now`              | `Math.floor(Date.now()/1000)` | Override the current time (useful for deterministic tests).  |

### Error codes

`VerifyDpopProofResult.error` is one of:

`invalid-format`, `invalid-json`, `invalid-type`, `unsupported-algorithm`,
`invalid-jwk`, `invalid-signature`, `method-mismatch`, `invalid-url`,
`url-mismatch`, `invalid-jti`, `invalid-iat`, `future-iat`, `expired`,
`replay-detected`, `missing-dpop-header`.

## Verifying DPoP-bound access tokens (RFC 9449 §7)

For resource servers that accept `Authorization: DPoP <access_token>` issued by
a separate authorization server: verify the access token yourself (e.g. with
[`jose`](https://jsr.io/@panva/jose)), then pass the raw token plus the decoded
claims as the `accessToken` option — `verifyDpopProofFromRequest` adds the
binding checks:

- `SHA-256(proof.jwk) === claims.cnf.jkt` (fails with `jkt-mismatch`)
- `proof.ath === SHA-256(access_token)` (fails with `ath-mismatch`)

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
import { verifyDpopProofFromRequest } from "@kuboon/dpop/server.ts";

const JWKS = createRemoteJWKSet(
  new URL("https://id.kbn.one/.well-known/jwks.json"),
);

Deno.serve(async (req) => {
  const auth = req.headers.get("authorization") ?? "";
  const [scheme, token] = auth.split(" ");
  if (scheme?.toLowerCase() !== "dpop" || !token) {
    return new Response("missing-dpop-auth", { status: 401 });
  }

  const { payload: claims } = await jwtVerify(token, JWKS, {
    issuer: "https://id.kbn.one",
    audience: "https://db.kbn.one",
  });

  const result = await verifyDpopProofFromRequest(req, {
    accessToken: { token, claims },
    checkReplay: (jti) => replayCache.addIfAbsent(jti),
  });
  if (!result.valid) return new Response(result.error, { status: 401 });
  return new Response(`hello ${claims.sub}`);
});
```

Additional failure codes when `accessToken` is provided: `jkt-mismatch`,
`ath-mismatch`.

## Binding a session to a browser key (`jkt`)

```ts
import { computeThumbprint } from "@kuboon/dpop/common.ts";

const jkt = await computeThumbprint(publicJwk);
// Identical to the value `init()` returns as `thumbprint`.
```

Compare `jkt` against the thumbprint you computed from the JWK embedded in the
DPoP proof header — they must match for a request to count as coming from the
key you previously bound to a session.

### Swapping the key store (for test on server)

```ts
import { init, InMemoryKeyRepository } from "@kuboon/dpop";

const { fetchDpop } = await init({ keyStore: new InMemoryKeyRepository() });
```

Implement `KeyRepository` to back your keys with anything you like (e.g.
encrypted storage on native apps).

## What this library does **not** do

- Does **not** issue access tokens — the authorization server still needs to
  sign the JWT (embedding `cnf.jkt`) and publish its JWKS.
- Does **not** verify JWT signatures / `iss` / `aud` / `exp` itself — verify the
  access token with [`jose`](https://jsr.io/@panva/jose) (or your JWT lib of
  choice) first, then pass it as the `accessToken` option.
- Does **not** ship a replay cache — provide your own via `checkReplay`.
- Does **not** handle the `DPoP-Nonce` challenge/response flow; if you need it,
  read `payload.nonce` yourself and issue `Set-Header: DPoP-Nonce` before
  retrying.

## References

- [RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://www.rfc-editor.org/rfc/rfc9449)
- [RFC 7638 — JSON Web Key (JWK) Thumbprint](https://www.rfc-editor.org/rfc/rfc7638)
