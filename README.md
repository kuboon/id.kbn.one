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

## Push 通知

### 一斉通知 (`POST /push/notifications`)

サインイン中ユーザ自身（ブラウザの DPoP セッション）から、自分のデバイスへ通知を
送る。宛先の指定方法:

| ボディ                      | 宛先                                             |
| --------------------------- | ------------------------------------------------ |
| `subscriptionIds: string[]` | 指定した複数の購読（重複は除去）                 |
| `subscriptionId: string`    | 単一の購読（`subscriptionIds` と同時指定は 400） |
| どちらも省略                | そのユーザの全デバイス                           |

1リクエストあたり最大 500 宛先。送信は同時実行 10
のワーカープールで処理する（push
サービスのレート制限・アウトバウンド接続上限への
配慮）。それ以上はリクエスト分割で。

### RPサーバ起点の通知 (`POST /rp/notifications`)

ブラウザ（エンドユーザの DPoP
鍵）を経由せず、**RPサーバ自身**から通知を送る経路。 DPoP
セッションは使えないので、RP は **`private_key_jwt` クライアントアサーション**
([RFC 7521] / [RFC 7523]) で認証する。**共通鍵は不要** — IdP は RP
の公開鍵だけを 保持し、RP の秘密鍵で署名された JWS を検証する。

事前に IdP の `RP_PUSH_CLIENTS` 環境変数へ RP
の公開鍵を登録する（鍵ローテーション時 は新旧を並べる）:

```json
[
  {
    "clientId": "rp.example.com",
    "keys": [
      {
        "kty": "EC",
        "crv": "P-256",
        "x": "…",
        "y": "…",
        "alg": "ES256",
        "kid": "…"
      }
    ]
  }
]
```

RP 側は秘密鍵でクライアントアサーションを署名し、`Authorization` ヘッダに載せて
POST する:

```ts
import { calculateJwkThumbprint, SignJWT } from "jose";

// privateKey: RP の ES256 秘密鍵 (CryptoKey)。kid は登録済 JWK と一致させる。
const now = Math.floor(Date.now() / 1000);
const assertion = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", typ: "client-assertion+jwt", kid })
  .setIssuer("rp.example.com") // = clientId
  .setSubject("rp.example.com") // = clientId
  .setAudience("https://id.kbn.one") // = IDP_ORIGIN
  .setIssuedAt(now)
  .setExpirationTime(now + 60)
  .setJti(crypto.randomUUID()) // 単回利用（リプレイ防止）
  .sign(privateKey);

const res = await fetch("https://id.kbn.one/rp/notifications", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${assertion}`,
  },
  body: JSON.stringify({
    // 宛先: userIds / userId / subscriptionIds のいずれか1つ以上
    userIds: ["user-1", "user-2"],
    notification: { title: "Hi", body: "Notification from RP server" },
  }),
});
// → { results: [{ userId, subscriptionId, ok, removed, warnings } | … ],
//     unknownSubscriptionIds: [] }
```

登録済みの RP は任意のユーザに送信できる。宛先解決後の上限・同時実行は一斉通知と
同じ（最大 500 宛先 / 同時 10）。

[RFC 7521]: https://www.rfc-editor.org/rfc/rfc7521
[RFC 7523]: https://www.rfc-editor.org/rfc/rfc7523

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
- `RP_PUSH_CLIENTS` (JSON: RPサーバ起点通知を許可する RP の `clientId`
  と公開鍵。 下記「RPサーバ起点の通知」参照)

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
