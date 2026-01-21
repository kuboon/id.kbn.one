# If `deno` not found, use `mise`

Use [mise](https://mise.jdx.dev/) to manage tool versions. The steps below show
how to work with the configured runtimes.

## install mise

`curl https://mise.run | sh`

Ensure the configured tools are installed:

```bash
mise install
```

# Deno

Run any Deno command through mise so the pinned version is used. Examples:

```bash
mise exec -- deno check
mise exec -- deno task dev
mise exec -- deno run --allow-env --allow-net server/src/index.ts
```

## Do not use `-A` flag

For security reasons, do not use the `-A` (allow all) flag with Deno. Try
minimizing permissions by specifying only the necessary ones for your
application. Test should be run with `deno test -P` to use permissions defined
in `deno.json`. If new test needs additional permissions, update the test
permission in `deno.json`. see
https://github.com/denoland/deno/blob/main/cli/schemas/config-file.v1.json

## Python (or Perl, optional)

If you need Python, activate it via mise and then execute commands the same way:

```bash
mise use python
mise exec -- python path/to/script.py
```

# run `deno fmt && deno lint && && deno check && deno test -P` after your jobs

If returns error, fix them.

# Deno library imports

- use standard library from jsr, not deno.land
- do not import from `npm:` or `jsr:`, `https://` directly.
  - run `deno add jsr:@std/foo` first, then you can write
    `import { foo } from "@std/foo;`

# jsr

to get jsr sources, for example `jsr:@luca/flag@1.0.0`, run
`curl https://jsr.io/@luca/flag/1.0.0/main.ts`

# General instructions

- Do not add comments what you did like "// displayName inputs removed"
