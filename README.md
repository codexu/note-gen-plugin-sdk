# NoteGen Plugin SDK

The NoteGen Plugin SDK is the public TypeScript toolchain for building desktop
plugins that run inside NoteGen. This repository contains the host contract,
project scaffold, build and package CLI, and an in-process test host.

> The packages in this workspace have not had their first npm release. Their
> source is implemented here, but `npm`, `pnpm`, and `npx` package commands will
> work only after the corresponding packages are published. Community
> marketplace submissions are also still closed.

## Packages

| Package | Purpose | npm status |
| --- | --- | --- |
| `@notegen/plugin-api` | Stable TypeScript types and runtime-contract constants | Not yet published |
| `@notegen/plugin-cli` | Create, validate, build, pack, sign, and verify plugins | Not yet published |
| `create-notegen-plugin` | Small `npx` entry point for project creation | Not yet published |
| `@notegen/plugin-test` | In-process host for testing lifecycle and API calls | Not yet published |

This repository is intentionally limited to the plugin ecosystem. It is not a
client SDK for NoteGen notes, sync providers, or a future server API.

The current `@notegen/plugin-api` protocol is 0.1.0. It includes revision-safe
editor edits, complete Markdown note lifecycle operations, workspace and note
events, host-rendered declarative views/dialogs, and restricted text networking
to exact HTTPS origins approved by the user.

API 0.1.0 also adds interactive forms, tables and trees, editor-area plugin tabs,
view close/focus/visibility methods, saved-note search, and separately authorized
attachment reads and non-overwriting creation. Batch range edits and selection
control currently require source mode. See the API package README and website
for quotas and unsupported capabilities.

Command arguments/results and plugin storage use the exported recursive
`PluginJsonValue` contract. Values must be finite plain JSON data; command-level
`undefined` means no argument or no result and is never valid inside a JSON
container.

## Requirements

Before the first public release, all SDK packages and the host API stay at
`0.1.0`. Ongoing development does not increment versions. Begin version bumps
only after the maintainer publishes the first release.

- Node.js 20 or newer
- pnpm 10 when working from this repository
- NoteGen desktop for development import and real-host testing

## Use the source before the npm release

Clone and build the workspace:

```bash
git clone https://github.com/codexu/note-gen-plugin-sdk.git
cd note-gen-plugin-sdk
pnpm install
pnpm build
```

Run the built CLI directly:

```bash
node packages/plugin-cli/dist/bin.js --help
node packages/create-notegen-plugin/dist/bin.js ../my-plugin \
  --id com.example.my-plugin \
  --name "My Plugin"
```

Use absolute paths when calling that CLI from another directory. Before the npm
release, do not pass `--install` to the scaffold: the generated package
dependencies are not available from the npm registry yet.

## Quick start after the npm release

Create a project:

```bash
npx create-notegen-plugin my-plugin \
  --id com.example.my-plugin \
  --name "My Plugin"
cd my-plugin
pnpm install
```

Build and validate it:

```bash
pnpm build
pnpm validate
```

`notegen-plugin build` always writes an importable development snapshot to
`.notegen/package`. In NoteGen desktop, enable Developer mode and import the
absolute path to that directory. NoteGen executes the validated snapshot, not
your source tree.

## Release artifact flow

```text
source project
    │ notegen-plugin build
    ▼
.notegen/package
    │ notegen-plugin pack
    ▼
.notegen/releases/<id>-<version>.unsigned.notegen-plugin
    │ notegen-plugin sign --private-key <publisher-private.pem>
    ▼
.notegen/releases/<id>-<version>.notegen-plugin
    │ notegen-plugin verify --public-key <publisher-public.json>
    ▼
locally verified publisher package
```

`pack` never reads a private key. `sign` accepts only an already-built unsigned
archive and does not build source code. This separation lets you keep signing
keys on an isolated machine. Local verification proves package consistency and
the publisher signature; it does not make a plugin official, trusted, reviewed,
or accepted by the NoteGen marketplace.

