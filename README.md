# Passkeys and WebPush ready ID provider

[![Deploy on Deno](https://deno.com/button)](https://console.deno.com/new?clone=kuboon/id.kbn.one)

## アーキテクチャ

- rp.example.com: Relying Party (= service provider)
- idp.example.com: ID Provider (this repo)

パスキー認証は IdP に集約。RP は DPoP 鍵を持ち、IdP のセッションを自分の jkt
(JWK SHA-256 thumbprint) に bind してもらう。

### サインインフロー

1. RP のブラウザが DPoP 鍵ペアを生成 (IndexedDB 保存) → `rp_jkt` を計算
2. RP が遷移:
   `https://idp.example.com/authorize?dpop_jkt=<rp_jkt>&redirect_uri=<here>`
   - `redirect_uri` の origin は IdP の `AUTHORIZE_WHITELIST`
     に含まれている必要あり
3. IdP は `authorize.html` を返す。クライアント JS は IdP 用の DPoP 鍵で動く
4. IdP 側のセッションを確認:
   - 未ログインならパスキー認証 (signin/register)
   - ログイン済 or 認証成功後 →
     `dpop_fetch POST /bind_session {dpop_jkt: rp_jkt}`
5. IdP は `sessionRepository.update(rp_jkt, () => ({ userId }))` を実行
6. ブラウザを `redirect_uri` へ戻す
7. RP のブラウザが `dpop_fetch GET https://idp.example.com/session` →
   `{ userId }` が返る (DPoP proof の thumbprint = rp_jkt が bind 済のため)

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

- `RP_ID` (relying party id for WebAuthn, e.g. `localhost`)
- `RP_NAME` (relying party display name, e.g. `My ID Provider`)
- `IDP_ORIGIN` (this server's own origin, e.g. `http://localhost:8000`)
- `AUTHORIZE_WHITELIST` (comma-separated RP origins allowed to use `/authorize`
  and CORS, e.g. `http://localhost:3000,https://rp.example.com`)

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

- The `@kuboon/passkeys` package includes an `InMemoryPasskeyRepository`
  intended for local development only. Replace it with a persistent storage
  implementation for production.
- `dpop/` exports `createDpopProof` and `verifyDpopProof` helpers for working
  with DPoP-bound access tokens.

If you'd like, I can also add a short example showing how to call
`dpop/createDpopProof` from the demo UI.
