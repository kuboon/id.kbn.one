# id.kbn.one

Passkeys and Web Push ready ID provider. 本番は https://id.kbn.one 。

パスキー認証を IdP に集約し、RP には DPoP 鍵に束縛したセッションと ES256 署名の
JWT を渡す。Web Push の配信と、remote MCP サーバ向けの OAuth 2.1
認可サーバも持つ。Cloudflare Workers と D1 で動き、開発・テスト・ビルドは Deno
で行う。

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
3. IdP の `/authorize` がクエリを検証 → `<Authorize />` clientEntry を
   SSR。クライアント JS は IdP 用の DPoP 鍵で動く
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

通知の送信は**常にサーバ起点**で行う（`POST /rp/notifications`）。ブラウザ（エンドユーザ）からの送信エンドポイントは無い。`/push/*`
はブラウザからの購読管理（VAPID 公開鍵取得・subscription の
CRUD・デバイス自己テスト `POST /push/notifications/test`）のみを担う。

なお `GET /push/subscriptions`（一覧）は、別オリジンの RP
フロントエンドから呼ばれた場合、その RP
の**ドメイン（＋サブドメイン）から登録された subscription のみ**を返す（`Origin`
ヘッダで判定）。IdP 自身（同一オリジン /
`IDP_ORIGIN`）からの呼び出しは全件返す（`/me` の管理用）。

#### レート制限（subscription 単位の flood 防止）

1つの subscription
に短時間で大量の通知が飛ばないよう、固定ウィンドウのレート制限を全送信経路（RP
起点・自己テスト共通）に適用する。**60 秒あたり 1
件**まで（固定）。上限超過分は**エラーにせず skip**
し、レスポンスの該当エントリに `throttled: true` が立つ。

### RP サーバ起点の通知 (`POST /rp/notifications`)

ブラウザ（エンドユーザの DPoP 鍵）を経由せず、**RP
サーバ自身**から通知を送る経路。DPoP セッションは使えないので、RP は
**`private_key_jwt` クライアントアサーション** ([RFC 7521] / [RFC 7523])
で認証する。**共通鍵は不要** — IdP は RP の秘密鍵で署名された JWS を、RP
自身が公開する JWKS で検証する（IdP が公開鍵を保持しない＝ RP が自分の JWKS
を更新するだけで鍵ローテーションできる）。

専用の登録は不要。RP の `clientId` は**その RP の origin**
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
フロントエンドのオリジン。ブラウザが付与するヘッダで、ページ JS
からは詐称できない）が記録される。`/rp/notifications` は、`clientId`（=
認証された RP のオリジン）の**ドメインおよびサブドメイン**から登録された
subscription のみを宛先にする（ホスト名で比較、scheme/port は無視）。別の RP
から登録されたデバイスや、`Origin` 未記録の古い
subscription（本対応より前に登録されたもの）には届かない。

宛先（条件を満たすデバイス）は 1 リクエストあたり最大 500、送信は同時実行 10
のワーカープールで処理する（push
サービスのレート制限・アウトバウンド接続上限への配慮）。それ以上はリクエスト分割で。

#### アプリアイコンのバッジ数字 (`notification.badgeCount`)

`notification.badgeCount`（任意・非負整数）を指定すると、Service Worker が
[App Badging API] の `navigator.setAppBadge(badgeCount)`
を呼び、ホーム/タスクバーのアプリアイコンに数字バッジを出す。`0`
を送るとクリア（`clearAppBadge`）。**省略時は既存バッジに触らない**（消さない）ので、増減・クリアのタイミングは
RP 側が `badgeCount` の値で制御する。

注意: **インストール済み PWA
でのみ**表示される（ブラウザのタブ表示では出ない）。対応は Chrome /
Edge（デスクトップ・Android のインストール済み PWA）、Safari は macOS / iOS
16.4+ のインストール済み Web アプリ。未対応環境では no-op。なお `badge`（画像
URL）は別物で、通知自体に出すバッジ画像（Web Notifications API の `badge`）。

[App Badging API]: https://developer.mozilla.org/docs/Web/API/Badging_API
[RFC 7521]: https://www.rfc-editor.org/rfc/rfc7521
[RFC 7523]: https://www.rfc-editor.org/rfc/rfc7523

