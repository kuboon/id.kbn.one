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

通知の送信は **常にサーバ起点** で行う（`POST /rp/notifications`）。ブラウザ
（エンドユーザ）からの送信エンドポイントは無い。`/push/*` はブラウザからの
購読管理（VAPID 公開鍵取得・subscription の CRUD・デバイス自己テスト
`POST /push/notifications/test`）のみを担う。

#### レート制限（subscription 単位の flood 防止）

1つの subscription に短時間で大量の通知が飛ばないよう、固定ウィンドウのレート
制限を全送信経路（RP 起点・自己テスト共通）に適用する。**60 秒あたり 1
件**まで（固定）。上限超過分は **エラーにせず skip** し、レスポンスの該当
エントリに `throttled: true` が立つ。

### RPサーバ起点の通知 (`POST /rp/notifications`)

ブラウザ（エンドユーザの DPoP
鍵）を経由せず、**RPサーバ自身**から通知を送る経路。 DPoP
セッションは使えないので、RP は **`private_key_jwt` クライアントアサーション**
([RFC 7521] / [RFC 7523]) で認証する。**共通鍵は不要** — IdP は RP
の秘密鍵で署名された JWS を、RP 自身が公開する JWKS で検証する（IdP が公開鍵を
保持しない＝ RP が自分の JWKS を更新するだけで鍵ローテーションできる）。

専用の登録は不要。RP の `clientId` は **その RP の origin**
で、`AUTHORIZE_WHITELIST` に含まれていれば許可される。IdP は検証鍵を RP の
`${clientId}/.well-known/jwks.json` から取得する（IdP 側の JWKS 配布と対称）。

RP 側は秘密鍵でクライアントアサーションを署名し、`Authorization` ヘッダに載せて
POST する:

```ts
import { SignJWT } from "jose";

// privateKey: RP の ES256 秘密鍵 (CryptoKey)。kid は RP の JWKS と一致させる。
const now = Math.floor(Date.now() / 1000);
const assertion = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", typ: "client-assertion+jwt", kid })
  .setIssuer("https://rp.example.com") // = clientId (origin, 要 AUTHORIZE_WHITELIST)
  .setSubject("https://rp.example.com") // = clientId
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
    // 宛先: userIds（1つ以上）。名指しした各ユーザの全デバイスへ配信。
    userIds: ["user-1", "user-2"],
    notification: {
      title: "Hi",
      body: "Notification from RP server",
      badgeCount: 3, // 任意: アプリアイコンのバッジ数字（後述）
    },
  }),
});
// → { results: [{ userId, subscriptionId, ok, throttled, removed, warnings }
//                 | { userId, subscriptionId, ok: false, error } ] }
```

#### 宛先は RP 自身のドメインに限定

各 subscription には、登録時の **`Origin`**（RP
フロントエンドのオリジン。ブラウザ が付与するヘッダで、ページ JS
からは詐称できない）が記録される。`/rp/notifications` は、`clientId`（=
認証された RP のオリジン）の **ドメインおよびサブドメイン**から 登録された
subscription のみを宛先にする（ホスト名で比較、scheme/port は無視）。 別の RP
から登録されたデバイスや、`Origin` 未記録の古い subscription
（本対応より前に登録されたもの）には届かない。

宛先（条件を満たすデバイス）は 1 リクエストあたり最大 500、送信は同時実行 10
のワーカープールで処理する（push
サービスのレート制限・アウトバウンド接続上限への配慮）。それ以上はリクエスト
分割で。

#### アプリアイコンのバッジ数字 (`notification.badgeCount`)

`notification.badgeCount`（任意・非負整数）を指定すると、Service Worker が
[App Badging API] の `navigator.setAppBadge(badgeCount)`
を呼び、ホーム/タスクバーの アプリアイコンに数字バッジを出す。`0`
を送るとクリア（`clearAppBadge`）。**省略時は
既存バッジに触らない**（消さない）ので、増減・クリアのタイミングは RP 側が
`badgeCount` の値で制御する。

注意: **インストール済み PWA でのみ**
表示される（ブラウザのタブ表示では出ない）。 対応は Chrome /
Edge（デスクトップ・Android のインストール済み PWA）、Safari は macOS / iOS
16.4+ のインストール済み Web アプリ。未対応環境では no-op。なお `badge`（画像
URL）は別物で、通知自体に出すバッジ画像（Web Notifications API の `badge`）。

[App Badging API]: https://developer.mozilla.org/docs/Web/API/Badging_API
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
