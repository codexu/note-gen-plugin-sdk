# Document publisher example

Requires SDK 0.1.9 and a host implementing protocol 0.1.7.

The right sidebar renders unsaved Markdown or generated HTML, previews the returned document handle, copies the same result as rich text and exports a standalone HTML file. Changes to the source invalidate output until refresh. The optional editor-style grant is needed only by the Style/Reset editor commands. Replaced document handles are released; the host clears remaining handles and styles when the runtime stops.

Use `documents.render({ markdown, css, target: 'wechat', images })` for publishing or `{ html, css, target: 'html' }` for generated reports. `images` maps source references to approved raster data URLs; read attachments under a separate `attachments.read` grant. Rendering never fetches remote resources.

Generic output is also available within user-invoked commands:

```ts
await context.clipboard.write({ text: 'Plain text' })
await context.clipboard.write({ text: 'Formatted text', html: '<p><strong>Formatted text</strong></p>' })
await context.files.export({ fileName: 'report.csv', mimeType: 'text/csv', text: 'name,count\nNotes,3' })
await context.files.export({ fileName: 'image.png', mimeType: 'image/png', base64: approvedImageBase64 })
```

A cancelled save returns `{ saved: false }`. Handle `PermissionDenied`, `UnavailableOnPlatform`, `QuotaExceeded` and expired document IDs rather than claiming success. User action authorization applies to the pending command for that plugin; it does not replace permission grants or provide a separate token for each concurrent RPC.

See [host contract and budgets](../../HOST-DOCUMENT-INTEGRATION.md) and the full official `markdown-publisher` plugin for localized templates, image mapping, persistent settings and form errors.
