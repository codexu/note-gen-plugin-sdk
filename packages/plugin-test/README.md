# `@notegen/plugin-test`

An in-process, deterministic test host for NoteGen plugins.

```bash
pnpm add -D @notegen/plugin-test @notegen/plugin-api
```

```ts
import { createPluginTestHost } from '@notegen/plugin-test'
import manifest from './plugin.json' with { type: 'json' }
import * as plugin from './src/index.js'

const host = createPluginTestHost({ manifest })

await host.activate(plugin)
await host.executeCommand('com.example.hello.open')

console.log(host.notices)
console.log(host.callHistory)

await host.deactivate()
```

The host implements the public `PluginContext` contract and provides:

- activation, deactivation, command registration, and command execution;
- manifest-aware permission grants and deterministic permission denial;
- in-memory notes with production path, content-derived revision, 2 MiB content,
  and idempotency-key limits;
- device/workspace storage with the combined 256-key and 1 MiB production quotas;
- manifest-backed settings;
- active-editor and content-change event controls;
- note listing/writing/moving/deletion and change-event delivery;
- revision-checked editor edits;
- production-shaped validation for declarative view/dialog snapshots and
  injectable restricted-network responses;
- notice, status-bar, and API call-history snapshots.

View snapshots are defensive deep copies and are recursively frozen, so test
assertions cannot mutate the host's stored declarative UI state.

Writing an existing note (including with `create: true`) or deleting a note
requires its last-read `expectedRevision`. Missing or stale revisions reject
the mutation with `StaleRevision`. This host only deletes in-memory fixtures:
it does not test OS trash, filesystem races, or mobile deletion support.
The desktop app moves deleted notes to system trash; mobile deletion currently
returns `UnavailableOnPlatform`.

Deactivation rejects pending activation, command execution, and injected
network requests with `Cancelled`, even if their handlers have not finished.
The underlying Node.js callback is not forcibly stopped; plugin code should
observe `ctx.signal` before doing its own asynchronous side effects. Network
permission is checked again before returning an injected response, so a grant
revoked while the request is pending cannot deliver a successful response.

Notices are truncated to 500 UTF-16 code units. Status text fields are
truncated to 160 code units. Repeated updates to one item within 100 ms are
trailing-coalesced, so the final state is applied when the interval ends, like
the production host. Supply a controllable `now` function when a test needs to
advance that interval deterministically.

Permissions declared by the manifest are granted by default. Override a grant
at construction time, or change it during a test:

```ts
const host = createPluginTestHost({
  manifest,
  permissions: { 'notes.read': false },
})

host.setPermission('notes.read', false)
```

A boolean `true` is an unrestricted test grant, retained for concise and
backwards-compatible tests. Use a scoped grant when the test needs to reproduce
the production host's workspace path checks:

```ts
const host = createPluginTestHost({
  manifest,
  permissions: {
    'notes.read': {
      granted: true,
      paths: ['Templates/daily.md'],
    },
    'notes.create': {
      granted: true,
      paths: ['Daily'],
    },
  },
})

host.setPermission('notes.read', {
  granted: true,
  paths: ['Templates/weekly.md'],
})
```

`workspace-file` and `workspace-files` grants match the listed files exactly.
`workspace-folder` grants include the listed folders and their descendants; an
empty string grants the whole workspace for that scope. A scoped grant with an
empty `paths` array grants no path access.
`network-origins` grants match exact origins such as `https://api.example.com`.
The test host rejects credentials, fragments, IP literals, localhost names,
forbidden request headers, and oversized bodies. It cannot reproduce the native
host's DNS pinning check, so real-host testing is still required for hostnames
that resolve to private or otherwise non-public addresses.

`notes.list()` is non-recursive by default and returns at most 200 entries, as
the production host does. Seed empty folders with the `folders` option when a
test needs to distinguish an existing empty directory from a missing one.

Seed `openNotePaths` with notes open in any tab, pane, or separate editor window
to exercise the production `EditorBusy` check for `notes.write`, `notes.move`,
and `notes.delete`. Call `host.setOpenNotePaths(paths)` when the simulated UI
opens or closes notes. `openOrCreate({ open: true, ... })` also marks its note as
open. Use `surface: 'editor-window'` to model a separate window, where file
mutations and opening another note are unavailable but the editor API remains
available. The test host does not simulate real save queues or window races.

Commands and status-bar items must be declared in `manifest.contributes`.
Settings begin with their manifest defaults and may be overridden through
`settings`. Call `clearCallHistory()` after activation when a test only cares
about calls made by a command.

## Important limitation

### Simulating stale form updates

