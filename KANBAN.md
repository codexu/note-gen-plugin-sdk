# Declarative Kanban and source handoff

Protocol **0.1.6**, SDK package **0.1.8**. These additions require a matching NoteGen host; old installed API packages do not provide them. The SDK package, host dependency/lockfile, native protocol constant, runtime worker, and official plugin must be integrated together before release.

## `PluginKanbanBlock`

A `kanban` block describes up to 30 columns and 500 cards total. Column and card IDs are unique across the entire block, at most 160 characters, and cannot start with the reserved `drop:` prefix. The standard 128 KiB UI document limit still applies. Plugins should shorten previews while retaining full data in their own model.

The host renders columns, cards, search, quick entry, drag handles, keyboard sensors, empty-column drop areas, and saving/error feedback. All visible labels come from the plugin's localized `labels` object. Every command must be declared by the same plugin; the host validates these references before rendering.

Events:

- `openCardCommand`: `{ generation, cardId, columnId }`.
- `openNoteCommand`: `{ generation, cardId, columnId }`; optional, shown when the card has `noteLabel`.
- `addCardCommand`: `{ generation, columnId, title }`.
- `editColumnCommand`: `{ generation, columnId }`.
- `moveCardCommand`: `{ generation, cardId, fromColumnId, toColumnId, beforeCardId }`; `beforeCardId: null` appends. The source card must belong to the stated source column, and a non-null destination anchor must belong to the destination column.
- `reorderColumnsCommand`: `{ generation, columnIds }`; the complete new order, without omissions or duplicates.

Plugins must validate generations, IDs, ordering membership, workspace identity, permissions, and file revisions. A generation is an opaque UI snapshot token, not a file revision. Emit a fresh generation after accepting a mutation. Reject stale commands. A save failure must not publish an unpersisted model. Throw failures; returning a `message` is also treated as failure by the board renderer.

Dragging stays in the host; only the final operation crosses the plugin bridge. Search disables dragging so filtering cannot silently reorder hidden cards. Provide form/menu alternatives for movement and deletion. The renderer does not itself persist, delete notes, merge conflicts, or provide a board data format.

## `notes.prepareForWrite({ path })`

Call only for an explicit user action such as **Save source and reload board**. Requires `notes.read`, `notes.write`, and `notes.open` for the path. Available in the desktop main window.

The host checks the file, refuses separate editor windows and active AI generation, durably flushes source edits, prevents the target from reopening during handoff, closes matching main-window source tabs, and returns a fresh saved `NoteSnapshot`. The in-memory host models closed-note state and permission checks; it does not model real editor save queues or OS windows.

This is not a persistent lock. A source editor may reopen after the call. Every subsequent `notes.write` still requires `expectedRevision` and may return `EditorBusy` or `StaleRevision`. A failed handoff never authorizes an unconditional write. A workspace change or permission revocation invalidates the operation. A file may have been saved before later navigation fails; re-read rather than assume an unchanged disk.

## Integration status

The coordinated SDK builds successfully and its 22 contract tests pass. Host dependency/lockfile installation and runtime rebuild must use the published npm package before client acceptance. Native and UI behavior still requires host validation; do not claim protocol support from the native constant alone.
