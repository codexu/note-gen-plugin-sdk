# Plugin workflow APIs

SDK 0.1.8 targets host protocol 0.1.6. Use a matching NoteGen host. The SDK package version and host protocol version are separate.

## Choose capabilities and permissions

Declare `apiVersion: "^0.1.6"` for the new host methods. At runtime, `supportsCapability(context, name)` returns false if an older host omits capability metadata. Capability availability does not mean the user granted permission. The new application APIs and prompts run in the main window, not a separate editor window.

| Capability | Methods | Required permissions |
| --- | --- | --- |
| `records` | `records.list/read/tags/onDidChange` | `records.read`, scope `application` |
| `records` | `records.create` | `records.write`, scope `application` |
| `records` | `records.update` | Both records permissions |
| `chat-draft` | `chat.setDraft` | `chat.write`, scope `application` |
| `ai-generation` | `ai.generate/cancel/onDidStream` | `ai.generate`, scope `application` |
| `ui-prompts` | `ui.prompt` | No data permission; one plugin dialog at a time |
| `embedded-views` | `ui.views` and `registerView` | Declare the view; data access requires its own grants |

Records are application-wide, including records outside the current workspace. Folder grants for notes do not restrict this database. AI calls use the user's configured primary model and may incur provider charges. Plugins receive generated text, not model credentials or existing chat history.

Declare only the permissions the plugin uses. For example:

```json
{
  "permissions": {
    "records.read": { "scope": "application", "required": true },
    "chat.write": { "scope": "application", "required": true }
  }
}
```

## Send a selected record to the chat draft

Call this function from an already registered plugin command. The host displays a searchable selection dialog, reads the selected record, opens the AI chat panel and appends a draft. It does not send a chat message.

```ts
import { supportsCapability, type PluginContext } from '@notegen/plugin-api'

export async function draftFromRecord(context: PluginContext) {
  for (const name of ['records', 'chat-draft', 'ui-prompts'] as const) {
    if (!supportsCapability(context, name)) {
      await context.ui.showNotice('This action requires an updated NoteGen main window.')
      return
    }
  }
  const page = await context.records.list({ limit: 20 })
  if (!page.items.length) return
  const selected = await context.ui.prompt({
    type: 'select', title: 'Choose a recent record',
    options: page.items.map(item => ({ value: String(item.id), label: item.content.slice(0, 100) || `Record ${item.id}` })),
  })
  if (!Array.isArray(selected) || selected.length !== 1) return
  const record = await context.records.read(Number(selected[0]))
  await context.chat.setDraft({ text: record.content, mode: 'append' })
}
```

`list` returns previews, `hasMore` and a revision token. Fetch additional pages with `offset`; concurrent insertions may shift pages, so deduplicate IDs if collecting a long list. `read` returns supported text with a 128 KiB limit. Image/file bytes and private attachment paths are not exposed. Create/update support text and todo records only, with up to 20,000 characters per text field. There is no delete or trash API. Read before updating and pass that record's opaque `expectedRevision`; re-read after `StaleRevision` instead of overwriting blindly. Subscribe to `onDidChange` to refresh lists, including changed tags.

Chat drafts default to append. Replacing a nonempty draft requires `overwrite: true`; obtain user intent before using it. The resulting draft is limited to 20,000 characters.

## Confirm and choose

`ui.prompt({ type: 'confirm', title, description? })` resolves to `true` on confirmation. Cancellation or closing resolves to `null`; callers should check `result === true`. Selection returns selected string values, with `multiple: true` allowing an empty array. Choices must have unique values; at most 100 are accepted. A second prompt or legacy plugin dialog returns `Conflict`. Plugin shutdown dismisses its prompt. The host suspends the plugin command timeout while its prompt is waiting for user input.

## Render views safely

```ts
import { registerView, type PluginContext } from '@notegen/plugin-api'

export function registerPanel(context: PluginContext, declaredViewId: string) {
  return registerView(context, {
    id: declaredViewId,
    async render({ signal }) {
      const page = await context.records.list({ limit: 10 })
      if (signal.aborted) return { blocks: [] }
      return { blocks: [{ type: 'text', text: `${page.items.length} recent records` }] }
    },
  })
}
```

`registerView` reacts to visibility and context changes, cancels superseded render signals and automatically supplies the current embedded `expectedContextId`. Late render results are discarded. Pass its signal to cancellable work; cancellation cannot undo a write already committed. Call `refresh()` after relevant data changes. Dispose the registration on cleanup; root plugin shutdown also disposes it. `createDisposables()` groups subscriptions and releases them in reverse order. See [embedded locations](./EMBEDDED-VIEWS.md) for placement and visibility rules.

## AI helpers and task queues

`generateText(context, request, { signal, onUpdate })` returns the final text and optionally reports accumulated streaming text. Supply a unique `requestId` for each request. Prompt length is at most 20,000 characters, system text at most 10,000, and requested output at most 4,096 tokens. The host permits one request per plugin, four overall, with a 30-second timeout. Errors are sanitized; cancellation and timeout use `Cancelled`.

`generateJson(context, request, validate, signal)` asks for JSON, parses it and calls your validator. It does not enable provider-specific schema enforcement or retry malformed output. Its JSON instruction counts toward the system text limit. Never write generated JSON to notes without validating its shape and checking the current revision.

`createTaskQueue(context, concurrency = 1)` provides `enqueue`, `snapshot`, `onDidChange` and `dispose`. Concurrency is 1–4; each task gets `{ signal, report }`. Progress is 0–100, with an optional short message. Always handle `handle.result` rejection. Cancelling rejects the result and signals the running operation; the queue keeps that concurrency slot occupied until the underlying operation settles. A cancelled task that has not started never executes. At most 100 active tasks and 100 retained snapshots are kept.

This queue lives inside the plugin runtime. It does not persist jobs or keep NoteGen running, and does not bypass command timeouts or CPU quotas. Avoid scheduling long jobs that outlive the command that owns them.

## Saved note properties

`readNoteProperties(context, path)` parses YAML frontmatter from saved note content. `updateNoteProperties(context, { path, expectedRevision, set, delete })` patches top-level properties and writes through revision-checked `notes.write`. `queryNoteProperties(context, { folder, cursor, pageSize, equals, tag })` scans one page of up to 50 saved notes. Follow `nextCursor` even when the filtered page is empty. Malformed frontmatter fails the operation; it is not silently skipped.

These helpers reuse existing `notes.list/read/write` permissions; they do not gain access to unsaved editor text or bypass `EditorBusy`. Use the source handoff procedure in [KANBAN.md](./KANBAN.md) when a plugin intentionally takes ownership of an open note. YAML must be a mapping containing JSON-compatible values, no duplicate/unsafe keys or aliases, at most 12 nested levels and a 64 KiB character limit. Updates preserve the exact Markdown body, BOM and newline style; YAML formatting may change. Bundle the `yaml` dependency into the plugin's single ESM entry.

## Diagnostics and test doubles

`notegen-plugin doctor [path] --api-version 0.1.6 --app-version <installed-version>` validates the plugin package against the supplied versions and explains compatibility gaps. `--json` returns a machine-readable report. It does not connect to NoteGen or inspect actual grants; omitted host/app versions cannot establish installed-host compatibility.

The in-process test host accepts seeded `records`, `recordTags`, an `aiGenerate(request, signal, update)` handler and a `prompt(options)` handler. Mock AI never contacts a provider. Supply prompt results to simulate confirmation, cancellation and selection. These mocks exercise plugin logic; they do not reproduce the native database, QuickJS resource limits or React modal behavior.
