# Resource and preview extensions — protocol 0.1.2

SDK packages 0.1.4 implement this contract (host protocol 0.1.2). Older JavaScript plugins retain their entry, permissions and activation behavior; compatible ranges such as `^0.1.0` still match. New extensions should declare `apiVersion: ">=0.1.2"`.

## Local SDK development

Develop API types, resource contracts, validators and CLI packaging in this SDK repository on `main`. NoteGen consumes `@notegen/plugin-api` from npm at version `0.1.4`; it contains only host integration, with no vendored API copy or committed local dependency link. Local linking is optional during SDK development and must be removed before delivering the host. The SDK package exports compiled `dist` files.

## Package shape and lifecycle

`PluginManifestV1.resources` may contain `themes`, `languages`, `fileIcons` and `documentPreviews`. A package may omit `entry` if it has non-empty resources and no runtime contributions or activation events. Such packages do not start the JavaScript worker. Only packages providing previews may request `attachments.read`; a scriptless theme/language/icon pack needs no permissions.

Resources use the existing marketplace archive, signature, integrity manifest, install, enable, update, rollback and uninstall flow. They register only while enabled in the current workspace, on desktop. Development packages also require Developer Mode. Resource paths are canonical, portable, package-relative paths; each resource is limited to 5 MiB. Existing archive/file-count/total-size limits still apply. The CLI copies referenced language files, preview scripts and assets into the integrity-protected package when building.

## Themes

Each theme declares `id`, `name`, `light` and `dark`. The palettes accept only `PLUGIN_THEME_TOKENS`, with HSL triples `[hue, saturation, lightness]`: 0–360, 0–100, 0–100. Omitted tokens inherit built-in colors. Arbitrary CSS, fonts and remote resources are not part of the theme contract.

Enable the package, then select the theme in interface settings. Selection is device-local and shared across windows through local storage. Precedence is built-in colors → selected theme → non-null user custom colors, separately for light and dark. Disable/uninstall removes the theme’s colors immediately; the stored selection is retained so re-enabling can restore it. The selector displays built-in colors while that theme is unavailable.

## Languages

Each language declares `locale`, `name` and a `messages` JSON path. JSON uses the same nested key structure as NoteGen, including `common`. A language can introduce a new locale or override part of an existing locale. Empty objects are valid; message leaves must be strings. Duplicate JSON keys, unsafe keys and excessive nesting are rejected. Before registration, the host parses ICU messages and compares argument/tag names and object/string structure against its built-in Chinese fallback.

Missing keys fall back to the built-in version of the selected locale, then Chinese. A new language falls back to Chinese. When packages overlap, the lexically earlier plugin id has priority for matching keys. Built-in language choices remain available. Selection changes reload messages without reloading the application; startup restores a saved package language when the plugin host finishes registration. Until then, and after disabling/uninstalling the provider, the built-in default is displayed. The saved locale is retained for re-enabling.

## File and folder icons

Manifest rules use `kind: "file" | "folder"`, optional exact `path`, optional lowercase file `extension`, and either `icon: {name: "book-open"}` or `icon: {emoji: "📝"}`. Every supplied condition must match. The first matching rule wins within a provider; providers are ordered by plugin id. Built-in icon names use the host’s existing `PluginIcon` catalog; unknown names show its fallback icon. SVG and arbitrary image/CSS icons are not accepted.

JavaScript plugins can replace their rules atomically with `await context.fileIcons.setRules(rules)` (maximum 500), and restore manifest rules with `await context.fileIcons.clear()`. Runtime rules take precedence over that same plugin’s manifest rules. They are owned by the runtime that registered them and cleared when it stops, fails or is disabled. Persist user assignments with the existing storage API and restore them during activation. For separate editor windows, include `onEditor:markdown` activation.

File trees and editor tabs use the same resolver. Its bounded cache includes the current path and kind, and is invalidated on provider updates/removal. Path rules describe locations: moving or renaming a file resolves the new path; the rule does not automatically follow the moved file. A plugin that wants identity-following assignments must update its stored rules using permitted note change events. No filesystem access is granted merely by registering an icon.

## Document previews

Each preview declares `id`, `name`, lowercase `extensions`, a self-contained classic JavaScript `script` and optional `assets`. It handles extensions for which NoteGen has no built-in editor. Overlaps use plugin-id order; there is no renderer chooser in this first version.

