/**
 * Document — the persistent HTML shell + content `<Frame>`.
 *
 * Direct page loads render the full document; clicks on links with
 * `rmx-target="content"` swap the frame body via the client runtime.
 */

import { Frame } from "@remix-run/component";
import { routes } from "../routes.ts";

type DocumentProps = {
  initialSrc: string;
};

const THEMES = [
  { value: "", label: "Auto" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "cupcake", label: "Cupcake" },
  { value: "synthwave", label: "Synthwave" },
  { value: "retro", label: "Retro" },
  { value: "dracula", label: "Dracula" },
  { value: "business", label: "Business" },
  { value: "nord", label: "Nord" },
  { value: "lofi", label: "Lo-Fi" },
] as const;

const THEME_SCRIPT = `
(function () {
  var root = document.documentElement;
  try {
    var saved = localStorage.getItem('theme');
    if (saved) root.setAttribute('data-theme', saved);
  } catch (e) {}
  document.addEventListener('click', function (e) {
    var btn = e.target.closest && e.target.closest('[data-theme-set]');
    if (!btn) return;
    var v = btn.getAttribute('data-theme-set');
    if (v) {
      root.setAttribute('data-theme', v);
      try { localStorage.setItem('theme', v); } catch (e) {}
    } else {
      root.removeAttribute('data-theme');
      try { localStorage.removeItem('theme'); } catch (e) {}
    }
    if (document.activeElement && document.activeElement.blur) {
      document.activeElement.blur();
    }
  });
})();
`;

export function Document() {
  return ({ initialSrc }: DocumentProps) => (
    <html lang="ja">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <meta name="theme-color" content="#1d4ed8" />
        <title>kbn.one ID</title>
        <link rel="icon" href="data:image/png;base64,iVBORw0KGgo=" />
        <link rel="manifest" href="/manifest.json" />
        <script innerHTML={THEME_SCRIPT}></script>
        <script async type="module" src="/mod.js"></script>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body class="min-h-screen bg-base-100 text-base-content">
        <header class="navbar bg-base-200 shadow-sm">
          <div class="navbar-start">
            <a
              class="btn btn-ghost text-xl"
              href={routes.home.href()}
              rmx-target="content"
            >
              kbn.one ID
            </a>
          </div>
          <nav class="navbar-end gap-2">
            <ul class="menu menu-horizontal px-1">
              <li>
                <a href={routes.home.href()} rmx-target="content">Sign in</a>
              </li>
              <li>
                <a href={routes.me.href()} rmx-target="content">Account</a>
              </li>
            </ul>
            <div class="dropdown dropdown-end">
              <div
                tabindex={0}
                role="button"
                class="btn btn-ghost btn-sm"
                aria-label="Theme"
              >
                Theme
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 20 20"
                  fill="currentColor"
                >
                  <path d="M5 7l5 5 5-5H5z" />
                </svg>
              </div>
              <ul
                tabindex={0}
                class="dropdown-content menu bg-base-100 rounded-box z-10 w-44 p-2 shadow"
              >
                {THEMES.map(({ value, label }) => (
                  <li>
                    <button type="button" data-theme-set={value}>
                      {label}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </nav>
        </header>
        <Frame
          name="content"
          src={initialSrc}
          fallback={
            <main class="mx-auto w-full max-w-3xl p-8">
              <p>Loading…</p>
            </main>
          }
        />
      </body>
    </html>
  );
}
