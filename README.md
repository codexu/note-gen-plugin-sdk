# NoteGen Plugin SDK

The NoteGen Plugin SDK is the public TypeScript toolchain for building desktop
plugins that run inside NoteGen. This repository contains the host contract,
project scaffold, build and package CLI, and an in-process test host.

> All four SDK packages are published on npm. SDK releases use GitHub Actions
> and npm Trusted Publishing; official plugin releases use the separate
> [plugin marketplace workflow](https://github.com/codexu/note-gen-plugins/blob/main/README.en.md#maintainer-release-procedure).
> Community marketplace submissions are still closed.

## Packages

| Package | Purpose | npm status |
| --- | --- | --- |
| `@notegen/plugin-api` | Stable TypeScript types and runtime-contract constants | [npm](https://www.npmjs.com/package/@notegen/plugin-api) |
| `@notegen/plugin-cli` | Create, validate, build, pack, sign, and verify plugins | [npm](https://www.npmjs.com/package/@notegen/plugin-cli) |
| `create-notegen-plugin` | Small `npx` entry point for project creation | [npm](https://www.npmjs.com/package/create-notegen-plugin) |
| `@notegen/plugin-test` | In-process host for testing lifecycle and API calls | [npm](https://www.npmjs.com/package/@notegen/plugin-test) |

This repository is intentionally limited to the plugin ecosystem. It is not a
client SDK for NoteGen notes, sync providers, or a future server API.

This checkout targets `@notegen/plugin-api` protocol 0.1.6. It includes revision-safe
editor edits, complete Markdown note lifecycle operations, workspace and note
events, host-rendered declarative views/dialogs, and restricted text networking
to exact HTTPS origins approved by the user.

The API also provides interactive forms, tables and trees, editor-area plugin tabs,
view close/focus/visibility methods, saved-note search, and separately authorized
attachment reads and non-overwriting creation. Batch range edits and selection
control currently require source mode. See the API package README and website
for quotas and unsupported capabilities.

Command arguments/results and plugin storage use the exported recursive
`PluginJsonValue` contract. Values must be finite plain JSON data; command-level
`undefined` means no argument or no result and is never valid inside a JSON
container.

## Requirements

Published package versions are immutable. Changes to a published package need
a new version; ordinary plugin changes do not require an SDK release.

- Node.js 20 or newer
- pnpm 10 when working from this repository
- NoteGen desktop for development import and real-host testing

## Use the SDK source locally

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

Use absolute paths when calling that CLI from another directory. The generated
project uses npm dependencies; testing unreleased SDK changes requires explicitly
linking the local SDK packages.

## Quick start with npm

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

Development imports are labeled **Development** in NoteGen and do not receive
marketplace updates. Signing a local package does not change that installation
source. To test an upgrade, first install an older signed version through the
marketplace, then publish a newer compatible version and refresh the catalog.
The Discover card shows the market version, which can differ from the installed
version. See the [installation and update guide](https://github.com/codexu/note-gen-plugins/blob/main/README.en.md#client-installation-and-update-checks).

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
2. Commit and push the release changes to `main`, then wait for CI to pass.
3. In GitHub Actions, select **Publish npm packages → Run workflow → main**.
   Approve the `npm` environment deployment if reviewer protection is configured.
   The equivalent GitHub CLI command is:

   ```bash
   gh workflow run publish.yml --repo codexu/note-gen-plugin-sdk --ref main
   ```

4. Confirm the workflow succeeded, the intended versions and provenance appear
   on npm, and the documented `npx` quick-start works against the registry.
   A run that skips every existing version verifies reproducibility but does not
   exercise an actual OIDC upload.
5. If official plugins should use the new SDK, update `PLUGIN_SDK_REF` in the
   plugin repository to the reviewed full SDK commit SHA. Publish affected
   plugin versions through that repository's workflow. Publishing npm packages
   does not publish a marketplace index or update installed plugins.

All four SDK packages are packed and checked on each manual run; only missing
versions are uploaded. For an interrupted publication, use **Re-run jobs** on
the original run. If package bytes must change, bump the affected versions and
start a new release from the new commit rather than overwriting npm versions.

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

### 0.1.1 local-host compatibility

This release adds editor selection/toolbar/tab menu contributions, menu conditions,
unified symbolic icons, and composable declarative UI. See the API README for the
contract and limits. It requires the matching updated NoteGen host for new features;
SDK publication does not publish NoteGen or any official plugin package.

### 2026-09-10 package release

`@notegen/plugin-api` and `@notegen/plugin-test` are version 0.1.2;
`@notegen/plugin-cli` and `create-notegen-plugin` are version 0.1.3.
The host protocol remains 0.1.1. This release publishes the updated
`NoteSnapshot.modifiedAt` and item-list metadata contract and refreshes the
SDK package dependency versions. Use the matching NoteGen host for these fields.

## SDK 0.1.4 resource extensions

Protocol 0.1.2 adds scriptless theme/language packs, file icon rules and isolated document previews. See [the contract and examples](RESOURCE-EXTENSIONS.md) for lifecycle behavior, limits and host acceptance work.

## SDK 0.1.5 title bar components

Protocol 0.1.3 adds `title-bar-left`, `title-bar-center`, and `title-bar-right`
view locations. See [the title bar example](examples/title-bar/README.md).
The matching NoteGen host is required; this does not publish a host release.


## SDK 0.1.8 embedded views

Protocol 0.1.5 adds new-tab, document top/bottom, file panel, editor toolbar, chat input, record list and status-bar panel locations. Embedded updates require the current `contextId` as `expectedContextId`. See [embedded views](https://github.com/codexu/note-gen-plugin-sdk/blob/main/EMBEDDED-VIEWS.md) for placement, lifecycle, permissions and a complete example.

## Kanban and source handoff

Protocol 0.1.6 adds a host-rendered Kanban block and explicit source-to-plugin document handoff. See [contract and integration notes](KANBAN.md). These changes require a matching protocol 0.1.6 host.

## Workflow APIs in development

SDK 0.1.8 / protocol 0.1.6 adds record workflows, chat drafts, AI generation, prompts and lifecycle helpers. See [usage and permissions](./WORKFLOW-APIS.md) and [maintainer integration notes](./HOST-WORKFLOW-INTEGRATION.md).
