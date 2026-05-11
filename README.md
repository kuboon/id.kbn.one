# Passkeys and WebPush ready ID provider

[![Deploy on Deno](https://deno.com/button)](https://console.deno.com/new?clone=kuboon/id.kbn.one)

## アーキテクチャ

- rp.example.com: Relying Party (= service provider)
- idp.example.com: ID Provider (this repo)

パスキー認証は IdP に集約。RP は 2 種類の経路から選べる:

- **Simple (DPoP)** — 自作 first-party RP 向け。RP は DPoP 鍵を持ち、IdP
  セッションを自分の jkt (JWK SHA-256 thumbprint) に bind してもらう。トークンは
  `/session` 経由で取得し DPoP-bound JWS が返る
- **OIDC Authorization Code (PKCE 必須)** — Outline などサードパーティ RP
  向け。標準の `/.well-known/openid-configuration` discovery 対応。public
  client、`client_secret` は受理するが検証しない

両者は同じ `/authorize` を入口に持ち、クエリで分岐 (`response_type=code`
があれば OIDC、なければ DPoP)。

### Simple (DPoP) サインインフロー

1. RP のブラウザが DPoP 鍵ペアを生成 (IndexedDB 保存) → `rp_jkt` を計算
2. RP が遷移:
   `https://idp.example.com/authorize?dpop_jkt=<rp_jkt>&redirect_uri=<here>`
   - `redirect_uri` の origin は IdP の `AUTHORIZE_WHITELIST`
     に含まれている必要あり
3. IdP の `/authorize` がクエリを検証 → `<Authorize />` clientEntry を SSR。
   クライアント JS は IdP 用の DPoP 鍵で動く
4. IdP 側のセッションを確認:
   - 未ログインならパスキー認証 (signin/register)
   - ログイン済 or 認証成功後 →
     `dpop_fetch POST /bind_session {dpop_jkt: rp_jkt}`
5. IdP は thumbprint=`rp_jkt` の DPoP セッションに `userId` を書き込む
6. ブラウザを `redirect_uri` へ戻す
7. RP のブラウザが `dpop_fetch GET https://idp.example.com/session` →
   `{ userId, jws }` が返る (DPoP proof の thumbprint = rp_jkt が bind 済のため)

### 発行される JWT (`jws` フィールド)

ES256 署名の compact JWS ([RFC 7515] / [RFC 7519])。クレーム:

- `iss`: `IDP_ORIGIN`
- `sub`: userId
- `nbf`, `exp`, `jti`
- `cnf.jkt`: RP の DPoP 鍵 thumbprint (= `rp_jkt`) — [RFC 9449] DPoP binding

リソースサーバ呼び出し時は DPoP proof と組み合わせて使う。

### RP 側での検証

公開鍵は JWKS として `https://idp.example.com/.well-known/jwks.json`
([RFC 7517]) で配布。`jose` の `createRemoteJWKSet` で取得・キャッシュできる:

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(
  new URL("https://idp.example.com/.well-known/jwks.json"),
);

const { payload } = await jwtVerify(jws, JWKS, {
  issuer: "https://idp.example.com",
});
// payload.sub === userId
// payload.cnf.jkt === rpJkt も別途確認すること
```

`jwtVerify` は署名 + `iss` / `exp` / `nbf` を一括検証する。`cnf.jkt` が自分の
DPoP 鍵 thumbprint と一致するかは呼び出し側で確認する。鍵はヘッダの `kid` (RFC
7638 thumbprint) で JWKS から選択される — 鍵ローテーション時は新旧両方を JWKS
に並べておけば自動で切り替わる。

[RFC 7515]: https://www.rfc-editor.org/rfc/rfc7515
[RFC 7517]: https://www.rfc-editor.org/rfc/rfc7517
[RFC 7519]: https://www.rfc-editor.org/rfc/rfc7519
[RFC 9449]: https://www.rfc-editor.org/rfc/rfc9449

### OIDC Authorization Code フロー

Outline など標準 OIDC を喋るサードパーティ RP 向け。

1. RP が
   `https://idp.example.com/authorize?response_type=code&client_id=<rp_origin>&redirect_uri=<cb>&scope=openid+profile+email&state=<csrf>&code_challenge=<S256>&code_challenge_method=S256`
   にブラウザを飛ばす
   - `client_id` は RP の origin、`redirect_uri` は同 origin かつ
     `AUTHORIZE_WHITELIST` 配下である必要あり
2. IdP がパスキー認証を実施 → 認証成功後、IdP フロントが内部
   `POST /authorize/code` (DPoP-bound) で one-time code を発行
3. ブラウザを `redirect_uri?code=...&state=...` に戻す
4. RP が `POST /token` (form-encoded) に
   `grant_type=authorization_code&code=...&redirect_uri=...&client_id=...&code_verifier=...`
   を投げて、`{ access_token, id_token, token_type, expires_in, scope }` を取得
5. (任意) `GET /userinfo` に `Authorization: Bearer <access_token>` で
   `{ sub, email, preferred_username, name }` を取得 (scope に応じて
   `profile`/`email` claim が含まれる)

設定は **public client + PKCE 必須**。`client_secret` の検証は行わないが RP
ライブラリが要求する場合は適当な値をセットして良い。`email` は
`<userId>@<idp host>` で合成される。詳細メタデータは
`/.well-known/openid-configuration` を参照。

## 技術スタック

- ランタイム: **Deno** (`Deno.bundle`, `Deno.openKv`)
- ルーター:
  [`@remix-run/fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router) +
  Frame ベースの shell ナビゲーション (`@remix-run/ui`)
- セッション: `@remix-run/session` を `@kbn/session-storage-kv` 経由で `KvRepo`
  に保存。DPoP セッションは `@kbn/dpop-session-middleware` が thumbprint
  をキーに管理
- UI: JSX SSR + [Tailwind v4](https://tailwindcss.com) +
  [daisyUI v5](https://daisyui.com)

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

詳細は `main/server/config.ts`。

- `RP_ID` (relying party id for WebAuthn, e.g. `localhost`)
- `RP_NAME` (relying party display name, e.g. `My ID Provider`)
- `IDP_ORIGIN` (this server's own origin, e.g. `http://localhost:8000`)
- `AUTHORIZE_WHITELIST` (comma-separated RP origins allowed to use `/authorize`
  and CORS, e.g. `http://localhost:3000,https://rp.example.com`)
- `PUSH_CONTACT` (VAPID contact, e.g. `mailto:o@kbn.one`)

## Project layout

```
/
├─ main/                          # ID provider server
│  ├─ assets/                     # Tailwind/daisyui input CSS
│  ├─ bundler/                    # Deno.bundle JS + Tailwind CSS build
│  ├─ client/                     # Page clientEntries (.tsx) + SW
│  └─ server/                     # fetch-router + JSX controllers
├─ kv/                            # KvRepo abstraction (memory + Deno KV)
├─ session-storage-kv/            # Remix SessionStorage adapter for KvRepo
├─ dpop-session-middleware/       # DPoP session middleware for fetch-router
├─ dpop/                          # DPoP key + proof helpers
└─ passkeys/                      # Passkeys / WebAuthn (hono + fetch-router)
```

## Quick start — run the demo server

The dev task bundles client JS / Tailwind+daisyui CSS, then starts `deno serve`
against the workspace router.

```bash
# from repository root
deno task dev
```

The demo server listens on http://localhost:8000. Open the browser to try
registering and authenticating passkeys.

## Development & checks

```bash
# format + lint + type-check + tests
deno task test

# rebuild bundled assets (CSS + JS) without serving
deno task bundle
```

`pre-deploy` runs one-shot KV migrations (`main/server/migrate.ts`). It does
**not** rebuild bundled assets — run `deno task build` separately before
deploying so the deploy can read pre-built assets from `main/bundled/` (which is
git-ignored).

Notes:

- `@kuboon/passkeys` ships both a Hono adapter (`hono-middleware`, kept for
  back-compat) and a fetch-router adapter (`fetch-router-middleware`). The IdP
  server uses the latter.
- `@kuboon/dpop` exports `createDpopProof` / `verifyDpopProof` for DPoP- bound
  access tokens.
