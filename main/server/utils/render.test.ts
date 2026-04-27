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

Deno.test("/me: /me.js is emitted in <head>, not in body", async () => {
  const raw = await html("/me");
  assertStringIncludes(headSection(raw), `src="/me.js"`);
  const body = bodyAfterHead(raw);
  if (body.includes(`src="/me.js"`)) {
    throw new Error("/me.js leaked into <body>");
  }
});
