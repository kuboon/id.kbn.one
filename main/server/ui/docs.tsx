/**
 * The page for RP developers (`/docs`): how to sign users in through this
 * IdP, verify what it issues, send push notifications and feedback, and use
 * it as an MCP authorization server.
 *
 * Server-rendered and static — no clientEntry. Examples are written against
 * `idpOrigin`, so a local server shows URLs that work against it.
 */

import type { Handle, RemixNode } from "@remix-run/ui";

type DocsProps = {
  idpOrigin: string;
};

const h2 = (id: string, title: string) => (
  <h2 id={id} class="mt-12 mb-4 scroll-mt-4 text-2xl font-bold">
    <a href={`#${id}`} class="hover:underline">{title}</a>
  </h2>
);

const h3 = (title: string) => (
  <h3 class="mt-8 mb-3 text-lg font-semibold">{title}</h3>
);

const p = (...children: RemixNode[]) => (
  <p class="my-3 leading-relaxed">{children}</p>
);

const ul = (...items: RemixNode[]) => (
  <ul class="my-3 list-disc space-y-1 pl-6 leading-relaxed">
    {items.map((item, i) => <li key={i}>{item}</li>)}
  </ul>
);

const ol = (...items: RemixNode[]) => (
  <ol class="my-3 list-decimal space-y-1 pl-6 leading-relaxed">
    {items.map((item, i) => <li key={i}>{item}</li>)}
  </ol>
);

const code = (source: string) => (
  <pre class="my-4 overflow-x-auto rounded-box bg-base-200 p-4 text-sm"><code>{source.trim()}</code></pre>
);

const rfc = (n: number) => (
  <a class="link" href={`https://www.rfc-editor.org/rfc/rfc${n}`}>RFC {n}</a>
);

const TOC = [
  ["start", "はじめに"],
  ["client", "RP クライアント"],
  ["signin", "サインインの流れ"],
  ["jwt", "発行される JWT と検証"],
  ["push", "Push 通知"],
  ["feedback", "フィードバック"],
  ["mcp", "MCP 認可サーバ (OAuth 2.1)"],
] as const;

