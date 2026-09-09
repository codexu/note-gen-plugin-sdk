# `@notegen/plugin-api`

UI lifecycle: forms retain values by field ID until removed, closed, or explicitly
reset with a new `resetKey`. `ui.openDialog(options)` returns `{ id }`;
`ui.closeDialog(id)` only closes that instance. To replace an existing dialog,
pass its ID as `replaceId`. Another plugin's dialog cannot be replaced.
`ui.onDidCloseDialog` reports `{ id, reason }`. Form commands inside dialogs
also receive `dialogId` alongside `formId` and `values`; capture it before
awaiting work so a stale submission cannot close a newer dialog.

The public TypeScript contract for NoteGen plugins.

```bash
pnpm add -D @notegen/plugin-api
```

Use type-only imports whenever possible:

```ts
import type { PluginActivate } from '@notegen/plugin-api'

export const activate: PluginActivate = async (context) => {
  context.commands.handle('com.example.hello.open', async () => {
    await context.ui.showNotice('Hello from NoteGen')
  })
}
```

The package contains manifest, permission, contribution, lifecycle, host-context,
and stable error types. It has no runtime dependencies and does not require DOM
types.

Values that cross the runtime boundary use `PluginJsonValue`. Command arguments
and results, storage values, and declarative UI action arguments therefore accept
only finite JSON-compatible data. Convert class instances such as `Date`, maps,
sets, and custom errors to plain objects before passing them to the host.
`undefined` is allowed only at the outer command boundary to mean “no argument”
or “no result,” and as the missing-key result of storage `get`; it cannot appear
inside a stored, returned, or action-argument JSON value.

The package also publishes an editor-oriented manifest schema at
`@notegen/plugin-api/plugin-manifest-v1.schema.json`. The schema catches shape
errors while editing; `notegen-plugin validate` remains authoritative for
namespace ownership, localization files, API/app compatibility, and packaged
file checks.

API 0.1.0 covers commands, settings, storage, calendar resolution, active-editor
snapshots and revision-checked edits, note listing/read/write/move/delete and
change events, declarative sidebars/dialogs, and text-only requests to exact
user-approved HTTPS origins. Every sensitive operation is permission scoped.

API 0.1.0 adds declarative forms (text, textarea, number, select, checkbox), tables,
trees, editor-area plugin tabs, view visibility events and close/focus methods.
Forms submit `{ formId, values }` to a declared command; its result may contain
`fieldErrors` and `message`. The UI remains host-rendered without DOM access.
`editor.applyEdits` and `editor.setSelection` use UTF-16 Markdown offsets and
currently require source mode. Batch edits cannot overlap and form one undo step.
`notes.search` searches saved Markdown within both list and read grants (up to
200 files, 16 MiB scanned, 100 matching lines); inspect `truncated`.
`attachments.read/create` require separate grants, accept PNG/JPEG/GIF/WebP,
PDF/TXT/CSV, and transport standard Base64 up to 1 MiB decoded. Creation never
overwrites an existing file. There is no attachment delete, arbitrary-file API,
or automatic preview/open operation.

File mutations (`notes.write`, `notes.move`, and `notes.delete`) run only from
the main window and require every affected note to be closed in all tabs,
panes, and separate editor windows. Otherwise they return `EditorBusy`.
Use `editor.applyEdit` for the active document. The host drains pending saves
before checking a file's `expectedRevision`; re-read after a stale-revision
error. If a mutation error includes `details.committed: true`, the disk change
completed and only its UI reconciliation failed. Read the file state before
retrying.

The current community runtime loads one self-contained ESM entry. Type-only
imports disappear during compilation. Any value import or other dependency must
be bundled into that entry by the authoring build.

See the [NoteGen documentation](https://notegen.top) for the complete plugin
development guide.

## Local diagnostics and folder permission bindings

`context.log.info/warning/error(message)` writes local diagnostics. The QuickJS
host truncates messages to 1,000 characters and drops entries beyond 50 per
10 seconds. Use `error.stack` explicitly when a stack trace helps; do not log
credentials or note contents. The developer panel can export its filtered log.
The in-process test host records these calls but does not emulate the quota.

One `string` setting with `scope: "workspace"` may declare
`permissionPaths: ["notes.create", "notes.open"]`. Each listed permission must
be declared, required, unique and use `workspace-folder` scope (at most 20).
The permission dialog uses the setting's fixed folder prefix, lets the user
choose another folder, and preserves `{{...}}` date subfolders. This is a UI
suggestion only: permissions still require explicit user approval. Plugins
without this declaration use the normal per-permission inputs.

Production KV storage now follows the installed package content fingerprint.
A new package starts with a copy of the current package's data; rollback returns
to the old data branch. Reinstalling an existing fingerprint reuses its branch.
This does not roll back note writes, attachments, settings or remote effects.
Use explicit data schema versions and idempotent migration steps. The test host
does not simulate package installation or versioned storage.
