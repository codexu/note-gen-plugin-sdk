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
