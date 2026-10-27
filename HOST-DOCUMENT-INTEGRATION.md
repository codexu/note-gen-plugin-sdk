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

- Compare visual and source Markdown snapshots; export includes unsaved content without editing the note. The SDK also reserves `sectioned` as a mode, but the current NoteGen host does not expose a sectioned editor.
- Switch the three templates, color, font size and spacing; invalid CSS/color produces a form error and leaves saved configuration intact.
- Copy into both a rich-text target and a plain-text target. Paste into the real WeChat editor to verify headings, code, lists, references and images on macOS/Windows/Linux.
- Edit the source after preview; copy/export are disabled until refresh. Switching notes must never reuse a prior note's export.
- Cancel the save dialog; then revoke permission or switch workspace while it remains open; neither path writes a file.
- Try output from activation/form-change callbacks; reject it. Try another plugin's document ID, expired IDs and oversized documents.
- Apply styles to multiple panes/long-note previews, disable/re-enable the plugin and switch workspace; no styles or document handles remain from the stopped runtime.
- Verify denied/allowed attachment folders, oversized local images and remote image warnings. Preview must not make network requests.

## Native HTML export (API 0.1.11, development)

SDK packages 0.1.14 prepare `documents.exportHtml` as an additional contract,
separate from the limited article renderer described above. This is unreleased
source preparation. A matching host advertises `html-export`; plugin manifests
require API `^0.1.11`.

The request is `{ editorId, expectedRevision, fileName?, css?, javascript? }`.
The host checks `editor.read`, `files.export` and a user-command scope, captures
that editor's canonical unsaved Markdown at the exact revision, and retains the
snapshot, rendered document and assets inside one transaction. It uses the
native export renderer rather than the portable article renderer. No public
document handles or large HTML round trips are introduced. Local relative image
paths are resolved by the host from the captured editor's source path and require
`attachments.read` for each resolved attachment. No remote resources are fetched.

Only the final output receives custom CSS and JavaScript. Neither may run or load
resources inside the host rendering container; the final script runs when the
exported file is opened. Markdown-derived executable markup continues to be
removed. HTML assembly must preserve user code without allowing closing tags to
break the generated document. PDF, clipboard, normal exports and the NoteGen
interface keep their existing behavior.

`PLUGIN_HTML_EXPORT_LIMITS` defines 2 MiB Markdown; 10,000 UTF-16 code units each
for CSS and JavaScript; 32 MiB final HTML; 32 local images, 1 MiB each and 16 MiB in
total; and 30 seconds for rendering. Only one transaction per runtime is allowed.
The render timeout excludes waiting for the native save dialog. These limits do
not expand the old `PLUGIN_DOCUMENT_LIMITS` or the Worker transport budget.

The result is `{ saved, editorId, documentId, revision, warnings }`. Save-dialog
cancellation returns `saved: false`; destination and resolved absolute attachment
paths never cross the plugin boundary. Warnings contain a code, message and
optional original document reference. Codes are `asset-not-embedded`,
`unsupported-content` and `highlight-fallback`. Invalid input, stale capture,
composition, missing editor, revoked permission, quotas, cancellation, workspace
changes, unavailable platforms and output failures use existing `PluginError`
codes rather than an HTML-specific error channel.

The captured snapshot is immutable: later source edits do not invalidate it or
switch the output to another note. After asynchronous work and immediately before
writing, recheck runtime/workspace identity, output authority and every used asset
grant. Stopping a runtime must abort its outstanding render and release internal
resources; save-dialog waiting uses the existing command-timeout exemption.

The test host exposes `exportHtml(job)` rather than faking native rendering. Its
job provides the frozen source, scoped attachment reads, runtime signal and an
`assertCanWrite` callback for the adapter's final simulated write. Browser/native
rendering, asset encoding, output-size and render-time limits remain explicit
adapter responsibilities. Publication and matching host dependency resolution are
separate release steps.

## Native HTML copy and form actions (API 0.1.12, development)

The `html-copy` capability adds `documents.copyHtml({ editorId, expectedRevision,
css?, javascript?, format })` without a large Worker round trip. It shares the
native HTML export snapshot and authorized attachment transaction. `source` writes
standalone HTML as `text/plain`; `rich-text` writes sanitized portable `text/html`
and readable plain text. The rich result neither executes nor contains JavaScript.
The host may inline only supported safe CSS and must explicitly warn about omitted
CSS, math fallback, script omission and unsupported content. It must not load remote
resources while generating output. Local images remain subject to their attachment
grant; receiving apps may filter images or styles.
If the response must group excess warnings, add an `additional-warnings` warning
instead of silently dropping the remaining diagnostics.

`editor.read`, `clipboard.write` and an explicit user command are mandatory;
`files.export` is not needed. Check used permissions and workspace immediately
before writing. The return value is `{ copied: true, editorId, documentId, revision,
warnings }`; failures use `PluginError` and must not report success. Use the
existing HTML export budgets and retain a single output transaction per runtime.

Form blocks may declare up to six unique `submitActions`; the host validates all
declared commands and passes the action ID and current validated values in the
user-authorized submission. Existing single-submit forms retain their behavior.
Plugins using these additions require `^0.1.12` until a later compatible protocol
is available. SDK package 0.1.14 is still unreleased source preparation.