## フィードバック（バグ報告・要望）

RP の画面から、サインイン中のエンドユーザーが IdP
のオーナーにバグ報告や要望を送れる。届いたものは D1
に保存したうえで、オーナーのホームポータル (home.kbn.one) の **RP
ごとのスレッド**に投稿される。RP 側に一覧や返信の仕組みは無い。

RP のフロントエンドからは RP クライアントの `sendFeedback` を呼ぶ:

```ts
const rp = await createRpClient({ idpOrigin: "https://id.kbn.one" });
await rp.sendFeedback({ kind: "bug", message: "保存ボタンが反応しない" });
```

`/push/*` と同じ CORS 層の `POST /feedback` で、DPoP
セッションで認証する。本文は次の3つだけ:

- `kind` — `"bug"` / `"request"` / `"other"`
- `message` — 本文。4000 文字まで
- `pageUrl` — 任意。送信時のページ (http(s) URL)。省略すると `sendFeedback` が
  `location.href` を入れる

**誰が・どこから送ったかは本文から取らない。** 送信者は DPoP
セッションのユーザー、送信元 RP はブラウザが付ける `Origin` ヘッダ（ページの JS
からは詐称できない）から IdP が記録する。CORS で通るのは `AUTHORIZE_WHITELIST`
の RP だけ。

応答は `201 { id }`。本文の不正は `400`、未サインインは `401`。**1
ユーザーあたり 1 時間に 5 件**まで受け付け、超えると `429`。

### オーナー側

報告はホームポータルの MCP エンドポイントに送る。**スレッドは RP
のホストごとに1つ**で、`ga-cen.kbn.one` からの報告は全部「フィードバック:
ga-cen.kbn.one」に入る。その RP
の最初の報告でスレッドを作り（`create_thread`）、以降はそこに投稿する（`post_message`）。単位はホストで、登録可能ドメインではない（`*.kbn.one`
の RP が全部1つにまとまってしまうため）。

- どのホストがどのスレッドかは D1 (`feedback_thread`)
  に覚えておく。タイトルでは探さないので、スレッド名を変えても新しいスレッドは立たない
- スレッドを消すと、ポータルが「thread not
  found」と返すので、次の報告で作り直す。**作り直すのはこのときだけ**で、ポータルが落ちている・レート制限中などでは作り直さない（重複スレッドを作らないため）
- 各投稿は `[バグ報告] 本文の1行目`
  で始まり、ユーザーが書いた文を**行ごとに引用**し、その下に
  RP・ページ・送信者・受付時刻・ID
  を並べる。引用にしているのは、検証されていない RP
  ユーザーの文だと読み手（人でもエージェントでも）に分かるようにするため

ポータルは同時に来た書き込みの片方を `rate limited` で拒否する（実測:
2件同時に送ると1件が拒否され、0.5 秒後には通る）。そのときは 1
秒待って再試行し、3 回で諦める。報告が重なったときだけ、送信者の応答が 1〜2
秒遅れる。

ポータルへの投稿が最終的に失敗しても送信自体は成功させる（報告は D1
に保存済みで、エラーにすると利用者が送り直すだけになる）。失敗はログに残る。設定が無い環境（ローカル開発・テスト）では
D1 に保存するだけ。

報告先のエンドポイントと home は `main/server/config.ts`
に固定してある。設定するのはトークンだけで、`HOME_PORTAL_MCP_TOKEN` を **secret
として Worker に設定する**（ダッシュボードの Workers → id-kbn-one → Settings →
Variables and Secrets）。`cloudflare.config.ts` で `bindings.secret()`
として宣言してあるので、未設定のままではデプロイが失敗する。黙って報告が止まる
Worker を出さないため。

D1 に残る控えは、D1 のコンソールで読める（新しい順）:

```sql
SELECT json_extract(value, '$.kind') AS kind,
       json_extract(value, '$.origin') AS origin,
       datetime(json_extract(value, '$.createdAt') / 1000, 'unixepoch') AS at,
       json_extract(value, '$.message') AS message
FROM kv
WHERE key >= 'sfeedback' || char(1) AND key < 'sfeedback' || char(2)
ORDER BY key DESC
LIMIT 20;
```

キーは `KvRepo` の符号化（型タグ `s` + 区切り `char(1)`）なので、範囲で
`feedback` 配下だけを取る。期限は無く、消すまで残る。

