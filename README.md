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
3. IdP の `/authorize` がクエリを検証 → `<Authorize />` clientEntry を SSR。
   クライアント JS は IdP 用の DPoP 鍵で動く
4. IdP 側のセッションを確認:
   - 未ログインならパスキー認証 (signin/register)
   - ログイン済 or 認証成功後 →
     `dpop_fetch POST /bind_session {dpop_jkt: rp_jkt}`
5. IdP は thumbprint=`rp_jkt` の DPoP セッションに `userId` を書き込む
6. ブラウザを `redirect_uri` へ戻す
7. RP のブラウザが `dpop_fetch GET https://idp.example.com/session` →
   `{ userId }` が返る (DPoP proof の thumbprint = rp_jkt が bind 済のため)

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

`pre-deploy` runs the bundler, so a deploy reads pre-built assets from
`main/bundled/` (which is git-ignored).

Notes:

- `@kuboon/passkeys` ships both a Hono adapter (`hono-middleware`, kept for
  back-compat) and a fetch-router adapter (`fetch-router-middleware`). The IdP
  server uses the latter.
- `@kuboon/dpop` exports `createDpopProof` / `verifyDpopProof` for DPoP- bound
  access tokens.
