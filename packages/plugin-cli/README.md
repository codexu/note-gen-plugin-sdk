# `@notegen/plugin-cli`

## Offline usage guides

Place `USAGE.md` in the plugin project root, beside `plugin.json`. Add localized
guides such as `USAGE.zh-CN.md` as needed. `notegen-plugin build` automatically
includes these files in `.notegen/package` and its integrity manifest; source
validation also checks them. No new manifest field is required.

Each guide must be UTF-8 Markdown, at most 128 KiB. Up to 50 guide files are
accepted. Locale suffixes use a language tag, for example `en` or `zh-CN`.
The host tries the exact language tag, its base language, then `USAGE.md`.
Write the default guide in English when supporting a mixed-language audience.

Explain the visible entry point, first-use steps, defaults, permissions, and
common problems. Keep developer setup instructions in `README.md` instead.
The current viewer renders Markdown text without raw HTML, image loading, or
link navigation. Guides are available offline without activating plugin code.
An explicit action button invokes a declared entry command only after the user
clicks it and the plugin is enabled. Never put executable onboarding in a guide.

Rebuild the CLI before using these changes from a source checkout, then rebuild
and reimport the plugin to include its guides. Older packages without guides
remain usable and display a missing-guide message.

## Watch mode

Use `notegen-plugin dev [directory]` for watch mode. It polls source changes,
serially builds, and replaces `.notegen/package` only after a successful build
and package validation. In NoteGen Developer Mode, import and enable that
directory and opt into Auto-reload for the plugin. Permission expansions still
require review. This rebuilds the runtime, not state-preserving hot replacement.
Watch mode does not run type checks or tests. Project-external dependencies and
ignored output/node_modules directories require restarting the watcher.

`@notegen/plugin-cli` is the official command-line tool for creating,
validating, building, packaging, signing, and verifying NoteGen plugins.

> The package source is implemented in the NoteGen Plugin SDK repository, but
> its first npm release has not been published. The installation commands below
> become available after that release. Until then, build the SDK workspace and
> run `node packages/plugin-cli/dist/bin.js` from its checkout.

## Requirements

- Node.js 20 or newer
- A plugin with a version 1 `plugin.json`
- One TypeScript or JavaScript source entry for `build`

After the npm release, install the CLI in a plugin project:

```bash
pnpm add -D @notegen/plugin-cli
pnpm exec notegen-plugin --help
```

From an SDK source checkout:

```bash
pnpm install
pnpm build
node packages/plugin-cli/dist/bin.js --help
```

The examples below use `notegen-plugin`. Substitute
`node /absolute/path/to/note-gen-plugin-sdk/packages/plugin-cli/dist/bin.js`
when running from source.

## Standard workflow

From the plugin project root:

```bash
notegen-plugin validate
notegen-plugin build
notegen-plugin validate .notegen/package
```

`build` bundles the configured source into one self-contained JavaScript ESM
entry, copies the manifest and declared locale files, generates
`integrity.json`, validates the complete payload, and replaces
`.notegen/package` atomically. Import the absolute path to this directory from
NoteGen's Developer page.

Projects created by this SDK run `tsc -p tsconfig.json --noEmit` before this
command. If you maintain a project by hand, keep the same type-check step in
your package script; the bundler itself is not a TypeScript type checker.

To prepare a release artifact:

```bash
notegen-plugin pack
notegen-plugin sign \
  .notegen/releases/com.example.my-plugin-0.1.0.unsigned.notegen-plugin \
  --private-key /secure/path/publisher-private.pem
notegen-plugin verify \
  .notegen/releases/com.example.my-plugin-0.1.0.notegen-plugin \
  --public-key ./publisher-public.json \
  --require-signature
```

The default artifacts are:

```text
.notegen/package/
.notegen/releases/<id>-<version>.unsigned.notegen-plugin
.notegen/releases/<id>-<version>.notegen-plugin
```

`pack` does not accept or read private keys. `sign` reads an already-built
unsigned archive, validates it, adds `signature.sig`, and writes the final
`.notegen-plugin`; it never reads or builds a source project. Keep those stages
separate when signing on an isolated machine.

## Commands

### `create`

```text
notegen-plugin create <directory> [options]
```

