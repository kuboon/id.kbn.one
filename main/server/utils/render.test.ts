/**
 * Regression: page bodies must not contain a nested `<template>` element.
 * `renderToStream` truncates the stream after one (see fail.tsx for a
 * minimal repro), so the previous /me page silently dropped its dialogs
 * and delete-account button when it carried a
 * `<template id="credential-item-template">` for cloning credential rows.
 *
 * Each page is now a clientEntry; assert that the rendered HTML body
 * carries no extra `<template>` beyond the framework's own frame wrapper
 * and that the loading shell streams to completion.
 */

import router from "../router.ts";

const html = async (path: string): Promise<string> => {
  const response = await router.fetch(
    new Request(`http://localhost${path}`, { method: "GET" }),
  );
  return await response.text();
};

const beforeFirstFrameTemplate = (raw: string): string =>
  raw.split(/<template id="[^"]+">/)[0] ?? raw;

const assertNoBodyTemplate = (path: string, raw: string) => {
  if (beforeFirstFrameTemplate(raw).includes("<template")) {
    throw new Error(
      `${path}: unexpected <template> inside body — would truncate the SSR stream.`,
    );
  }
};

Deno.test("/: renders without nested <template>", async () => {
  const raw = await html("/");
  assertNoBodyTemplate("/", raw);
  if (!raw.includes("kbn.one ID")) {
    throw new Error("/ : loading shell missing");
  }
});

Deno.test("/me: renders without nested <template>", async () => {
  const raw = await html("/me");
  assertNoBodyTemplate("/me", raw);
  if (!raw.includes("loading loading-spinner")) {
    throw new Error("/me: loading shell missing");
  }
});