Package signatures use Ed25519. The signing documents are canonicalized with
[RFC 8785 JSON Canonicalization Scheme (JCS)](https://www.rfc-editor.org/rfc/rfc8785)
before NoteGen's length-framed signature message is created.

See [`packages/plugin-cli/README.md`](packages/plugin-cli/README.md) for the
complete command reference and the
[NoteGen plugin developer documentation](https://notegen.top) for manifests,
permissions, lifecycle, packaging rules, and runtime constraints.

## API compatibility

The npm package version and the NoteGen plugin API protocol version are related
but distinct. `@notegen/plugin-api` exports `PLUGIN_API_VERSION`, and its package
metadata records the same protocol version.

- Breaking host-contract changes require a new protocol major version.
- Additive, backward-compatible changes use a protocol minor version.
- Package-only fixes may use a patch release without changing the protocol.

Use type-only imports whenever possible:

```ts
import type { PluginActivate } from '@notegen/plugin-api'

export const activate: PluginActivate = async (context) => {
  context.commands.handle('com.example.hello.open', async () => {
    await context.ui.showNotice('Hello from NoteGen')
  })
}
```

The runtime loads one self-contained ESM entry file and does not resolve package
imports. The CLI bundles value imports and dependencies into that entry and
rejects residual static or dynamic imports.

## Workspace development

```bash
pnpm install
pnpm check:contract
pnpm build
```

`pnpm check:contract` checks that the public API package metadata matches its
exported host protocol version. The workspace is licensed under MIT; each
publishable package includes its own license and package metadata.

## Maintainer release procedure

The `Publish npm packages` workflow is the only supported release path. It can
run only from `main`, executes the contract and behavior tests, and rejects a
dirty build. Before publishing anything, it packs all four packages and checks
the registry. A published version is skipped only when its SHA-512 integrity
matches the exact local tarball; different bytes require a version bump. Only
an explicit registry `E404` is treated as an unpublished version; network or
authentication errors stop the release. The verified tarballs are then
published in dependency order: API, CLI, test host, then the project creator.
A network failure after a partial release can be resumed from the same commit.

The workflow uses npm Trusted Publishing (OIDC) with Node.js 24 and npm 11;
it does not read an `NPM_TOKEN` secret. Configure a GitHub Actions trusted
publisher in each of the four packages' npm settings with owner `codexu`,
repository `note-gen-plugin-sdk`, workflow filename `publish.yml`, environment
`npm`, and **Allow npm publish** enabled. The workflow's `id-token: write`
permission supplies the short-lived publishing identity. Keep the GitHub
environment `npm` and configure reviewer approval if required by your team.
Package provenance is enabled in every package's `publishConfig`.

All four packages have completed their initial publication. A new package
must first exist on npm before its trusted publisher can be configured;
bootstrap that package separately before adding it to this OIDC workflow.
After verifying a real release through OIDC, revoke any bootstrap token and
remove the unused `NPM_TOKEN` secret. See
[npm's Trusted Publishing instructions](https://docs.npmjs.com/trusted-publishers/).

For each release:

1. Update the package versions that changed and their affected dependency
   ranges, then commit the refreshed `pnpm-lock.yaml`. Never reuse a version
   for different package contents.
2. Merge the release commit to `main` and wait for CI to pass.
3. Manually run `Publish npm packages` from `main` and approve the protected
   environment deployment.
4. Confirm the public package pages and run the documented `npx` quick-start
   against npm before removing the pre-release notice from this README and the
   website.

## Marketplace ownership

The catalog and downloadable community packages belong in the separate
[`codexu/note-gen-plugins`](https://github.com/codexu/note-gen-plugins)
repository. That repository is not accepting submissions yet. Do not invent a
catalog layout or treat a signed local archive as an accepted marketplace
release.

## Coordinated host changes

The `Host contract parity` workflow compares this checkout's complete API source
with a reviewed NoteGen commit. Set `PLUGIN_HOST_REF` to that full commit SHA;
the NoteGen repository uses `PLUGIN_SDK_REF` for the inverse check. During a
coordinated change, dispatch the workflows with the intended commit inputs and
update both variables after review. Version equality alone is insufficient.

The failure laboratory includes opt-in memory exhaustion and local diagnostic
commands. Real-host release acceptance is documented in NoteGen's
`PLUGIN-MAINTENANCE.md`; passing the in-process test host does not satisfy it.
