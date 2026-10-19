#!/bin/sh
# Build command for Cloudflare Workers Builds.
#
# Its build container has Node, not Deno, and this project is a Deno
# workspace: the client bundler is a Deno task, and the Worker bundle has to
# be produced by `deno bundle`, which is the only thing that resolves this
# repo's JSR specifiers and workspace import maps. So fetch a pinned Deno
# first, then run the two builds.
#
# Produces what wrangler.jsonc expects:
#   main/bundled/     client assets, served by Workers Static Assets
#   main/worker/      the Worker bundle named by `main`
#
# Set as the build command in the Workers Builds settings; see README.
set -eu

DENO_VERSION=v2.9.7
DENO_DIR_BIN=/tmp/deno/bin

if ! command -v deno >/dev/null 2>&1; then
  echo "installing deno $DENO_VERSION"
  # The release archive rather than install.sh: one URL, one version, no
  # installer behaviour to depend on inside someone else's CI image.
  curl -fsSL -o /tmp/deno.zip \
    "https://github.com/denoland/deno/releases/download/${DENO_VERSION}/deno-x86_64-unknown-linux-gnu.zip"
  mkdir -p "$DENO_DIR_BIN"
  unzip -oq /tmp/deno.zip -d "$DENO_DIR_BIN"
  chmod +x "$DENO_DIR_BIN/deno"
  PATH="$DENO_DIR_BIN:$PATH"
  export PATH
fi

deno --version

# Fail the build rather than resolve something the lockfile does not name.
deno install --frozen

deno task build
deno task build:worker

echo "built:"
ls -1 main/bundled | sed 's/^/  main\/bundled\//'
ls -1 main/worker | sed 's/^/  main\/worker\//'
