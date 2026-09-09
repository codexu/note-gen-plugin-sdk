# `create-notegen-plugin`

`create-notegen-plugin` is the small `npx` entry point for creating a NoteGen
plugin project. It delegates to the `create` command in
`@notegen/plugin-cli`.

> Its source is implemented in the NoteGen Plugin SDK repository, but the first
> npm release has not been published. `npx create-notegen-plugin` becomes
> available only after that release.

## Usage after the npm release

```bash
npx create-notegen-plugin my-plugin \
  --id com.example.my-plugin \
  --name "My Plugin"
```

Then install dependencies and build the development snapshot:

```bash
cd my-plugin
pnpm install
pnpm build
pnpm validate
```

Import the absolute path to `my-plugin/.notegen/package` from NoteGen desktop's
Settings → Plugins → Developer page.

## Use from an SDK source checkout

```bash
git clone https://github.com/codexu/note-gen-plugin-sdk.git
cd note-gen-plugin-sdk
pnpm install
pnpm build
node packages/create-notegen-plugin/dist/bin.js ../my-plugin \
  --id com.example.my-plugin \
  --name "My Plugin"
```

Before the npm release, do not use `--install`: the generated
`@notegen/plugin-api` and `@notegen/plugin-cli` dependencies are not available
from the registry. You may run the built source CLI directly instead:

```bash
node packages/plugin-cli/dist/bin.js build ../my-plugin
node packages/plugin-cli/dist/bin.js validate ../my-plugin/.notegen/package
```

## Options

```text
create-notegen-plugin <directory> [options]
```

| Option | Meaning |
| --- | --- |
| `--id <id>` | Reverse-domain plugin ID; prompted interactively and required with `--yes` |
| `--name <name>` | Plugin display name; the prompt offers the directory name as its default |
| `--description <text>` | Initial manifest description |
| `--template <name>` | `command` or `editor-statistics` |
| `--min-app-version <version>` | Oldest supported NoteGen version |
| `--api-version <range>` | Required plugin API range |
| `--package-manager <name>` | `pnpm` or `npm` |
| `--install` | Install dependencies after creating files |
| `--yes` | Disable prompts; `--id` is required and a missing name defaults from the directory |
| `--json` | Emit machine-readable success output and diagnostic errors |

Use a lowercase reverse-domain ID under a namespace you control. The
`app.notegen` namespace is reserved for NoteGen. The command refuses to
overwrite a non-empty directory. In automation, use `--id <id> --json` to
prevent prompts and receive one structured JSON document on stdout. When
`--install` is also used, package-manager logs are redirected to stderr.

## Generated project

```text
my-plugin/
├── .gitignore
├── package.json
├── plugin.json
├── tsconfig.json
└── src/
    └── main.ts
```

The generated `build` and `validate` scripts run TypeScript in strict, no-emit
mode before invoking `notegen-plugin`, so type errors cannot be hidden by the
bundler. The `pack` script creates the unsigned distribution archive. Choose
the `command` template for a minimal command contribution or `editor-statistics`
for an active-editor status-bar example.

For all build, package, signing, and verification commands, see
[`@notegen/plugin-cli`](../plugin-cli/README.md).
