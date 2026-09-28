# Document capabilities: host integration

Audience: NoteGen and SDK maintainers. Protocol: 0.1.7. Date: 2026-09-27.

## Boundary and ownership

Protocol **0.1.7**, SDK packages **0.1.9** add reusable document rendering, previews, clipboard writes, file exports and scoped editor styling. Plugin code remains in QuickJS without DOM access. These capabilities support publishing plugins, reports and other generated documents; they do not add a WeChat-specific host command.

The official `top.notegen.markdown-publisher` plugin owns templates, colors, typography, CSS configuration, snapshot freshness and the publishing workflow. The host owns HTML sanitization, CSS parsing/inlining, isolated rendering, permission checks and native output. The previous global `customCss` setting entry is superseded by plugin-owned styles. Its persisted value is not deleted or automatically executed.

## Data flow

1. The plugin reads `editor.getActiveEditor()` and a revision-checked `getTextSnapshot()` to include unsaved changes. It reads approved local attachments separately if needed.
2. `documents.render` receives exactly one Markdown or HTML source, optional article CSS and explicit raster image mappings. It does not read files or request network resources.
3. The host sanitizes the fragment, applies portable article CSS in a temporary frame and inlines the resulting styles. For `target: 'wechat'`, external links become numbered references. Math and Mermaid in Markdown produce an unsupported-content warning rather than a false success.
4. The returned document has a runtime-owned ID, HTML fragment, plain text and warnings. A `document-preview` UI block refers to the ID, so large HTML does not consume the 128 KiB declarative UI budget.
5. Clipboard and file output can consume that same document ID. The plugin must refresh stale source snapshots before invoking either action.

## Runtime integration

Host changes span `runtime/protocol.ts`, the QuickJS bootstrap in `runtime/plugin-runtime.worker.ts`, `broker.ts`, native/TypeScript manifest validators, permission labels and `PluginExtendedUi`. `documents.ts` tracks document IDs by plugin and runtime AbortSignal; `editor-styles.ts` tracks scoped styles by the same owner. Both trusted-context disposal and community-runtime stop remove only resources owned by that runtime. Workspace switches, permission changes, disablement and uninstall follow existing runtime stop/restart paths.

`executePluginUserCommand` creates a host-owned user-action scope. Buttons, command palette, menu actions and explicit form submission use it; automatic form-change callbacks keep `executePluginCommand`. `clipboard.write` and `files.export` require both their permission and this action scope. A plugin activation or timer cannot initiate output without a host user action. The scope begins after lazy activation completes. Authorization is scoped to the plugin while its user command is pending, not to individual concurrent RPCs. File export always uses a native save dialog and checks authorization again after the dialog before writing. The command timeout is deferred while its native save dialog is open. Cancellation returns `{ saved: false }`; no absolute destination path crosses the plugin boundary.

Native clipboard HTML needs `clipboard-manager:allow-write-html` on desktop windows. Existing clipboard-manager `writeHtml(html, altText)` provides the formatted and plain-text payload. Native iOS/Android rich-text clipboard and file saving return `UnavailableOnPlatform`; no silent text-only success is reported. The official plugin currently declares desktop support only.

## CSS and HTML constraints

Use `.article` and descendant selectors, e.g. `.article h2` or `.article blockquote`. Host CSSOM validates a bounded portable typography/layout property set. No imports, at-rules, pseudo selectors, sibling/child combinators, CSS assets, variables or escaped selectors are accepted. Do not treat this API as arbitrary application CSS injection. Unsupported properties return `InvalidPath`.

The host restricts exported fragments to article tags, strips event handlers/executable content, filters style properties, allows only safe link schemes and raster image data URLs or HTTP(S) image URLs. Frames block scripts, navigation links and all network requests. Remote image URLs are retained for export but show warnings and do not load in preview. The hidden rendering frame permits same-origin host measurement but no scripts; the visible preview is fully sandboxed.

Editor styling maps `.article` selectors to `.tiptap-editor .tiptap.ProseMirror`, covering normal visual editors and inactive long-document sections. It affects note bodies in the current window, not app chrome or the source-mode editor. Multiple plugins follow CSS cascade order; plugins should offer an explicit opt-in and reset action. Settings are plugin-owned; editor styles do not persist independently of an enabled runtime.

## Budgets

- Markdown: 128 KiB; input/output HTML: 512 KiB; user CSS: 16 KiB and 100 style rules.
- One render in flight and eight retained documents per plugin runtime; release replaced previews.
- Up to 2,000 article elements and 32 supplied raster images; each image data URL is at most 256 KiB.
- The existing RPC payload budget still applies to aggregated images and rendered output. Generic export is at most 1 MiB decoded.
- PNG/JPEG/GIF/WebP are supported. SVG, scriptable embeds, automatic image uploads, remote fetching, Mermaid rasterization and formula rasterization are not provided by this renderer.

## SDK adapters

`@notegen/plugin-test` exposes the same API and quotas. Supply `renderDocument` and `exportFile(options, document?)` adapters to simulate browser rendering and native saving explicitly. The Node host does not fake CSS layout. `host.clipboard` and `host.editorStyles` expose captured output; document IDs expire on stop. `host.executeCommand` represents an explicit user invocation; event listeners do not receive that authorization.

## Release sequence and rollback

Publish reviewed SDK 0.1.9 packages before resolving the host npm dependency. The host source pins `@notegen/plugin-api` 0.1.9 and native protocol 0.1.7; regenerate the host lockfile against the published package, then verify the host and pack the official plugin. Publish the plugin only through the signed market workflow. The plugin declares a minimum NoteGen version of 0.38.0, so older clients reject it before activation.

Rollback is to stop/uninstall the new plugin and restore the prior protocol/dependency pin with its matching lockfile. Existing older plugins remain compatible with the additive protocol. New plugins declare `apiVersion: "^0.1.7"`; older hosts reject them instead of partially activating them.

## Manual acceptance

- Compare normal visual, source and sectioned Markdown snapshots; export includes unsaved content without editing the note.
- Switch the three templates, color, font size and spacing; invalid CSS/color produces a form error and leaves saved configuration intact.
- Copy into both a rich-text target and a plain-text target. Paste into the real WeChat editor to verify headings, code, lists, references and images on macOS/Windows/Linux.
- Edit the source after preview; copy/export are disabled until refresh. Switching notes must never reuse a prior note's export.
- Cancel the save dialog; then revoke permission or switch workspace while it remains open; neither path writes a file.
- Try output from activation/form-change callbacks; reject it. Try another plugin's document ID, expired IDs and oversized documents.
- Apply styles to multiple panes/long-note previews, disable/re-enable the plugin and switch workspace; no styles or document handles remain from the stopped runtime.
- Verify denied/allowed attachment folders, oversized local images and remote image warnings. Preview must not make network requests.