export function Docs(handle: Handle<DocsProps>) {
  return () => {
    const o = handle.props.idpOrigin;
    return (
      <main class="mx-auto w-full max-w-3xl px-4 py-8 sm:px-8">
        <h1 class="text-3xl font-bold">RP 開発者向けドキュメント</h1>
        <p class="mt-2 opacity-70">
          この IdP (<code>{o}</code>) を使うサービス (Relying Party, RP)
          のためのリファレンス。
        </p>

        <nav class="my-6 rounded-box bg-base-200 p-4" aria-label="目次">
          <ul class="space-y-1">
            {TOC.map(([id, title]) => (
              <li>
                <a class="link" href={`#${id}`}>{title}</a>
              </li>
            ))}
          </ul>
        </nav>

        {h2("start", "はじめに")}
        {p(
          "パスキー認証はこの IdP に集約されている。RP はブラウザに DPoP 鍵 (",
          rfc(9449),
          ") を持ち、IdP のセッションをその鍵の thumbprint (jkt) に結びつけてもらう。RP が受け取るのは、ユーザー ID と ES256 署名の JWT。ほかに Web Push の配信、ユーザーからのフィードバック受付、remote MCP サーバ向けの OAuth 2.1 認可サーバを提供する。",
        )}
        {p(
          <strong>
            RP のホスト名が IdP の許可リストに入っている必要がある。
          </strong>,
          " 指定したホストとそのサブドメインが許可され、",
          <code>/authorize</code>,
          " の ",
          <code>redirect_uri</code>,
          "、CORS、",
          <code>/rp/notifications</code>,
          " のすべてがこれで判定される (scheme と port は見ない)。追加は IdP の運用者に依頼する。",
        )}

        {h2("client", "RP クライアント")}
        {p(
          "ブラウザ側は ",
          <code>{`${o}/rp.js`}</code>,
          " の ",
          <code>createRpClient</code>,
          " を使うのが早い。DPoP 鍵の生成と IndexedDB への保存、",
          <code>/authorize</code>,
          " への遷移、セッション取得、Push 購読の登録、フィードバック送信をまとめてある。",
        )}
        {code(`
import { createRpClient } from "${o}/rp.js";

const rp = await createRpClient({ idpOrigin: "${o}" });

const session = await rp.getSession();
if (!session) rp.signIn(); // IdP へ遷移し、サインイン後にこのページへ戻る
// session.userId, session.jws
`)}
        {ul(
          <>
            <code>signIn({"{ redirectUri? }"})</code> — IdP の{" "}
            <code>/authorize</code> へ遷移する。戻り先の既定は{" "}
            <code>location.href</code>
          </>,
          <>
            <code>getSession()</code> — <code>{"{ userId, jws }"}</code>
            。まだ結びついていなければ <code>null</code>
          </>,
          <>
            <code>signOut()</code> — この DPoP 鍵に結びついたセッションを消す
          </>,
          <>
            <code>registerPush({"{ serviceWorkerUrl?, metadata? }"})</code>{" "}
            — 通知の許可を求め、この端末の購読を IdP に登録する
          </>,
          <>
            <code>sendFeedback({"{ kind, message, pageUrl? }"})</code> —{" "}
            <a class="link" href="#feedback">フィードバック</a>を送る
          </>,
          <>
            <code>fetchDpop</code>{" "}
            — 上にない IdP のエンドポイントを呼ぶための DPoP 付き{" "}
            <code>fetch</code>。<code>thumbprint</code>{" "}
            はこの RP の DPoP 公開鍵の jkt
          </>,
        )}
        {p(
          "DPoP 鍵は IndexedDB に残るので、ページを移動しても同じセッションが続く。",
        )}

        {h2("signin", "サインインの流れ")}
        {p("RP クライアントの中で起きていることは次のとおり。")}
        {ol(
          <>
            RP のブラウザが DPoP 鍵ペアを作り (IndexedDB に保存)、jkt を計算する
          </>,
          <>
            RP が{" "}
            <code>
              {`${o}/authorize?dpop_jkt=<jkt>&redirect_uri=<戻り先>`}
            </code>{" "}
            へ遷移する。<code>redirect_uri</code>{" "}
            のホストは許可リストに入っている必要がある
          </>,
          <>
            IdP は未サインインならパスキー認証 (サインイン / 登録)
            を行い、自分のセッションを RP の jkt に結びつける
          </>,
          <>
            ブラウザが <code>redirect_uri</code> に戻る
          </>,
          <>
            RP のブラウザが DPoP proof を付けて <code>GET {o}/session</code>
            {" "}
            を呼ぶと <code>{"{ userId, jws }"}</code>{" "}
            が返る。proof の jkt が結びつけ済みなので、IdP
            はこのブラウザのセッションだと分かる
          </>,
        )}
        {p(
          <code>POST /session/logout</code>,
          " でセッションを消せる。どちらも CORS で RP から呼べる。",
        )}

        {h2("jwt", "発行される JWT と検証")}
        {p(
          <code>jws</code>,
          " は ES256 署名の compact JWS (",
          rfc(7515),
          " / ",
          rfc(7519),
          ")。クレームは次のとおり。",
        )}
        {ul(
          <>
            <code>iss</code>: <code>{o}</code>
          </>,
          <>
            <code>sub</code>: ユーザー ID
          </>,
          <>
            <code>nbf</code>, <code>exp</code>, <code>jti</code>
          </>,
          <>
            <code>cnf.jkt</code>: RP の DPoP 鍵の thumbprint (DPoP binding,{" "}
            {rfc(9449)})
          </>,
        )}
        {p(
          "公開鍵は JWKS (",
          rfc(7517),
          ") として ",
          <code>{`${o}/.well-known/jwks.json`}</code>,
          " で配っている。",
          <code>jose</code>,
          " なら取得とキャッシュまで任せられる。",
        )}
        {code(`
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(new URL("${o}/.well-known/jwks.json"));

const { payload } = await jwtVerify(jws, JWKS, { issuer: "${o}" });
// payload.sub === userId
// payload.cnf.jkt が自分の DPoP 鍵の thumbprint と一致するかは別途確かめる
`)}
        {p(
          <code>jwtVerify</code>,
          " は署名と ",
          <code>iss</code>,
          " / ",
          <code>exp</code>,
          " / ",
          <code>nbf</code>,
          " をまとめて検証する。",
          <code>cnf.jkt</code>,
          " の照合だけは呼び出し側で行う。鍵はヘッダの ",
          <code>kid</code>,
          " (RFC 7638 thumbprint) で JWKS から選ばれるので、鍵の切り替え中も新旧どちらで署名されたものも検証できる。",
        )}

        {h2("push", "Push 通知")}
        {p(
          <strong>通知を送るのは常に RP のサーバ</strong>,
          " (",
          <code>POST /rp/notifications</code>,
          ")。ブラウザから送るエンドポイントは無い。ブラウザ側の ",
          <code>/push/*</code>,
          " は購読の管理だけを受け持つ。",
        )}

        {h3("ブラウザ側: 購読の管理")}
        {p(
          "ふつうは RP クライアントの ",
          <code>registerPush</code>,
          " で足りる。個別に呼ぶ場合のエンドポイントは次のとおりで、どれも DPoP セッションで認証し、CORS で RP から呼べる。",
        )}
        {ul(
          <>
            <code>GET /push/vapid-key</code> — VAPID 公開鍵
          </>,
          <>
            <code>GET /push/subscriptions</code>{" "}
            — 購読の一覧。返るのは、呼び出し元 RP のドメイン (サブドメイン含む)
            から登録された購読だけ
          </>,
          <>
            <code>POST /push/subscriptions</code>,{" "}
            <code>PATCH /push/subscriptions/:id</code>,{" "}
            <code>DELETE /push/subscriptions/:id</code>
          </>,
          <>
            <code>POST /push/notifications/test</code> — その端末へのテスト通知
          </>,
        )}

        {h3("サーバ側: 通知を送る")}
        {p(
          "RP のサーバは DPoP セッションを持たないので、",
          <code>private_key_jwt</code>,
          " のクライアントアサーション (",
          rfc(7521),
          " / ",
          rfc(7523),
          ") で認証する。共有の秘密は要らない。RP の ",
          <code>clientId</code>,
          " はその RP のオリジンで、IdP は検証鍵を ",
          <code>{"${clientId}/.well-known/jwks.json"}</code>,
          " から取得する。鍵を替えるときは RP が自分の JWKS を更新するだけでよい。事前の登録は無く、オリジンが許可リストに入っていれば通る。",
        )}
        {code(`
import { SignJWT } from "jose";

// privateKey: RP の ES256 秘密鍵 (CryptoKey)。kid は RP の JWKS と合わせる
const now = Math.floor(Date.now() / 1000);
const assertion = await new SignJWT({})
  .setProtectedHeader({ alg: "ES256", typ: "client-assertion+jwt", kid })
  .setIssuer("https://rp.example.com") // = clientId (RP のオリジン)
  .setSubject("https://rp.example.com") // = clientId
  .setAudience("${o}")
  .setIssuedAt(now)
  .setExpirationTime(now + 60)
  .setJti(crypto.randomUUID()) // 一度しか使えない (リプレイ防止)
  .sign(privateKey);

const res = await fetch("${o}/rp/notifications", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: \`Bearer \${assertion}\`,
  },
  body: JSON.stringify({
    // 宛先のユーザー (1人以上)。各ユーザーの、条件を満たす全端末に届く
    userIds: ["user-1", "user-2"],
    notification: {
      title: "Hi",
      body: "Notification from RP server",
      badgeCount: 3, // 任意: アプリアイコンのバッジ (後述)
    },
  }),
});
// → { results: [{ userId, subscriptionId, ok, throttled, removed, warnings }
//               | { userId, subscriptionId, ok: false, error }] }
`)}

        {h3("届く先は RP 自身のドメインから登録された端末だけ")}
        {p(
          "購読には、登録したときの ",
          <code>Origin</code>,
          " ヘッダが記録される。ブラウザが付けるもので、ページの JS からは偽れない。",
          <code>/rp/notifications</code>,
          " が宛先にするのは、認証された RP のドメインとそのサブドメインから登録された購読だけ (ホスト名で比較し、scheme と port は見ない)。ほかの RP から登録された端末には届かない。",
        )}
        {p(
          "宛先になる端末は 1 リクエストにつき最大 500。それを超えるならリクエストを分ける。",
        )}

        {h3("レート制限")}
        {p(
          "1 つの購読に届くのは ",
          <strong>60 秒に 1 件</strong>,
          " まで。RP からの送信にもテスト通知にも共通で、超えた分はエラーにせず送らない。そのときは結果の該当エントリに ",
          <code>throttled: true</code>,
          " が付く。",
        )}

        {h3("アプリアイコンのバッジ (notification.badgeCount)")}
        {p(
          <code>notification.badgeCount</code>,
          " (任意、0 以上の整数) を付けると、Service Worker が ",
          <a
            class="link"
            href="https://developer.mozilla.org/docs/Web/API/Badging_API"
          >
            App Badging API
          </a>,
          " でアプリアイコンに数字を出す。",
          <code>0</code>,
          " で消える。省略すれば今のバッジには触らないので、増減と消すタイミングは RP が値で決める。",
        )}
        {p(
          "表示されるのはインストール済みの PWA だけで、ブラウザのタブでは出ない。Chrome / Edge (デスクトップと Android) と、macOS / iOS 16.4 以降の Safari のホーム画面アプリが対応している。それ以外では何も起きない。なお ",
          <code>badge</code>,
          " (画像 URL) は通知そのものに出す小さな画像で、別物。",
        )}

        {h2("feedback", "フィードバック")}
        {p(
          "RP の画面から、サインイン中のユーザーが IdP の運用者にバグ報告や要望を送れる。RP 側で一覧を見たり返信したりする仕組みは無い。",
        )}
        {code(`
const rp = await createRpClient({ idpOrigin: "${o}" });
await rp.sendFeedback({ kind: "bug", message: "保存ボタンが反応しない" });
`)}
        {p(
          "中身は DPoP セッションで認証した ",
          <code>POST /feedback</code>,
          " で、本文は次の 3 つだけ。",
        )}
        {ul(
          <>
            <code>kind</code> — <code>"bug"</code> / <code>"request"</code> /
            {" "}
            <code>"other"</code>
          </>,
          <>
            <code>message</code> — 本文。4000 文字まで
          </>,
          <>
            <code>pageUrl</code> — 任意。送ったときのページ (http(s) の URL)。
            <code>sendFeedback</code> は省略すると <code>location.href</code>
            {" "}
            を入れる
          </>,
        )}
        {p(
          "誰がどの RP から送ったかは本文から取らない。送信者は DPoP セッションのユーザー、送信元は ",
          <code>Origin</code>,
          " ヘッダから IdP が記録する。",
        )}
        {p(
          "応答は ",
          <code>{"201 { id }"}</code>,
          "。本文が不正なら ",
          <code>400</code>,
          "、サインインしていなければ ",
          <code>401</code>,
          "。",
          <strong>1 ユーザーにつき 1 時間に 5 件</strong>,
          " までで、超えると ",
          <code>429</code>,
          "。",
        )}

        {h2("mcp", "MCP 認可サーバ (OAuth 2.1)")}
        {p(
          "別ドメインの remote MCP サーバ (OAuth のリソースサーバ) は、この IdP を OAuth 2.1 の認可サーバとして使える。ログインはパスキーで行う。",
        )}
        {p(
          "クライアントの識別は DCR ではなく CIMD (Client ID Metadata Document)。",
          <code>client_id</code>,
          " はクライアント自身が公開する HTTPS のメタデータ URL で、IdP がそれを取得して検証する。事前の登録は要らない。",
        )}
        {p(
          "認可コード・アクセストークン・リフレッシュトークンはどれも ES256 署名の JWT。リフレッシュトークンは使うたびに替わり、使用済みのものが再び使われると検知する。アクセストークンの ",
          <code>aud</code>,
          " は対象の MCP サーバに束縛される (",
          rfc(8707),
          ")。",
        )}
        {h3("エンドポイント")}
        {ul(
          <>
            <code>GET /.well-known/oauth-authorization-server</code>{" "}
            — メタデータ ({rfc(8414)})
          </>,
          <>
            <code>GET /oauth/authorize</code> —{" "}
            <code>response_type=code</code>、PKCE (<code>S256</code>)、
            <code>resource</code>{" "}
            ({rfc(8707)}) を検証し、CIMD でクライアントを解決して{" "}
            <code>redirect_uri</code>{" "}
            を照合する。パスキーでのログインと同意のあと、認可コードを{" "}
            <code>redirect_uri?code&state</code> へ返す
          </>,
          <>
            <code>POST /oauth/token</code> — <code>authorization_code</code>
            {" "}
            (PKCE S256) と <code>refresh_token</code>
          </>,
        )}
        {p("MCP クライアントの認可リクエストの例:")}
        {code(`
${o}/oauth/authorize?response_type=code
  &client_id=<CIMD URL>
  &redirect_uri=<callback>
  &code_challenge=<S256>&code_challenge_method=S256
  &resource=https://mcp.example.com
  &scope=mcp
  &state=<state>
`)}
        {h3("MCP サーバ側で実装するもの")}
        {ul(
          <>
            <code>/.well-known/oauth-protected-resource</code> ({rfc(9728)}).
            {" "}
            <code>authorization_servers</code>{" "}
            にこの IdP (<code>{o}</code>) を載せる
          </>,
          <>
            401 を返すときの <code>WWW-Authenticate</code> ヘッダ
          </>,
          <>Bearer トークンの検証 (下記)</>,
        )}
        {code(`
import { createRemoteJWKSet, jwtVerify } from "jose";

const JWKS = createRemoteJWKSet(new URL("${o}/.well-known/jwks.json"));

const { payload } = await jwtVerify(bearer, JWKS, {
  issuer: "${o}",
  audience: "https://mcp.example.com", // この MCP サーバの識別子
});
// payload.sub = userId, payload.scope など
`)}
      </main>
    );
  };
}