The host creates a trusted outer iframe containing a sandboxed renderer. The outer document permits only blob frame navigation, so renderer self-navigation cannot load an external site. The renderer uses `sandbox="allow-scripts"`, an opaque origin and restrictive CSP. It gives the iframe no Tauri bridge or parent DOM access. Bundled scripts, blob workers, local images/fonts and declared WASM assets are supported; network fetches, nested frames and forms are blocked by CSP. WASM package files must appear in a preview’s asset list. The host does not install PDF.js, docx-preview, LibreOffice or a document-to-Markdown conversion pipeline for previews.

On iframe load, it receives `PluginPreviewInit` (`type: "notegen:preview-init"`, `protocol: 1`, document `name`, `sizeLimit`) and a private `MessagePort` in `event.ports[0]`. Register the message listener synchronously in the preview script. Send `PluginPreviewRequest` messages on that port:

```ts
{ id: 1, method: 'readDocument', offset: 0, length: 1048576 }
{ id: 2, method: 'readAsset', path: 'fonts/example.woff2' }
```

Replies are `{id, result: Uint8Array}` or `{id, error: string}`. Document reads are bound to the currently displayed file; requests cannot supply another path. `attachments.read` must be granted for that file. Reads recheck workspace, package fingerprint and authoritative permission before and after I/O. The native reader checks containment and refuses files over 256 MiB. Each request reads at most 1 MiB; an empty response indicates EOF. A preview may have two requests in flight, at most 4096 requests and a 512 MiB aggregate read budget. Assets must be declared by that particular preview and match the installed package hash.

The optional init `locale` field carries the NoteGen interface language. Use it for preview translations; unsupported locales or older hosts that omit the field should fall back to English. Do not select the interface language from `navigator.language`.

If init includes `capabilities: {statusBar: true}`, the renderer may send `{type: 'notegen:preview-status', text: '681 rows × 5 columns'}` on its private port. This notification has no reply and counts toward the 4096-message budget. Text is plain text, limited to 240 UTF-16 code units; empty text clears it. The host renders it in NoteGen's existing editor status slot only while that preview is active. It is owned by the file/provider instance and disappears on close, failure, workspace change or provider removal. Older hosts omit the capability; renderers should retain an in-preview fallback instead of accessing parent DOM.

Closing the preview, changing the workspace or removing the provider disposes the port and iframe. Late replies are discarded. Report errors inside the preview; uncaught exceptions and rejected promises also appear in the host with its ordinary unsupported-file fallback. An iframe is an isolation boundary, not a CPU/memory quota: a badly behaved renderer can still consume resources in the webview. This needs desktop runtime validation before shipping broadly.

## Reviewable examples

- `examples/resource-pack`: no JavaScript; theme, partial French messages and static icons.
- `examples/icon-provider`: runtime file/folder rules through the public context.
- `examples/document-preview`: an `.ngpreview` renderer reading one document chunk and a declared caption asset. This is a protocol example, not a PDF or Office implementation.

After building the SDK when authorized, invoke `node packages/plugin-cli/dist/bin.js build examples/resource-pack` from the SDK root. The generated `.notegen/package` directory is the development import target. Copy `examples/document-preview/sample.ngpreview` into a workspace before granting the example access.

## Validation status and remaining acceptance work

The local SDK package builds and all 16 contract/CLI tests passed for this release; the three examples also built into development packages. The publishing workflow repeats the package builds and contract/CLI suites. This does not validate the NoteGen desktop integration: host builds and desktop interaction remain separate acceptance work. Before shipping the host, exercise:

1. Install/enable, restart, update, rollback, disable and uninstall each example.
2. Theme selection, dark/light changes, user overrides and independent windows.
3. New-language startup, missing-key fallback, invalid ICU placeholders and removal of the selected language.
4. Icon updates, runtime replacement, renamed/moved paths, disabled providers and editor windows.
5. Preview permission denial/revocation, workspace changes during reads, changed package hashes, unsafe assets, over-limit reads and renderer exceptions.

Full PDF/Office renderers, file identity tracking for icons, theme CSS/font assets, mobile execution and renderer selection UI are outside this first implementation.