## MCP 認可サーバ (OAuth 2.1)

別ドメインの **remote MCP サーバ**（= OAuth リソースサーバ）の認証に、この IdP
を **OAuth 2.1 認可サーバ**として使うための実装。passkey
認証をログイン段に用いる。

クライアント識別は **DCR ではなく CIMD（Client ID Metadata
Document）**：`client_id` はクライアントが自己公開する HTTPS メタデータ URL
で、AS がそれを fetch・検証する（RP の JWKS を fetch
するのと同じ設計。クライアント登録・保存は不要）。

トークン（認可コード / アクセス / リフレッシュ）はすべて **ES256 署名
JWT**。ランダム生成＋保存はせず、有効性は署名で判定。リフレッシュは**ローテーション＋再利用検知**（使用済み
`jti` のみストレージに記録）。アクセストークンは `aud` を対象 MCP
サーバに束縛（RFC 8707）。

**エンドポイント:**

- `GET /.well-known/oauth-authorization-server`（RFC 8414 メタデータ）
- `GET /oauth/authorize` — パラメータ検証（`response_type=code`／PKCE
  `S256`／RFC 8707 `resource`）＋ CIMD でクライアント解決・`redirect_uri` 照合 →
  **passkey ログイン＋同意** → 認可コードを `redirect_uri?code&state`
  へ。検証済みリクエストは短命の署名トークンに載せて同意画面へ渡すので、承認時に
  CIMD を再取得しない。
- `POST /oauth/token`（`authorization_code`＋PKCE(S256) / `refresh_token`
  ローテーション＋再利用検知）

MCP クライアントの認可リクエスト例：
`GET /oauth/authorize?response_type=code&client_id=<CIMD URL>&redirect_uri=<cb>&code_challenge=<S256>&code_challenge_method=S256&resource=https://mcp.example.com&scope=mcp&state=<s>`

**RS 側（別ドメインの MCP サーバ）で実装が必要:**
`/.well-known/oauth-protected-resource`（RFC 9728、`authorization_servers`
にこの IdP を記載）と、401 時の `WWW-Authenticate`、Bearer
トークン検証（下記）。

RS 側の検証は既存の JWKS 配布を流用：

```ts
import { createRemoteJWKSet, jwtVerify } from "jose";
const JWKS = createRemoteJWKSet(
  new URL("https://id.kbn.one/.well-known/jwks.json"),
);
const { payload } = await jwtVerify(bearer, JWKS, {
  issuer: "https://id.kbn.one",
  audience: "https://mcp.example.com", // このリソースサーバの識別子
});
// payload.sub = userId, payload.scope など
```

## 技術スタック

- **本番**: Cloudflare Workers。ストレージは D1、クライアント資産は Workers
  Static Assets
- **開発・テスト・ビルド**: Deno。ローカルのストレージは Deno KV
- **ストレージ抽象**: `KvRepo`（`kv/`）。D1 と Deno KV
  の両実装があり、`main/server/kv-backend.ts`
  がランタイムに応じて選ぶ。compare-and-set
  を持ち、認可コードの単回利用・リフレッシュトークンの再利用検知・DPoP
  のリプレイ拒否・Push のレート制限がこれに依存する（Workers KV には CAS
  が無く、成功を返し続けたまま保証だけが消えるので、D1 を使う）