Creates a new project and refuses to overwrite a non-empty directory.

| Option | Meaning |
| --- | --- |
| `--id <id>` | Reverse-domain plugin ID; prompted in an interactive terminal and required with `--yes` |
| `--name <name>` | Display name; an interactive prompt offers the directory name as its default |
| `--description <text>` | Initial manifest description |
| `--template <name>` | `command` or `editor-statistics` |
| `--min-app-version <version>` | Oldest supported NoteGen version |
| `--api-version <range>` | Required plugin API range |
| `--package-manager <name>` | `pnpm` or `npm` |
| `--install` | Run the selected package manager after creation |
| `--yes` | Disable prompts; `--id` is required and a missing name defaults from the directory |
| `--json` | Emit machine-readable success output and diagnostic errors |

Use a lowercase reverse-domain ID that you control, such as
`com.example.my-plugin`. The `app.notegen` namespace is reserved for NoteGen
host internals and remains unavailable to official marketplace plugins.
Dependency installation is opt-in so that project creation does not silently execute
package-manager lifecycle behavior.

`--json` also disables interactive prompts: provide `--id`, while an omitted
name is derived from the directory. If `--install` is combined with `--json`,
package-manager logs go to stderr and the CLI keeps stdout as one JSON document.

For the shorter scaffold entry point, see
[`create-notegen-plugin`](../create-notegen-plugin/README.md).

### `validate`

```text
notegen-plugin validate [path] [options]
```

Runs the validation applicable to a source project, built development directory,
or package archive. It accepts unsigned development input by default.
For a source project, preflight parses every declared locale resource and checks
that the default locale contains every contribution key. It validates the source
entry separately and does not require the configured built `.js` entry to exist
before `build` creates it.

| Option | Meaning |
| --- | --- |
| `--api-version <version>` | Check against a specific host API version |
| `--app-version <version>` | Check against a specific NoteGen version |
| `--public-key <file>` | Verify an embedded signature with a publisher public-key JSON file |
| `--require-signature` | Reject input without `signature.sig` |
| `--json` | Emit machine-readable diagnostics |

Use `validate` for project preflight and development output. Use `verify` when
you specifically want to inspect a complete directory or archive without
executing it.

If `--app-version` is omitted, the manifest is still validated but its
`minAppVersion` is not compared with a concrete NoteGen release. Text output
states that explicitly, and JSON output sets `appCompatibilityChecked` to
`false`. Release automation should always pass the target app version.

### `build`

```text
notegen-plugin build [directory] [options]
```

Builds a source project and always writes `.notegen/package` below that project.
The source path defaults to `src/main.ts` and may be set as
`package.json#notegen.source`.

| Option | Meaning |
| --- | --- |
| `--api-version <version>` | Check the built plugin against a host API version |
| `--app-version <version>` | Check the built plugin against a NoteGen version |
| `--json` | Emit machine-readable output |

The bundle must export a named `activate` function. Residual relative, package,
remote, or dynamic imports are rejected because the NoteGen runtime does not
resolve modules for a plugin.

### `pack`

```text
notegen-plugin pack [directory] [options]
```

Builds and validates a plugin project, then writes a deterministic unsigned ZIP
archive. Its default output is
`.notegen/releases/<id>-<version>.unsigned.notegen-plugin`.

| Option | Meaning |
| --- | --- |
| `--output <file>` | Select the unsigned archive path |
| `--force` | Replace the exact output file if it already exists |
| `--api-version <version>` | Check against a host API version |
| `--app-version <version>` | Check against a NoteGen version |
| `--json` | Emit machine-readable output |

`pack` never reads a private key and never produces a signed marketplace
artifact.

### `keygen`

```text
notegen-plugin keygen [options]
```

Generates an Ed25519 publisher key pair. The private key is PKCS#8 PEM; the
public JSON contains the raw 32-byte public key encoded as Base64. Choose
explicit destinations when integrating with a release process:

```bash
notegen-plugin keygen \
  --private-key /secure/path/publisher-private.pem \
  --public-key ./publisher-public.json
```

