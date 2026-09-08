# NoteGen Plugin SDK

This repository contains `@notegen/plugin-api`, the public TypeScript contract
implemented by the NoteGen plugin host. It covers manifests, permissions, UI
contributions, lifecycle functions, runtime context types, and stable plugin
error codes. It has no runtime dependencies and does not require DOM types.

The repository is intentionally scoped to the plugin ecosystem. It is not a
general client SDK for NoteGen data, sync, or a future server API.

## Development

Requirements: Node.js and pnpm.

```bash
pnpm install
pnpm check:contract
pnpm build
```

The npm package version and the host protocol version are related but distinct.
The package metadata records the protocol exposed as `PLUGIN_API_VERSION`.
A breaking host contract change requires a new protocol major version;
additive, backward-compatible changes use a minor protocol version. Package-only
fixes may use a patch release without changing the protocol version.

Plugin source should use type-only imports whenever possible:

```ts
import type { PluginActivate } from '@notegen/plugin-api'

export const activate: PluginActivate = async (context) => {
  context.commands.handle('com.example.hello.open', async () => {
    await context.ui.showNotice('Hello from NoteGen')
  })
}
```

The current community runtime loads one self-contained ESM entry file. It does
not resolve package imports at runtime, so bundle all value imports and other
dependencies into that entry before packaging a plugin.

## Distribution status

`@notegen/plugin-api` has not yet been published to npm. Until the first
release is available, plugin authors should follow the plain-JavaScript path
described in the [NoteGen documentation](https://notegen.top).

The plugin marketplace catalog and downloadable plugin packages live in the
separate [`codexu/note-gen-plugins`](https://github.com/codexu/note-gen-plugins)
repository.

Packaging and validation tools, host test utilities, and a project scaffold may
join this repository later. It will become a workspace only when a second real
package exists.
