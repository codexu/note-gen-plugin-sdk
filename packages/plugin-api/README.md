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

## Active document paths

`editor.getActiveEditor()` and active-editor events may include `path`, the workspace-relative Markdown path. It is protected by `editor.read` and never contains an absolute filesystem path. Older hosts and non-workspace documents may omit it; plugins must handle absence without treating the opaque document ID as a path.

## Opening existing notes only

Updated hosts accept `notes.openOrCreate({ ..., open: true, create: false })`. This requires `notes.open` only and fails for missing files without creating them. Omitted `create` preserves the original behavior and requires `notes.create`. Open-only mode requires an updated host; older hosts do not implement this option.

## Navigation lists (updated local hosts)

The `navigation-list` UI block provides a compact host-rendered sortable list. Each item has a unique stable ID and a label. Item open/remove commands receive `{ generation, itemId }`; the add command receives `{ generation }`. Reorder receives `{ generation, itemIds }` with the complete new order. Plugins must check generation, reject duplicate/missing/foreign IDs, persist the new order, and publish a new document. Hosts validate all referenced commands and limit lists to 100 items. Older hosts reject this block type.

## API 0.1.1: editor menus and composable UI

New contributions require `apiVersion: "^0.1.1"`. The corresponding NoteGen host
changes must be present; publishing this SDK does not update an installed app.
The older `^0.1.0` plugin contract remains accepted by the new host.

Menu locations now include `editor/slash`, `editor/context`, `editor/selection`
(the text-selection floating toolbar), `editor/toolbar` (visual editor footer),
`tab/context`, `file/context`, and `mobile/writing/overflow`.
`editor/context` uses Alt/Option + right-click to preserve the native clipboard menu.
The tab menu also retains file-menu contributions, deduplicated by command ID.

Each menu accepts `icon`, `group`, `order`, `when`, and `enableWhen`. Groups sort
lexically, then entries sort by ascending order. A menu icon overrides the command
icon. Commands accept up to 20 `keywords` for slash-menu and palette search.
Selection/toolbar menus display three direct buttons and put additional commands
in an accessible overflow menu. Existing built-in editing commands remain intact.

```json
{
  "location": "editor/selection",
  "command": "com.example.notes.extract",
  "icon": "files",
  "group": "notes",
  "order": 10,
  "when": "editor == markdown && selection",
  "enableWhen": "!readOnly && !codeBlock"
}
```

Conditions support boolean `selection`, `readOnly`, `codeBlock`; string `editor`,
`resourceKind` (`file`, `folder`, `root`), and `resourceExt` (e.g. `md`). Use `!`,
`==`, `!=`, `&&`, `||`; `&&` binds more tightly than `||`. Parentheses, arbitrary
properties and executable JavaScript are rejected. Unknown/missing context fails
closed, including negated conditions. Conditions control UI only, never permission
grants. Read selection/text through `editor.read`; keep the captured editor ID and
revision when applying an edit through `editor.write`. Menu arguments do not leak
selected text or circumvent permissions.

Composable blocks:

- `layout`: row/column, small/medium/large gap, nested `blocks`.
- `section`: title, nested blocks, optional collapse and initial open state.
- `tabs`: stable ID, accessible label, tabs with ID/label/blocks.
- `toolbar`: labeled actions with optional icon, iconOnly, variant and confirmation.
- `item-list`: stable IDs, generation, click action, optional checkbox action,
  drag and keyboard reordering, context actions and a touch-accessible overflow.
  Items may supply `metadata` (up to 1024 characters) for a separate information
  line below the description, such as a workspace-relative file path.
- `markdown`: formatted text with raw HTML, links and image loading disabled.
- `badge`, `empty`, `loading`: standard theme-aware feedback.
- Form fields additionally support `search`, ISO `date`, and searchable
  `note-picker`. Supply note choices as `{label,value}` through existing scoped
  `notes.list` permissions. The picker does not enumerate files or grant access.

Nested forms retain their values when a surrounding section/tab rerenders. IDs
must be unique per block type across the whole document. Limits: 6 nesting levels,
200 total blocks, 50 blocks per container, 100 list items, 20 actions, 12 tabs,
and the existing 128 KiB document limit. Command ownership is validated recursively.

List open/toggle/action commands receive `{generation,itemId}`; toggle adds
`checked`. Context actions add `actionId` and optionally nested `argument`.
Reorder commands receive `{generation,itemIds}` with the complete requested order.
The plugin must reject stale generations and invalid IDs, persist successful
changes, then publish updated content. The host never mutates plugin storage.

An action may provide `confirmation: {title,description?,confirmLabel,cancelLabel}`.
Its command runs only after confirmation. Legacy `navigation-list` remains a
compatibility adapter; new plugins should compose toolbar and item-list blocks.

Supported symbolic icons include bookmark, calendar-days, file-text, files, folder,
folder-open, layout-template, list-checks, list-todo, link, search, plus, minus,
trash-2, pencil, copy, check, x, star, pin, tag, settings, more-horizontal, arrow-up,
arrow-down, download, upload, external-link, list, table-2, columns-3, clock,
book-open, code, sparkles, shuffle, refresh-cw, chart-no-axes-combined, file-input,
and flask-conical. Unknown icons fall back to a puzzle icon. Raw SVG/HTML and
external icon URLs are not accepted as executable markup.

## Protocol 0.1.2 resource extensions

`PluginManifestV1.resources` declares themes, languages, file icons and document previews. `entry` is optional for resource-only packages. `PluginContext.fileIcons.setRules/clear` manages runtime rules. See [RESOURCE-EXTENSIONS.md](https://github.com/codexu/note-gen-plugin-sdk/blob/main/RESOURCE-EXTENSIONS.md) for the full contract and examples in SDK 0.1.4.

## Protocol 0.1.3 title bar components

Declare a `contributes.views` entry with location `title-bar-left`,
`title-bar-center`, or `title-bar-right`; use the existing `ui.views` methods.
The left slot follows built-in recording controls, the center slot is centered
in the remaining draggable space, and the right slot precedes built-in controls.
Items are ordered by plugin ID and then by their order in the manifest.

Title bar views activate when mounted and are initially visible. `close` hides a
view, `open` restores it, and `focus` focuses its container. Updating content does
not reopen a closed view. Users can hide each slot for a plugin in display settings.
Disabling/uninstalling a plugin or changing workspace clears its UI state.

`toolbar`, `actions`, `text`, `badge`, `loading`, `separator`, and `progress`
blocks render inline in one row. A document containing other blocks gets a named
button (or its declared icon) that opens the full document in a popover. Empty
documents render nothing. The host bounds width and allows horizontal scrolling;
plugins cannot insert raw HTML, CSS, or React components into the title bar.
Use `apiVersion: ">=0.1.3"`. See the
[example](https://github.com/codexu/note-gen-plugin-sdk/tree/main/examples/title-bar).
