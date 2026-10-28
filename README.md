# id.kbn.one

Passkeys and Web Push ready ID provider. 本番は https://id.kbn.one 。

パスキー認証を IdP に集約し、RP には DPoP 鍵に束縛したセッションと ES256 署名の
JWT を渡す。Web Push の配信と、remote MCP サーバ向けの OAuth 2.1
認可サーバも持つ。Cloudflare Workers と D1 で動き、開発・テスト・ビルドは Deno
で行う。

この README はこの IdP を動かす側（開発・デプロイ・運用）のためのもの。RP
として使う側の情報（サインインの流れ、JWT の検証、Push 通知、フィードバック、MCP
認可サーバ）はサイトの [/docs](https://id.kbn.one/docs) にある。中身は
`main/server/ui/docs.tsx`。

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

## フィードバックの報告先

RP のユーザーが送ったバグ報告・要望（`POST /feedback`、送り方は
[/docs#feedback](https://id.kbn.one/docs#feedback)）は、D1
に保存したうえで運用者のホームポータル (home.kbn.one) に投稿される。

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
