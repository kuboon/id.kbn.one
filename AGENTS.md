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

## Do not use `-A` flag

For security reasons, do not use the `-A` (allow all) flag with Deno. Try
minimizing permissions by specifying only the necessary ones for your
application. Test should be run with `deno test -P` to use permissions defined
in `deno.json`. If new test needs additional permissions, update the test
permission in `deno.json`. see
https://github.com/denoland/deno/blob/main/cli/schemas/config-file.v1.json

## run `deno task test` after your jobs

If returns error, fix them.

## Deno library imports

- use standard library from jsr, not deno.land
- do not import from `npm:` or `jsr:`, `https://` directly.
  - run `deno add jsr:@std/foo` first, then you can write
    `import { foo } from "@std/foo;`

## jsr

to get jsr sources, for example `jsr:@luca/flag@1.0.0`, run
`curl https://jsr.io/@luca/flag/1.0.0/main.ts` Or get cache via this script
https://gist.github.com/kuboon/305e07ca14f9444e897b857e9a85b8be

# Python (or Perl, optional)

If you need Python, activate it via mise and then execute commands the same way:

```bash
mise use python
mise exec -- python path/to/script.py
```

# General instructions

- Do not add comments what you did like "// displayName inputs removed"

## Hono Development

Use the `hono` CLI for efficient development. View all commands with
`hono --help`.

### Core Commands

- **`hono docs [path]`** - Browse Hono documentation
- **`hono search <query>`** - Search documentation
- **`hono request [file]`** - Test app requests without starting a server

### Quick Examples

```bash
# Search for topics
hono search middleware
hono search "getting started"

# View documentation
hono docs /docs/api/context
hono docs /docs/guides/middleware

# Test your app
hono request -P /api/users src/index.ts
hono request -P /api/users -X POST -d '{"name":"Alice"}' src/index.ts
```

### Workflow

1. Search documentation: `hono search <query>`
2. Read relevant docs: `hono docs [path]`
3. Test implementation: `hono request [file]`
