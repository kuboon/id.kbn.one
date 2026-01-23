# Passkeys and WebPush ready ID provider

[![Deploy on Deno](https://deno.com/button)](https://console.deno.com/new?clone=kuboon/id.kbn.one)

## アーキテクチャ

- sp.example.com: service provider
- idp.example.com: ID provider (This repo)

### 未ログイン遷移

- sp.example.com のブラウザ上で DPoP 鍵作成
  - dpop_fetch `GET idp.example.com/session`
- idp.example.com サーバは Unauthorized を返す
- sp.example.com のブラウザ上で form 要素を作成して click し、 POST遷移する
  - 遷移先は `POST idp.example.com/session`
  - htm, htu は ↑ で DPoP string を生成
  - POST body に `DPOP=xxx,redirect=/profile` を付与する。
- idp.example.com は DPOP を検証したのち、
  - session-sp に以下の内容を保存
    - `Origin` ヘッダ
    - redirect (Origin を含まない, デフォルトは '/')
  - 以下の Javascript を含む http response を返す
    - ブラウザ上で DPoP 鍵生成 (以降 session-idp)
    - dpop_fetch `POST /authenticate (body: {session: "session-sp"})`
      - サーバは session-idp を生成し、 session-sp が認証待ちであることを記録
    - session-idp が未ログインなので失敗し、ログイン画面へ遷移
- idp.example.com 上で Passkeys ログイン認証を実施
  - Passkeys 認証完了したら session-idp は user-1 でログイン済とマークする
  - session-sp が認証待ちであることを検出
  - session-sp は user-1 でログイン済とマークする
  - session-sp から redirect と origin を読み出し、合成してブラウザへ送る
- ブラウザを遷移
- sp.example.com で dpop_fetch `GET idp.example.com/session`
- idp.example.com は user-1 の情報を返す

### ログイン済遷移

- idp へ POST redirect して dpop_fetch
  `POST /authenticate (body: {session: "session-sp"})`
  - session-sp は user-1 でログイン済とマークする
  - session-sp から redirect と origin を読み出し、合成してブラウザへレスポンス
  - ブラウザは直ちに redirect back

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