After rendering a form in a view or dialog, call
`host.simulateFormChange(viewIdOrDialogId, formId)` to advance its input revision
and obtain an `expectedForm` token. A second call invalidates the first token.
Pass a token to `context.ui.views.update(id, { blocks, expectedForm })` or inside
`context.ui.updateDialog(id, { title, content: { blocks, expectedForm } })`.
Stale tokens reject with `StaleRevision`; resets, removal and closure invalidate
the corresponding snapshots. This helper models revision changes only: it does
not render inputs, change field values or dispatch debounced change commands.

### Runtime boundary

This package is a test double, not QuickJS and not a security sandbox. Plugin
code runs in the same Node.js process as the test, with the test process's full
authority. The host does not reproduce worker isolation, timeouts, memory or
CPU limits, signature checks, package integrity checks, or the production
runtime's worker scheduling or native DNS resolver. JSON-compatible command and
storage values are validated as finite, plain containers with enumerable data
properties (including rejection of sparse arrays), but use this package for
plugin behavior tests, not for executing untrusted plugins or proving runtime
security.


### Embedded view contexts

Use `await host.setEmbeddedViewContext(viewId, "page-a")` to simulate mounting an embedded view, pass a new token to simulate navigation, or pass `null` to unmount. `ui.views.update` requires the current token in `expectedContextId`; stale or absent contexts reject with `StaleRevision`.

## Kanban and source handoff

Protocol 0.1.6 adds a host-rendered Kanban block and explicit source-to-plugin document handoff. See [contract and integration notes](../../KANBAN.md). These changes are source-only and require a matching host.

## Document adapters (protocol 0.1.7)

Pass `renderDocument(options)` and `exportFile(options, document?)` in `createPluginTestHost` options. File adapters receive the owned rendered document for document-ID exports and return `{ saved: boolean }`. Rendering adapters return `{ html, text, warnings, title? }`; the host allocates an owned ID. Missing adapters return `UnavailableOnPlatform`, since Node does not implement browser CSS or a save dialog. The shared input validator applies the same transport quotas. Use `host.clipboard`, `host.editorStyles` and `callHistory` to inspect effects. Invoke output through `host.executeCommand`; automatic listeners have no user-action scope. Browser CSS sanitization/layout and real WeChat pasting require host integration verification.

## Native HTML export adapter (API 0.1.11)

Supply `exportHtml(job)` to `createPluginTestHost`. It returns
`{ saved: boolean, warnings: PluginExportHtmlWarning[] }`; the test host adds the
captured editor/document IDs and revision. Missing adapters return
`UnavailableOnPlatform`. Node does not pretend to render Markdown, evaluate CSS
or JavaScript, embed assets or show a native save dialog.

The job contains frozen `options` and `snapshot`, an optional workspace-relative
`sourcePath`, a transaction `signal`, `readAttachment(path)` and `assertCanWrite()`.
Read attachments through the supplied callback to exercise path grants, missing
files, the 32-image budget, 1 MiB per image and 16 MiB total limits. The adapter
owns native rendering, its 30-second render budget and the 32 MiB final output
limit. Call `assertCanWrite()` immediately before simulated output, after any
asynchronous save-dialog fixture; it rechecks the workspace, runtime and every
used permission. Observe `signal` if the adapter has ongoing work.

The wrapper checks input shape, `editor.read`, `files.export`, user-command
authorization, exact source revision, composition state and the 2 MiB Markdown
budget. It records `documents.exportHtml` and attachment reads in `callHistory`,
allows only one transaction, and rechecks authorization after the adapter
returns. Invoke it through `host.executeCommand`; automatic callbacks do not
gain output authority. A later editor revision does not alter the frozen source.
Deactivation, a workspace switch or revoking a used permission cancels the pending
operation. The transaction signal also aborts when the operation ends. Adapter output
is validated and cannot inject extra result fields or source metadata.

## Native HTML copy adapter (API 0.1.12)

Supply `copyHtml(job)` when testing `documents.copyHtml`. It receives the same
frozen snapshot, scoped `readAttachment`, transaction signal and `assertCanWrite`
as `exportHtml`, with `options.format` set to `source` or `rich-text`. The adapter
simulates native rendering and copying and returns `{ copied: true, warnings }`;
it must check `assertCanWrite()` immediately before clipboard output. The test host
does not fake clipboard formatting, browser CSS layout or JavaScript execution.

Copy checks `editor.read`, `clipboard.write` and the user-command scope without
requiring `files.export`; it shares HTML export's per-runtime transaction limit,
revision checks, workspace/permission cancellation and attachment budgets. The
host records `documents.copyHtml` and validates warning/result fields. Rich-text
warnings include CSS omission, math fallback, script omission and omitted content;
`additional-warnings` indicates that more warnings were grouped.