- **ルーター**:
  [`@remix-run/fetch-router`](https://github.com/remix-run/remix/tree/main/packages/fetch-router) +
  Frame ベースの shell ナビゲーション (`@remix-run/ui`)
- **セッション**: `@remix-run/session` を `@kbn/session-storage-kv` 経由で
  `KvRepo` に保存。DPoP セッションは `@kbn/dpop-session-middleware` が
  thumbprint をキーに管理
- **UI**: JSX SSR + [Tailwind v4](https://tailwindcss.com) +
  [daisyUI v5](https://daisyui.com)

## ローカル開発

Deno が必要:

```sh
curl -fsSL https://deno.land/install.sh | sh
# または mise
mise use -g deno
```

```sh
deno task dev    # クライアント資産をビルドして http://localhost:3000 で起動 (Deno KV)
deno task test   # fmt + lint + check + test
deno task build  # クライアント資産 (main/bundled/) だけ再ビルド
```

ポートは `IDP_ORIGIN` の既定値 (`http://localhost:3000`)
に合わせてある。ずれると、発行する JWT の `iss` が自分のオリジンと一致しない。

Workers 上での挙動を手元で確かめるには:

```sh
deno task build && deno task build:worker && npx cf dev
```

`cf dev` は本番と同じバンドルを workerd で動かし、ローカルの D1 を使う。空の D1
でも `kv` テーブルは最初のクエリの前に作られる。

## デプロイ

Cloudflare Workers Builds が main への push でビルド・デプロイする。設定は `cf`
CLI が `cloudflare.config.ts`
から読むので、ダッシュボードで設定するのはリポジトリの接続とコマンドだけ。

Workers → id-kbn-one → Settings → Build:

| 項目           | 値                       |
| -------------- | ------------------------ |
| Build command  | `sh scripts/cf-build.sh` |
| Deploy command | `npx cf deploy`          |
| Root directory | `/`                      |

Deploy command は `npx cf deploy` でなければならない。`npx wrangler deploy` は
`wrangler.config.ts`（バンドラ設定のみ）しか読まないので、バインディング無しでデプロイされる。

設定ファイル:

- `cloudflare.config.ts` — Worker 名、D1
  バインディング、cron、環境変数、カスタムドメイン。`id.kbn.one` はデプロイ時に
  DNS ごと適用される。workers.dev は無効にしてある（IdP が別ホストでも応答すると
  `iss` と食い違う。どのみち `RP_ID` が `kbn.one` なので workers.dev
  からパスキーは使えない）
- `wrangler.config.ts` — `#env` alias と assets ディレクトリ。この Worker は
  Vite プロジェクトではなく、`cf` がバンドルを wrangler
  に委ねるため、バンドラ向けの設定だけこちらに入る

デプロイ前の確認:

```sh
deno task build && deno task build:worker && npx cf deploy --dry-run
```

### ビルドの仕組み

ビルドコンテナには Deno が無いので、`scripts/cf-build.sh` がピン留めした Deno
を取得し、クライアント資産 (`main/bundled/`) と Worker バンドル
(`main/worker/worker.js`) を作る。どちらも生成物で、`.cloudflare/` も同様。

Worker のバンドルは `deno bundle` が作る。このリポジトリの JSR
指定子とワークスペースの import map を解決できるのは Deno だけなので。

### ランタイム差分は `#env` に集約

Deno と Workers で違う部分は `#env` alias
の裏の2ファイルだけにある。`main/server/env.deno.ts` は Deno KV
を使い、静的ファイルをディスクから配信する。`main/server/env.workers.ts` は D1
を使い、静的ファイルは Static Assets に任せる。バンドルは `#env`
を未解決のまま残し、`wrangler.config.ts` の alias が `env.workers.ts`
を供給する。

**`env.workers.ts` は `cloudflare:workers` と型以外を import してはいけない。**
この1ファイルだけは Deno ではなく esbuild が解決するので、`@kbn/` からの値
import は JSR 指定子に辿り着けず失敗する。バインディングをリポジトリに包むのは
`main/server/kv-backend.ts` の仕事。

`cloudflare:workers` は `main/server/deno.json` の import map で
`cloudflare-workers.shim.ts` に向けてあるので、`env.workers.ts` も `deno check`
/ `lint` / `fmt` の対象になる。shim は Workers ビルドからは参照されない（esbuild
が本物を解決する）。逆に Deno がバンドルするコードから `cloudflare:workers` を
import すると、shim の空オブジェクトが本番に入るので、してはいけない。

### モジュールスコープで I/O しない

Workers
はデプロイ時にトップレベルスコープを実行して検証し、その時点ではバインディングが付いていない。そもそもリクエスト外の
I/O も許されない。どちらに当たってもデプロイはエラー 10021 で拒否される。D1
への接続 (`lazyD1`)、署名鍵、Push
サービスはすべて初回使用時に解決している。モジュールスコープの `await`
や、モジュールスコープからリポジトリ・署名鍵に触れるコードを足さないこと。

環境変数をモジュールスコープで読むのは問題ない (`config.ts`)。Cloudflare
が示すパターンで、検証時に未定義でも既定値に落ちるだけで例外にならず、そのアイソレートは捨てられる。

### D1 のスキーマ

`kv` テーブルは最初のクエリの前に Worker 自身が作る（`kv/d1.ts` の
`lazyD1`）。スキーマは `IF NOT EXISTS`
で冪等なので、本番でもプレビューでも新しいデータベースでも同じに動く。

D1 には TTL が無いので、期限切れの行は cron (`scheduled`) で掃除する。読み取りは
`expires_at`
で既に除外しているので、掃除が遅れても容量を食うだけで正しさには影響しない。

### `RP_ID` は変更しない

`RP_ID` は `kbn.one` で、IdP 自身のホスト (`id.kbn.one`)
ではなく登録可能サフィックス。パスキーは作成時の RP ID
に紐づくので、変えると既存のパスキーが全て使えなくなり、戻しても復旧しない。

## 環境変数

本番の値は `cloudflare.config.ts` にある。読み取りは `main/server/config.ts`。

- `RP_ID` — WebAuthn の RP ID（ローカルの既定は `localhost`）
- `RP_NAME` — RP の表示名
- `IDP_ORIGIN` — この IdP 自身のオリジン。発行する JWT の
  `iss`（ローカルの既定は `http://localhost:3000`）
- `AUTHORIZE_WHITELIST` — RP
  の**ホスト名**のカンマ区切り。指定ホストとその**サブドメイン**を許可する（`/authorize`
  の redirect_uri・CORS・`/rp/notifications` 共通）。scheme/port は無視。full
  origin での指定も可（hostname に正規化）
- `PUSH_CONTACT` — VAPID の連絡先（例: `mailto:o@kbn.one`）
- `HOME_PORTAL_MCP_TOKEN` —
  フィードバックの報告先（ホームポータルのエージェント）の Bearer
  トークン。secret。無ければ D1 に保存するだけ

署名鍵とパスキーの署名用シークレットは環境変数ではなくストレージ（`secret/signing_key`、`passkey_sign_secret`）にあり、初回使用時に生成される。

## データ移行の記録

2026-10 に Deno Deploy (Deno KV) から Cloudflare (D1) に移行した。ツールは
`tools/migration/`、実行は GitHub Actions の `Migrate KV to D1`
workflow（手動実行のみ）。

- 移行元は読むだけで、インポートは冪等な upsert なので再実行できる
- 短命な状態（`dpop-session`、`dpop_jti`、`oauth`、`push:ratelimit`）は移さない。古いリプレイ防止・単回利用マーカーを持ち込むと、新しいトークンを拒否してしまう
- JSON で表せない値は報告して止まり、`--skip-unstorable`
  で明示的に落とす。実際の移行で該当したのは、旧実装の
  `passkey/challenge_signature/secret`（`Uint8Array`、現行コードは参照しない）1件だけ
- エクスポートには署名鍵が含まれるので、workflow はアーティファクトを残さず、SQL
  もディスクに書かない

## Project layout

```
/
├─ cloudflare.config.ts           # Cloudflare: Worker, bindings, cron, vars, domain
├─ wrangler.config.ts             # the bundler half, which cf hands to wrangler
├─ scripts/cf-build.sh            # Workers Builds build command
├─ main/                          # the ID provider
│  ├─ assets/                     # Tailwind/daisyUI input CSS
│  ├─ bundler/                    # client JS + CSS build
│  ├─ client/                     # page clientEntries (.tsx) + service worker
│  └─ server/                     # fetch-router + JSX controllers; worker.ts is the Workers entry
├─ kv/                            # KvRepo: D1, Deno KV, memory
├─ session-storage-kv/            # Remix SessionStorage adapter for KvRepo
├─ dpop-session-middleware/       # DPoP session middleware for fetch-router
├─ dpop/                          # @kuboon/dpop: DPoP keys and proofs
├─ passkeys/                      # @kuboon/passkeys: WebAuthn (Hono + fetch-router)
└─ tools/migration/               # the Deno KV → D1 migration
```

- `@kuboon/passkeys` は Hono 用 (`./hono`) と fetch-router 用 (`./remix`)
  のアダプタを持つ。IdP は後者を使う
- `@kuboon/dpop` はクライアント (`.`) とサーバ (`./server.ts`、`verifyDpopProof`
  など) を export する
