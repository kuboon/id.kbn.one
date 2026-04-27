/**
 * Regression: page-specific module scripts must be emitted in `<head>`,
 * not inline in the page body. The frame runtime hands page bodies to the
 * client as `<template>` content, which marks any contained `<script>`
 * "already started" — so they never execute when moved into the live DOM.
 * Hoisting them to `<head>` is what makes them run on initial page load.
 */

import { assertStringIncludes } from "@std/assert";

import router from "../router.ts";

const html = async (path: string): Promise<string> => {
  const response = await router.fetch(
    new Request(`http://localhost${path}`, { method: "GET" }),
  );
  return await response.text();
};

const headSection = (raw: string): string =>
  raw.match(/<head>[\s\S]*?<\/head>/)?.[0] ?? "";

const bodyAfterHead = (raw: string): string => {
  const match = raw.match(/<\/head>([\s\S]*)/);
  return match ? match[1] : raw;
};

Deno.test("home: /index.js is emitted in <head>, not in body", async () => {
  const raw = await html("/");
  assertStringIncludes(headSection(raw), `src="/index.js"`);
  // The page body must not carry a duplicate inline tag — that copy ends
  // up inside the frame template and is silently dropped by the browser.
  const body = bodyAfterHead(raw);
  if (body.includes(`src="/index.js"`)) {
    throw new Error("/index.js leaked into <body>");
  }
});

Deno.test("/me: page body fully renders (no <template> inside the frame)", async () => {
  // The previous /me page used `<template id="credential-item-template">`
  // inside the page JSX so `me.ts` could clone DOM rows. renderToStream
  // truncates after a nested `<template>`, which silently dropped the
  // rest of the page body (including the dialogs and the delete-account
  // button). The clientEntry rewrite renders every row from JSX directly,
  // so the only `<template>` left in the response is the frame wrapper
  // the framework emits after `</html>`.
  const raw = await html("/me");
  const beforeFrameTemplate = raw.split(/<template id="[^"]+">/)[0] ?? raw;
  if (beforeFrameTemplate.includes("<template")) {
    throw new Error(
      "Unexpected <template> inside the page body — would truncate the SSR stream.",
    );
  }
  // The clientEntry wraps its render in <main>...</main>; if the stream
  // were truncated the closing </main> would be missing.
  const sentinel = "loading loading-spinner";
  if (!raw.includes(sentinel)) {
    throw new Error(`Loading shell missing — found:\n${raw.slice(-500)}`);
  }
});
