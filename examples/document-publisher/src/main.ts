import type { PluginActivate, PluginRenderedDocument, PluginRenderDocumentOptions, ActiveEditorContext } from '@notegen/plugin-api'

// No DOM, browser clipboard or filesystem globals are required in plugin code.
export const activate: PluginActivate = async context => {
  const id = context.plugin.id
  const view = `${id}.preview`
  const css = '.article h2 { color: #2563eb; } .article blockquote { border-left: 3px solid #2563eb; }'
  let rendered: PluginRenderedDocument | null = null
  let generation = 0
  let source: Pick<ActiveEditorContext, 'editorId' | 'revision'> | null = null
  let stale = false

  async function publish() {
    await context.ui.views.update(view, { blocks: [
      { type: 'toolbar', id: 'actions', label: 'Document actions', actions: [
        { id: 'render', label: 'Render Markdown', command: `${id}.render` },
        { id: 'html', label: 'Generate HTML', command: `${id}.html` },
        { id: 'copy', label: 'Copy', command: `${id}.copy`, disabled: !rendered || stale },
        { id: 'export', label: 'Export', command: `${id}.export`, disabled: !rendered || stale },
        { id: 'style', label: 'Style editor', command: `${id}.style` },
        { id: 'reset', label: 'Reset editor', command: `${id}.reset` },
      ] },
      ...(stale ? [{ type: 'text' as const, text: 'Source changed; render again before exporting.' }] : []),
      ...(rendered ? [
        { type: 'document-preview' as const, id: 'article', title: 'Article preview', documentId: rendered.id, width: 'mobile' as const },
        ...rendered.warnings.map(warning => ({ type: 'text' as const, text: warning.message })),
      ] : []),
    ] })
  }

  async function render(options: PluginRenderDocumentOptions, snapshot: typeof source) {
    const request = ++generation
    const value = await context.documents.render(options)
    if (request !== generation) { await context.documents.release(value.id); return }
    const current = snapshot ? await context.editor.getActiveEditor() : null
    const previous = rendered
    rendered = value; source = snapshot
    stale = Boolean(snapshot && (!current || current.editorId !== snapshot.editorId || current.revision !== snapshot.revision))
    if (previous) await context.documents.release(previous.id)
    await publish()
  }

  async function freshDocument(): Promise<PluginRenderedDocument> {
    if (!rendered || stale) throw new Error('Render the document before exporting')
    if (source) {
      const current = await context.editor.getActiveEditor()
      if (!current || current.editorId !== source.editorId || current.revision !== source.revision) {
        stale = true; await publish(); throw new Error('Source changed; render it again')
      }
    }
    return rendered
  }

  context.commands.handle(`${id}.render`, async () => {
    const editor = await context.editor.getActiveEditor()
    if (!editor) throw new Error('Open a Markdown document first')
    const snapshot = await context.editor.getTextSnapshot({ editorId: editor.editorId, expectedRevision: editor.revision, format: 'markdown' })
    await render({ markdown: snapshot.text, css, title: 'Article', target: 'wechat' }, { editorId: editor.editorId, revision: snapshot.revision })
  })
  context.commands.handle(`${id}.html`, async () => {
    await render({ html: '<h2>Generated report</h2><p>Plugins can export generated documents too.</p>', css, target: 'html' }, null)
  })
  context.commands.handle(`${id}.copy`, async () => {
    const value = await freshDocument()
    await context.clipboard.write({ documentId: value.id })
    await context.ui.showNotice('Formatted article copied')
  })
  context.commands.handle(`${id}.export`, async () => {
    const value = await freshDocument()
    const result = await context.files.export({ documentId: value.id, fileName: 'article.html' })
    if (result.saved) await context.ui.showNotice('Article exported')
  })
  context.commands.handle(`${id}.style`, async () => { await context.editor.setStyles({ css }) })
  context.commands.handle(`${id}.reset`, async () => { await context.editor.clearStyles() })
  const invalidate = async () => { if (source) { generation++; stale = true; await publish() } }
  context.editor.onDidChangeActiveEditor(invalidate)
  context.editor.onDidChangeContent(invalidate)
  // Runtime shutdown releases documents and editor styles automatically.
  await publish()
}
