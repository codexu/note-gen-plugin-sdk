# Markdown code block renderers — development contract

Status: API/CLI and the PlantUML development package have been built locally; runtime behavior has not been tested and nothing has been published. Scope: static editor previews on desktop. The resource channel uses protocol **1**, independent of the QuickJS API/RPC version. This change adds no general editor/file/network permission and does not change `PLUGIN_API_VERSION`.

## Declaration and ownership

Declare `resources.codeBlockRenderers` entries with `id`, localized `name`, lowercase `languages`, `script` and optional `assets`. The script is a self-contained classic browser bundle. Each renderer receives only its matching block's source, language, interface locale, theme and opaque request ID. It never receives the note path, other blocks, editor identity, a Tauri bridge or a general plugin context.

```json
{
  "resources": {
    "codeBlockRenderers": [{
      "id": "plantuml", "name": "%renderer.name%",
      "languages": ["plantuml", "puml"],
      "script": "dist/renderer.js",
      "assets": ["dist/plantuml.js", "dist/viz-global.js"]
    }]
  }
}
```

Entry-less resource packages remain supported. No activation event or QuickJS runtime is required. Assets are covered by the package integrity manifest, canonical package paths and existing package limits. Both CLI and native host accept WASM only when explicitly declared in a document-preview or code-block-renderer asset list.

Before enabling a renderer, the host explains the scoped code-block disclosure; approval is bound to the exact package fingerprint. Multiple renderers for one language require an explicit device-local, per-workspace default selection. The host does not silently choose by plugin ID. Provider removal restores ordinary editable code blocks.

## Plugin helper

Register synchronously when the resource bundle executes:

```ts
import { registerCodeBlockRenderer } from '@notegen/plugin-api'

registerCodeBlockRenderer(async (request, context) => {
  const bytes = await context.readAsset('dist/my-engine.js')
  // Load the declared bundled engine, then produce a static result.
  const svg = await renderWithEngine(bytes, request.source, request.theme)
  return { type: 'svg', svg }
})
```

The public helper is a browser-resource API, not `PluginContext`. Its structural browser types keep the core SDK compatible with non-DOM TypeScript environments. Results are `{type:'svg', svg:string}` or `{type:'png', bytes:Uint8Array}`. Do not send HTML, DOM references, executable SVG or external resources. Results are transient and never become Markdown content.

## Wire protocol

The trusted frame parent transfers one MessagePort with `{type:'notegen:code-block-renderer-init', protocol:1, token}`. The plugin helper accepts it once, from its parent only, and responds on that port with `{type:'renderer.ready', token}`.

Host to plugin:

- `{type:'host.render', request:{requestId, language, source, theme, locale}}`
- `{type:'host.asset', id, result:Uint8Array}` or `{type:'host.asset', id, error:string}`

Plugin to host:

- `{type:'renderer.result', requestId, result}` or `{type:'renderer.result', requestId, error:string}`
- `{type:'renderer.readAsset', id:number, path:string}`

Only assets declared by this particular renderer are readable. No document-read, network, navigation or arbitrary host RPC exists. Each result is bound to a request ID. The host validates authority and exact package/workspace identity before dispatch and after asynchronous work.

## Host behavior and limits

The host retains the ordinary `codeBlock` document node and its original Markdown language/source. Read-only previews in the large-note sectioned editor use the same service through transient React portals; their original pre/code nodes are restored on disposal, and Edit source activates the existing section editor. The existing editor owns source editing, focus, keyboard selection, undo and serialization. A preview is a presentation layer; errors reveal source without stealing focus. Keyboard movement into a block reveals its editable source. Source mode, copy, PDF/HTML exports and generated-document APIs are unchanged by this phase; no claim of diagram export support is made.

Each renderer has one shared opaque iframe per window/workspace, a serial queue and an in-memory cache. Rendering activates near the viewport and is debounced by 300 ms. Source/result ownership prevents stale images after edits, provider changes, locale/theme changes and workspace switches. Aborted queued work is removed; an already-running synchronous engine may finish, but its result is discarded. Disablement, replacement, developer-mode revocation and workspace switches destroy the frame. Unused services are released after 30 seconds.

