# Embedded views — protocol 0.1.9

Embedded views place the existing declarative UI inside NoteGen pages. They do not inject HTML, React components or CSS. Declare them in `contributes.views`. Existing locations require protocol 0.1.5 or newer; the contextual locations below require 0.1.9 or newer. The NoteGen application must implement the protocol; installing a newer SDK alone does not upgrade the host.

| Location | Host placement |
| --- | --- |
| `new-tab` | Cards on the active new-tab page; participates in its Customize menu, ordering and visibility |
| `document-top` | Above the active document, excluding folders, canvas and record tabs |
| `document-bottom` | Below that document |
| `file-panel` | Above the file tree |
| `file-selection-panel` | Above the file tree while one or more files are selected |
| `editor-toolbar` | A compact row above the active Markdown editor |
| `chat-input` | A compact row above the chat composer |
| `chat-message-actions` | Actions on the one message selected by the user |
| `record-list` | Above the record list, outside the trash |
| `record-detail` | A compact row in the active record detail panel |
| `editor/selection-panel` | A compact surface in the desktop visual editor's selection bubble menu |
| `editor-inline` | A compact surface anchored beside the active desktop visual editor caret |
| `status-bar-panel` | A status-bar button that opens a right-side drawer |

Multiple views can share a location. Outside the new-tab page, ordering follows plugin ID and then manifest order. Settings → Extensions → your plugin provides location visibility switches. Compact rows display text, badges, progress and actions inline; larger content opens in a popover. Status-bar panels use a drawer. Adding a view does not grant permission to read notes, records or chat messages; use only the APIs and permissions available in the SDK.

## Context and lifecycle

Only enabled plugins with a visible surface activate. The first version exposes one active host context per declared view, scoped to the current workspace. For documents and new tabs this is the focused editor group; inactive groups do not mount a second copy. Empty split groups keep the host's placeholder.

`ui.views.getState(id)` and `onDidChange` return an opaque `contextId` while a surface is mounted. It changes when the document, new tab, workspace or mounted surface changes. It contains no document path or content. Read note/editor data through permission-checked APIs.

Contextual surfaces also return `state.target`. File-selection entries contain only workspace-relative paths inside the plugin's `notes.list` grant. Record and chat-message identifiers require `records.read` and `chat.read`, respectively. The host never exposes child DOM nodes. `registerContextualView` renders an empty document when a target is unavailable and automatically echoes the current context token. Only one chat message owns its actions surface at a time; changing messages invalidates the previous token.

Every embedded `ui.views.update` must echo this token as `expectedContextId`. Updates to an absent, hidden or replaced context fail with `StaleRevision`. The host clears previous content and form state on context changes. Treat this error as a cancelled render, not a reason to overwrite the current context with a stale result. Visibility/context notifications and initial `getState` should both trigger rendering. A plugin should dispose the listener on deactivation.

`open` and `focus` reveal a plugin-closed view and request focus in an already mounted host location. They do not navigate to another document or open an editor tab. User-hidden panels remain hidden. `close` hides only that view. Visibility events follow actual mounted surfaces; an off-screen surface can suspend and get a fresh context when it becomes visible again.

```ts
import { isPluginError, type PluginActivate, type PluginDisposable, type PluginViewState } from '@notegen/plugin-api'

let subscription: PluginDisposable | undefined
export const activate: PluginActivate = async ctx => {
  const id = 'com.example.dashboard.home'
  async function render(state: PluginViewState) {
    if (state.id !== id || !state.visible || !state.contextId) return
    try {
      await ctx.ui.views.update(id, {
        expectedContextId: state.contextId,
        blocks: [{ type: 'text', text: 'My dashboard' }],
      })
    } catch (error) {
      if (!isPluginError(error) || error.code !== 'StaleRevision') throw error
    }
  }
  subscription = ctx.ui.views.onDidChange(render)
  await render(await ctx.ui.views.getState(id))
}
export function deactivate() { subscription?.dispose() }
```

For SDK tests, `host.setEmbeddedViewContext(id, token)` simulates a mounted surface; `null` simulates unmounting. It clears old content and emits state changes. See `examples/embedded-views` for the original locations.