| Option | Meaning |
| --- | --- |
| `--output <directory>` | Base directory for default key filenames |
| `--private-key <file>` | Private PEM destination |
| `--public-key <file>` | Public JSON destination |
| `--passphrase-env <name>` | Encrypt or read the private key with a passphrase from this environment variable |
| `--force` | Replace the exact selected key files |
| `--json` | Emit machine-readable output; private key material is never printed |

Store the private key outside source control, synced note folders, and public CI
artifacts. Back it up offline. The public JSON is safe to publish and is the file
passed to `verify`; marketplace key registration will be documented only when
submissions open.

The two key files are staged and published as a recoverable pair. When replacing
an existing pair with `--force`, the CLI keeps both previous files until both new
files are active and rolls back the pair if publication fails.

This command creates publisher keys only. It cannot create the NoteGen
marketplace root key, sign a marketplace index, or register a publisher.

### `sign`

```text
notegen-plugin sign <unsigned-archive> --private-key <pem> [options]
```

Validates and signs an unsigned archive, embeds `signature.sig`, and writes a
final `.notegen-plugin`. The signed documents use RFC 8785 JCS before NoteGen's
length-framed Ed25519 signature message is created.

| Option | Meaning |
| --- | --- |
| `--output <file>` | Select the final archive path |
| `--passphrase-env <name>` | Read the private-key passphrase from this environment variable |
| `--force` | Replace the exact output file if it already exists |
| `--api-version <version>` | Check against a host API version |
| `--app-version <version>` | Check against a NoteGen version |
| `--json` | Emit machine-readable output |

`sign` accepts only an already-built archive. It does not scan, install, or
build source code. Do not put the private key or its passphrase in a command-line
argument, repository, package, log, or unsigned archive.

### `verify`

```text
notegen-plugin verify <archive-or-directory> [options]
```

Validates a complete package without loading or executing its JavaScript.

| Option | Meaning |
| --- | --- |
| `--public-key <publisher-public.json>` | Verify `signature.sig` against the publisher public key |
| `--api-version <version>` | Check against a host API version |
| `--app-version <version>` | Check against a NoteGen version |
| `--require-signature` | Reject unsigned input |
| `--json` | Emit machine-readable diagnostics |

An archive whose name ends in the final `.notegen-plugin` suffix always requires
`signature.sig`; the programmatic API cannot turn that rule off.
`--require-signature` additionally applies the same policy to development
directories and `.unsigned.notegen-plugin` input. For a release candidate, use
both `--public-key` and `--require-signature`. Without a public key, the command
can validate signature encoding and package integrity but cannot prove who
signed the package.

Successful local verification does not validate a marketplace listing, root
index signature, publisher reputation, source reproducibility, license, or
review status. It never means “official” or “approved by NoteGen.”

## Validation and package rules

The CLI mirrors the version 1 desktop-host boundary, including:

- strict JSON parsing with duplicate and unknown field rejection;
- manifest IDs, namespaces, SemVer requirements, permissions, contributions,
  activation events, and locale validation;
- path normalization, collision (including implicit parent directories), forbidden-name, file-type, archive-size, and
  compression-ratio checks;
- exact SHA-256 payload coverage through `integrity.json`;
- Ed25519 package signatures using RFC 8785 JSON Canonicalization Scheme (JCS).

An archive is ZIP-formatted but should always use the `.notegen-plugin`
extension. NoteGen does not install dependencies or run package scripts on a
user's device.

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Plugin project or package failed validation/build/signing |
| `2` | Invalid command usage |
| `3` | Unsafe or destructive operation refused |
| `70` | Unexpected internal failure |
| `130` | Interrupted |

Every command supports `--json`. In that mode, both successful results and
diagnostic errors are emitted as exactly one JSON document on stdout; incidental
installation output is sent to stderr. JSON mode never prompts. For unattended
creation, provide an explicit `--id`; `--yes` is optional when `--json` is
already present. Always treat a non-zero exit code as failure.

## Marketplace status

Community submissions are not open. The CLI can produce and locally verify a
publisher-signed package, but it cannot upload a release, edit the marketplace
catalog, create a root-signed index, or grant trust. Follow the instructions in
[`codexu/note-gen-plugins`](https://github.com/codexu/note-gen-plugins) only
after that repository explicitly opens submissions.