- Input: 128 KiB UTF-8 per block; output: 2 MiB.
- SVG/PNG dimensions: at most 8192 on each side and 16,777,216 pixels.
- Queue: 32 pending jobs per service; one dispatched render at a time.
- Cache: at most 32 entries and 8 MiB of raw result content per service.
- Init/render timeout: 15 seconds; timeout disposes the service, so a retry creates a fresh instance.
- Assets: existing 5 MiB per-file package limit; two reads in flight, 256 reads and 32 MiB total per service.

SVG is rebuilt from an element/attribute/style allowlist and displayed as an image, never injected as host HTML. PNG signature and dimensions are validated. Frames have an opaque origin, restrictive CSP and no parent DOM access. Network requests, external script URLs, frame navigation and forms are blocked. Blob workers are permitted for engines that support them.

An iframe is not a guaranteed independent thread or a hard CPU/memory limit. Prefer Workers for compatible engines. PlantUML's current browser engine requires SVG DOM measurement and uses the isolated frame. Its plugin additionally limits source to 32 KiB/1,000 lines. Responsiveness still needs real desktop verification.

## Integration and compatibility

SDK source changes: public types/helper, resource validation/path enumeration, JSON schema, CLI localization and declared-WASM checks. The CLI's existing resource collection automatically packages the new scripts/assets. No QuickJS RPC registry or bootstrap method is added.

The NoteGen host uses an explicit Zod validation adapter for this resource-only protocol. Until SDK 0.1.12 is published, its npm dependency remains at 0.1.11 and its QuickJS API version remains 0.1.9. After publication, update the host's package dependency and regenerate its lockfile using the published package. Keep `code-block-contract.ts`, this SDK contract and native validation aligned when changing protocol 1.

Older hosts reject the unknown manifest resource. All 12 preview plugins require `minAppVersion: "0.38.3"`. The four SDK npm packages are prepared as 0.1.12, with internal workspace dependencies requiring at least 0.1.12. `PLUGIN_API_VERSION` and package `notegen.pluginApiVersion` remain 0.1.9; the renderer resource channel remains protocol 1. SDK package versions and plugin API protocol versions are separate compatibility boundaries.

The official plugin workspace requires `workspace:^0.1.12` for these plugins' API/CLI dependencies and for its root API/test tools. Its lockfile mirrors the SDK's internal dependency declarations. Before pushing that dependency update, set `PLUGIN_SDK_REF` to the reviewed SDK commit containing both the renderer API and the version preparation; the SHA can only be chosen after that commit exists. This preparation does not update repository variables, push commits, trigger workflows or publish packages.

## Deferred validation

Earlier development builds of the SDK API/CLI and PlantUML package succeeded. Those results predate the 0.1.12 version/dependency preparation and do not validate the current snapshot. No tests, lint, type checks or builds were run for this preparation. Nothing has been published. Remaining acceptance work, only when separately authorized:

1. Build SDK first, then the PlantUML resource assets and plugin archive; verify schema/native/SDK manifest parity and package integrity.
2. Enable/disable/update/uninstall; approval disclosure and exact-package review, including empty-permission resource packages.
3. Render two independent diagrams, duplicate diagrams and different languages, then switch two matching providers; exercise split panes/windows and different notes with identical source.
4. Edit/undo/redo, switch source/preview, navigate by keyboard, copy source, reopen the Markdown and verify no generated output was saved.
5. Rapid input, errors, unsupported includes, dark/light themes, locale changes, long/narrow diagrams and complex diagrams while typing elsewhere.
6. Switch workspaces, revoke Developer Mode and disable/update the plugin during a render or asset read; no stale content or engine remains.
7. Invalid SVG/PNG, external links/images, oversize output, failing scripts, timeouts and retry. Confirm that renderer content cannot cause host DOM access or remote requests.
8. Existing ordinary code blocks, Mermaid, document previews and file icons keep their current behavior. Mobile execution is not enabled by this phase.
