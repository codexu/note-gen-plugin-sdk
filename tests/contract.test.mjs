import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PLUGIN_API_VERSION,
  PLUGIN_HTML_EXPORT_LIMITS,
  validatePluginExportHtmlOptions,
  validatePluginCopyHtmlOptions,
  registerView,
  readNoteProperties,
  updateNoteProperties,
  createTaskQueue,
  generateJson,
  isValidPluginMenuCondition,
  matchesPluginMenuCondition,
  flattenPluginUiBlocks,
  definePluginManifest,
  isPluginError,
  PluginError,
} from '../packages/plugin-api/dist/index.js'
import { validatePluginManifest } from '../packages/plugin-cli/dist/index.js'
import { createPluginTestHost } from '../packages/plugin-test/dist/index.js'

const manifest = definePluginManifest({
  manifestVersion: 1,
  id: 'com.example.contract',
  name: 'Contract fixture',
  version: '1.0.0',
  apiVersion: '^0.1.0',
  minAppVersion: '0.37.0',
  platforms: ['desktop'],
  entry: 'dist/main.js',
  activationEvents: ['onWorkspace:open', 'onNotes:change'],
  permissions: {
    'editor.read': { scope: 'active-editor' },
    'editor.write': { scope: 'active-editor' },
    'notes.read': { scope: 'workspace-folder' },
    'notes.create': { scope: 'workspace-folder' },
    'notes.open': { scope: 'workspace-folder' },
    'notes.list': { scope: 'workspace-folder' },
    'notes.write': { scope: 'workspace-folder' },
    'notes.delete': { scope: 'workspace-folder' },
    'notes.move': { scope: 'workspace-folder' },
    'network.fetch': { scope: 'network-origins', optional: true },
  },
  contributes: {
    commands: [{ id: 'com.example.contract.refresh', title: 'Refresh' }],
    views: [{ id: 'com.example.contract.view', title: 'Details', location: 'right-sidebar' }],
    statusBar: [{ id: 'com.example.contract.status', alignment: 'right' }],
  },
})

test('API metadata and manifest validator agree on API 0.1', () => {
  assert.equal(PLUGIN_API_VERSION, '0.1.12')
  assert.equal(validatePluginManifest(manifest).id, manifest.id)
})

test('document output uses owned handles, explicit commands and separate grants', async () => {
  const outputManifest = {
    ...manifest,
    apiVersion: '^0.1.7',
    permissions: {
      'clipboard.write': { scope: 'application' },
      'files.export': { scope: 'application' },
    },
  }
  assert.equal(validatePluginManifest(outputManifest).apiVersion, '^0.1.7')
  const exported = []
  const host = createPluginTestHost({
    manifest: outputManifest,
    permissions: { 'clipboard.write': true, 'files.export': true },
    renderDocument: async ({ markdown }) => ({ html: `<p>${markdown}</p>`, text: markdown, warnings: [] }),
    exportFile: async (options, document) => { exported.push({ options, document }); return { saved: true } },
  })
  await host.activate({ activate() {} })
  const document = await host.context.documents.render({ markdown: 'hello', target: 'wechat' })
  await assert.rejects(host.context.clipboard.write({ documentId: document.id }), error => error.code === 'PermissionDenied')
  host.context.commands.handle('com.example.contract.refresh', async () => {
    await host.context.clipboard.write({ documentId: document.id })
    return host.context.files.export({ fileName: 'article.html', documentId: document.id })
  })
  assert.deepEqual(await host.executeCommand('com.example.contract.refresh'), { saved: true })
  assert.deepEqual(host.clipboard, { html: '<p>hello</p>', text: 'hello' })
  assert.equal(exported[0].document.id, document.id)
  host.setPermission('files.export', false)
  await assert.rejects(host.executeCommand('com.example.contract.refresh'), error => error.code === 'PermissionDenied')
  await host.context.documents.release(document.id)
  await assert.rejects(host.executeCommand('com.example.contract.refresh'), error => error.code === 'NotFound')
  await host.deactivate()
})

const htmlEditor = {
  windowId: 'main', editorId: 'html-editor', documentId: 'html-note', path: 'Notes/unsaved.md',
  kind: 'markdown', mode: 'source', revision: 7, composing: false,
  size: { utf16Length: 0, bytes: 0, lines: 1 },
}
const htmlRequest = { editorId: htmlEditor.editorId, expectedRevision: htmlEditor.revision }

test('HTML copy validates its format and rejects file or rendered HTML transport', () => {
  assert.equal(validatePluginCopyHtmlOptions({ ...htmlRequest, format: 'source', css: 'p { color: red }' }).format, 'source')
  assert.equal(validatePluginCopyHtmlOptions({ ...htmlRequest, format: 'rich-text', javascript: 'ignored()' }).format, 'rich-text')
  for (const request of [null, [], htmlRequest, { ...htmlRequest, format: 'html' }, { ...htmlRequest, format: 'source', fileName: 'a.html' }, { ...htmlRequest, format: 'source', html: '<p>x</p>' }]) {
    assert.throws(() => validatePluginCopyHtmlOptions(request), { code: 'InvalidPath' })
  }
  assert.throws(() => validatePluginCopyHtmlOptions({ ...htmlRequest, format: 'source', css: 'x'.repeat(10001) }), { code: 'QuotaExceeded' })
})

async function createHtmlCopyHost(copyHtml) {
  const host = createPluginTestHost({
    manifest: { ...manifest, apiVersion: '^0.1.12', permissions: {
      'editor.read': { scope: 'active-editor' },
      'clipboard.write': { scope: 'application' },
      'attachments.read': { scope: 'workspace-folder', optional: true },
    } },
    editor: { active: htmlEditor, text: '# Unsaved content' },
    copyHtml,
  })
  await host.activate({ activate(context) {
    context.commands.handle('com.example.contract.refresh', argument => context.documents.copyHtml(argument))
  } })
  return host
}

test('HTML copy requires a user command and clipboard grant, not files.export', async () => {
  let job
  const host = await createHtmlCopyHost(async current => {
    job = current
    assert.equal(current.snapshot.text, '# Unsaved content')
    assert.equal(Object.isFrozen(current.snapshot), true)
    current.assertCanWrite()
    return { copied: true, warnings: [{ code: 'rich-text-script-omitted', message: 'Script omitted' }, { code: 'additional-warnings', message: 'Additional warnings grouped' }] }
  })
  const request = { ...htmlRequest, format: 'rich-text', javascript: 'ignored()' }
  assert.equal(host.context.plugin.capabilities.includes('html-copy'), true)
  await assert.rejects(host.context.documents.copyHtml(request), { code: 'PermissionDenied' })
  assert.deepEqual(await host.executeCommand('com.example.contract.refresh', request), {
    copied: true, editorId: htmlEditor.editorId, documentId: htmlEditor.documentId, revision: 7,
    warnings: [{ code: 'rich-text-script-omitted', message: 'Script omitted' }, { code: 'additional-warnings', message: 'Additional warnings grouped' }],
  })
  assert.throws(() => job.assertCanWrite(), { code: 'Cancelled' })
  host.setPermission('clipboard.write', false)
  await assert.rejects(host.executeCommand('com.example.contract.refresh', request), { code: 'PermissionDenied' })
  await host.deactivate()
})

test('HTML copy aborts on clipboard revocation without returning adapter content', async () => {
  let started
  const ready = new Promise(resolve => { started = resolve })
  const host = await createHtmlCopyHost(async job => {
    started(job)
    return new Promise(() => {})
  })
  const pending = host.executeCommand('com.example.contract.refresh', { ...htmlRequest, format: 'source' })
  const job = await ready
  host.setPermission('clipboard.write', false)
  await assert.rejects(pending, { code: 'PermissionDenied' })
  assert.equal(job.signal.aborted, true)
  await host.deactivate()
})

test('form submit actions require unique IDs and declared user commands', async () => {
  const host = createPluginTestHost({ manifest })
  await host.activate({ activate() {} })
  const form = {
    type: 'form', id: 'export', command: 'com.example.contract.refresh', submitLabel: 'Export',
    fields: [{ id: 'template', label: 'Template', type: 'select', options: [{ value: 'default', label: 'Default' }] }],
    submitActions: [{ id: 'file', label: 'Export file', command: 'com.example.contract.refresh' }, { id: 'copy', label: 'Copy', command: 'com.example.contract.refresh', variant: 'secondary' }],
  }
  await host.context.ui.views.update('com.example.contract.view', { blocks: [form] })
  assert.equal(host.views['com.example.contract.view'].blocks[0].submitActions.length, 2)
  await assert.rejects(host.context.ui.views.update('com.example.contract.view', { blocks: [{ ...form, submitActions: [form.submitActions[0], form.submitActions[0]] }] }), { code: 'InvalidPath' })
  await assert.rejects(host.context.ui.views.update('com.example.contract.view', { blocks: [{ ...form, submitActions: [{ ...form.submitActions[0], command: 'other.plugin.command' }] }] }), { code: 'PermissionDenied' })
  await host.deactivate()
})

async function createHtmlExportHost(exportHtml, options = {}) {
  const host = createPluginTestHost({
    manifest: {
      ...manifest,
      apiVersion: '^0.1.11',
      permissions: {
        'editor.read': { scope: 'active-editor' },
        'files.export': { scope: 'application' },
        'attachments.read': { scope: 'workspace-folder' },
        'attachments.create': { scope: 'workspace-folder' },
      },
    },
    editor: { active: htmlEditor, text: '# Unsaved content' },
    exportHtml,
    ...options,
  })
  await host.activate({
    activate(context) {
      context.commands.handle('com.example.contract.refresh', argument => context.documents.exportHtml(argument ?? htmlRequest))
    },
  })
  return host
}

test('HTML export accepts only bounded editor requests and portable filenames', () => {
  assert.deepEqual(validatePluginExportHtmlOptions({ ...htmlRequest, fileName: '报告.html', css: 'a'.repeat(10000), javascript: '' }).editorId, htmlEditor.editorId)
  for (const request of [
    null, [], {}, { ...htmlRequest, html: '<p>untrusted</p>' },
    { ...htmlRequest, expectedRevision: -1 }, { ...htmlRequest, expectedRevision: NaN },
    { ...htmlRequest, expectedRevision: 1.5 }, { ...htmlRequest, css: null },
    { ...htmlRequest, javascript: 1 },
  ]) assert.throws(() => validatePluginExportHtmlOptions(request), { code: 'InvalidPath' })
  for (const fileName of ['../report.html', 'a:b.html', 'a?.html', 'a*.html', 'report.', 'report ', '', 'a\u0000.html']) {
    assert.throws(() => validatePluginExportHtmlOptions({ ...htmlRequest, fileName }), { code: 'InvalidPath' })
  }
  for (const field of ['css', 'javascript']) {
    assert.throws(() => validatePluginExportHtmlOptions({ ...htmlRequest, [field]: 'a'.repeat(PLUGIN_HTML_EXPORT_LIMITS.codeCharacters + 1) }), { code: 'QuotaExceeded' })
  }
})

test('HTML export captures unsaved content once and returns metadata without HTML or destination paths', async () => {
  let job
  const host = await createHtmlExportHost(async current => {
    job = current
    assert.equal(current.snapshot.text, '# Unsaved content')
    assert.equal(current.sourcePath, 'Notes/unsaved.md')
    assert.equal(Object.isFrozen(current.snapshot), true)
    assert.equal(Object.isFrozen(current.options), true)
    await host.setActiveEditor({ ...htmlEditor, revision: 8 }, { text: '# Later edit' })
    current.assertCanWrite()
    return { saved: true, warnings: [{ code: 'highlight-fallback', message: 'Plain code' }] }
  })
  assert.equal(host.context.plugin.capabilities.includes('html-export'), true)
  await assert.rejects(host.context.documents.exportHtml(htmlRequest), { code: 'PermissionDenied' })
  assert.deepEqual(await host.executeCommand('com.example.contract.refresh'), {
    saved: true, editorId: htmlEditor.editorId, documentId: htmlEditor.documentId, revision: 7,
    warnings: [{ code: 'highlight-fallback', message: 'Plain code' }],
  })
  assert.equal(host.callHistory.filter(call => call.name === 'documents.exportHtml').length, 1)
  assert.equal(job.signal.aborted, true)
  assert.throws(() => job.assertCanWrite(), { code: 'Cancelled' })
  await host.deactivate()
})

test('HTML export requires an adapter, validates its result, and preserves save cancellation', async () => {
  const missing = await createHtmlExportHost()
  await assert.rejects(missing.executeCommand('com.example.contract.refresh'), { code: 'UnavailableOnPlatform' })
  await missing.deactivate()
  const cancelled = await createHtmlExportHost(async () => ({ saved: false, warnings: [] }))
  assert.deepEqual(await cancelled.executeCommand('com.example.contract.refresh'), {
    saved: false, editorId: htmlEditor.editorId, documentId: htmlEditor.documentId, revision: 7, warnings: [],
  })
  await cancelled.deactivate()
  const invalid = await createHtmlExportHost(async () => ({ saved: true, warnings: [], destination: '/private/report.html' }))
  await assert.rejects(invalid.executeCommand('com.example.contract.refresh'), { code: 'RuntimeFailure' })
  await invalid.deactivate()
})

test('HTML export rejects stale, composing, oversized and unauthorized sources before invoking the adapter', async () => {
  let calls = 0
  const adapter = async () => { calls++; return { saved: true, warnings: [] } }
  const host = await createHtmlExportHost(adapter)
  await assert.rejects(host.executeCommand('com.example.contract.refresh', { ...htmlRequest, expectedRevision: 6 }), { code: 'StaleRevision' })
  await assert.rejects(host.executeCommand('com.example.contract.refresh', { ...htmlRequest, editorId: 'different-editor' }), { code: 'NotFound' })
  await host.setActiveEditor({ ...htmlEditor, composing: true }, { text: 'Composing' })
  await assert.rejects(host.executeCommand('com.example.contract.refresh'), { code: 'EditorBusy' })
  await host.setActiveEditor(htmlEditor, { text: 'Stable' })
  host.setPermission('files.export', false)
  await assert.rejects(host.executeCommand('com.example.contract.refresh'), { code: 'PermissionDenied' })
  host.setPermission('files.export', true)
  host.setPermission('editor.read', false)
  await assert.rejects(host.executeCommand('com.example.contract.refresh'), { code: 'PermissionDenied' })
  await host.deactivate()
  const oversized = await createHtmlExportHost(adapter, { editor: { active: htmlEditor, text: 'a'.repeat(PLUGIN_HTML_EXPORT_LIMITS.markdownBytes + 1) } })
  await assert.rejects(oversized.executeCommand('com.example.contract.refresh'), { code: 'QuotaExceeded' })
  assert.equal(calls, 0)
  await oversized.deactivate()
})

test('HTML export attachment grants are separate and revocation cancels pending output', async () => {
  let entered
  let finish
  let job
  const started = new Promise(resolve => { entered = resolve })
  const host = await createHtmlExportHost(async current => {
    job = current
    await assert.rejects(current.readAttachment('Private/image.png'), { code: 'PermissionDenied' })
    const image = await current.readAttachment('Notes/image.png')
    assert.equal(image.size, 1)
    entered()
    return new Promise(resolve => { finish = resolve })
  }, { permissions: { 'attachments.read': { granted: true, paths: ['Notes'] } } })
  await host.context.attachments.create({ path: 'Notes/image.png', base64: 'AA==' })
  const pending = host.executeCommand('com.example.contract.refresh')
  await started
  const rejected = assert.rejects(pending, { code: 'PermissionDenied' })
  host.setPermission('attachments.read', { granted: true, paths: ['Elsewhere'] })
  await rejected
  assert.equal(job.signal.aborted, true)
  assert.throws(() => job.assertCanWrite(), { code: 'Cancelled' })
  finish({ saved: true, warnings: [] })
  await host.deactivate()
})

test('HTML export cancels on workspace switches and shutdown without waiting for an adapter', async t => {
  for (const reason of ['workspace', 'shutdown']) {
    await t.test(reason, async () => {
      let entered
      let finish
      let job
      const started = new Promise(resolve => { entered = resolve })
      const host = await createHtmlExportHost(async current => {
        job = current
        entered()
        return new Promise(resolve => { finish = resolve })
      })
      const pending = host.executeCommand('com.example.contract.refresh')
      await started
      const rejected = assert.rejects(pending, { code: reason === 'workspace' ? 'WorkspaceChanged' : 'Cancelled' })
      if (reason === 'workspace') {
        const previous = await host.context.workspace.getCurrent()
        await host.emitWorkspaceChange({ previous, current: { id: 'other-workspace', name: 'Other' } })
      } else await host.deactivate()
      await rejected
      assert.equal(job.signal.aborted, true)
      assert.throws(() => job.assertCanWrite(), { code: 'Cancelled' })
      finish({ saved: true, warnings: [] })
      await host.deactivate()
    })
  }
})

test('HTML export allows one transaction per runtime and releases it after cancellation', async () => {
  let entered
  let finish
  const started = new Promise(resolve => { entered = resolve })
  const host = await createHtmlExportHost(async () => {
    entered()
    return new Promise(resolve => { finish = resolve })
  })
  const first = host.executeCommand('com.example.contract.refresh')
  await started
  await assert.rejects(host.executeCommand('com.example.contract.refresh'), { code: 'QuotaExceeded' })
  finish({ saved: false, warnings: [] })
  assert.equal((await first).saved, false)
  const second = host.executeCommand('com.example.contract.refresh')
  await new Promise(resolve => setImmediate(resolve))
  finish({ saved: false, warnings: [] })
  assert.equal((await second).saved, false)
  await host.deactivate()
})

test('test host exercises note, editor, UI, and scoped network capabilities', async () => {
  const host = createPluginTestHost({
    manifest,
    notes: [{ path: 'Notes/a.md', content: 'a', revision: 1 }],
    permissions: {
      'notes.read': { granted: true, paths: ['Notes'] },
      'notes.list': { granted: true, paths: ['Notes'] },
      'notes.write': { granted: true, paths: ['Notes'] },
      'notes.delete': { granted: true, paths: ['Notes'] },
      'notes.move': { granted: true, paths: ['Notes'] },
      'network.fetch': { granted: true, paths: ['https://api.example.com'] },
    },
    editor: {
      active: {
        windowId: 'main', editorId: 'editor', documentId: 'note', kind: 'markdown',
        mode: 'source', revision: 1, composing: false,
        size: { utf16Length: 1, bytes: 1, lines: 1 },
      },
      text: 'a',
    },
    networkFetch: request => ({ url: request.url, status: 200, headers: {}, body: 'ok' }),
  })
  await host.activate({ activate() {} })
  assert.equal((await host.context.notes.list({ folder: 'Notes' })).entries.length, 1)
  const written = await host.context.notes.write({ path: 'Notes/a.md', content: 'ab', expectedRevision: 1 })
  assert.equal(Number.isSafeInteger(written.revision), true)
  assert.notEqual(written.revision, 1)
  assert.equal((await host.context.editor.applyEdit({ editorId: 'editor', expectedRevision: 1, target: 'cursor', text: 'b' })).applied, true)
  await host.context.ui.views.update('com.example.contract.view', { blocks: [{ type: 'text', text: 'ok' }] })
  assert.equal((await host.context.network.fetch({ url: 'https://api.example.com/v1' })).status, 200)
  const viewSnapshot = host.views['com.example.contract.view']
  assert.ok(viewSnapshot)
  assert.throws(() => {
    viewSnapshot.blocks[0].text = 'tampered'
  }, TypeError)
  assert.equal(host.views['com.example.contract.view'].blocks[0].text, 'ok')
})

test('test host mirrors note defaults, folder errors, and create events', async () => {
  const host = createPluginTestHost({
    manifest,
    folders: ['Empty'],
    notes: [
      { path: 'Notes/top.md', content: 'top' },
      { path: 'Notes/nested/child.md', content: 'child' },
    ],
  })
  await host.activate({ activate() {} })

  const root = await host.context.notes.list({ folder: 'Notes' })
  assert.deepEqual(root.entries.map(entry => entry.path), ['Notes/top.md'])
  assert.deepEqual((await host.context.notes.list({ folder: 'Empty' })).entries, [])
  await assert.rejects(
    host.context.notes.list({ folder: 'Missing' }),
    error => error?.code === 'NotFound',
  )

  const changes = []
  const listener = host.context.notes.onDidChange(event => changes.push(event))
  const created = await host.context.notes.openOrCreate({
    workspaceId: 'test-workspace',
    path: 'Notes/new.md',
    initialContent: 'new',
    conflict: 'open-existing',
    open: false,
    idempotencyKey: 'create-new-note',
  })
  assert.equal(created.status, 'created')
  assert.deepEqual(changes.at(-1), { type: 'created', path: 'Notes/new.md' })

  const beforeMove = host.notes.find(note => note.path === 'Notes/top.md')
  await host.context.notes.move({ from: 'Notes/top.md', to: 'Notes/top.md' })
  assert.equal(host.notes.find(note => note.path === 'Notes/top.md')?.revision, beforeMove?.revision)
  listener.dispose()
  await host.deactivate()
})

test('note move events are projected across permission boundaries', async () => {
  const host = createPluginTestHost({
    manifest,
    notes: [{ path: 'Private/source.md', content: 'source' }],
    permissions: {
      'notes.read': { granted: true, paths: ['Private'] },
      'notes.list': { granted: true, paths: ['Private'] },
      'notes.move': { granted: true, paths: ['Private', 'Public'] },
    },
  })
  await host.activate({ activate() {} })
  const changes = []
  host.context.notes.onDidChange(event => changes.push(event))

  await host.context.notes.move({ from: 'Private/source.md', to: 'Public/source.md' })
  assert.deepEqual(changes, [{ type: 'deleted', path: 'Private/source.md' }])
  assert.equal(Object.hasOwn(changes[0], 'previousPath'), false)
  await host.deactivate()
})

test('status bar updates use trailing coalescing', async () => {
  let now = new Date('2026-01-01T00:00:00.000Z')
  const host = createPluginTestHost({ manifest, now: () => now })
  await host.activate({ activate() {} })

  await host.context.ui.statusBar.update('com.example.contract.status', {
    visible: true,
    text: 'first',
  })
  await host.context.ui.statusBar.update('com.example.contract.status', {
    visible: true,
    text: 'last',
  })
  assert.equal(host.statusBar['com.example.contract.status']?.text, 'first')
  now = new Date(now.getTime() + 100)
  await new Promise(resolve => setTimeout(resolve, 120))
  assert.equal(host.statusBar['com.example.contract.status']?.text, 'last')
  await host.deactivate()
})

test('test host rejects UI and network input that production rejects', async () => {
  const host = createPluginTestHost({
    manifest,
    permissions: {
      'network.fetch': { granted: true, paths: ['https://api.example.com'] },
    },
    networkFetch: request => ({ url: request.url, status: 200, headers: {}, body: 'ok' }),
  })
  await host.activate({ activate() {} })

  await assert.rejects(
    host.context.ui.views.update('com.example.contract.view', {
      blocks: [{
        type: 'actions',
        actions: [{ id: 'bad', label: 'Bad', command: 'com.example.contract.undeclared' }],
      }],
    }),
    error => error?.code === 'PermissionDenied',
  )
  await assert.rejects(
    host.context.network.fetch({ url: 'http://api.example.com/v1' }),
    error => error?.code === 'PermissionDenied',
  )
  await assert.rejects(
    host.context.network.fetch({
      url: 'https://api.example.com/v1',
      headers: { Cookie: 'secret' },
    }),
    error => error?.code === 'PermissionDenied',
  )
  await assert.rejects(
    host.context.network.fetch({
      url: 'https://api.example.com/v1',
      headers: { 'Proxy-Authorization': 'secret' },
    }),
    error => error?.code === 'PermissionDenied',
  )
  await assert.rejects(
    host.context.network.fetch({
      url: 'https://api.example.com/v1',
      timeoutMs: 30_001,
    }),
    error => error?.code === 'InvalidPath',
  )
  await host.deactivate()
})

test('command and storage boundaries preserve top-level undefined and use production error codes', async () => {
  const commandId = 'com.example.contract.refresh'
  const host = createPluginTestHost({ manifest })
  await host.activate({
    activate(context) {
      context.commands.handle(commandId, argument => {
        if (argument === undefined) return undefined
        if (argument === 'invalid-result') return { nested: undefined }
        return { argument }
      })
    },
  })

  assert.equal(await host.executeCommand(commandId), undefined)
  assert.deepEqual(await host.executeCommand(commandId, { ok: true }), {
    argument: { ok: true },
  })
  await assert.rejects(
    host.executeCommand(commandId, { nested: undefined }),
    error => error?.code === 'RuntimeFailure',
  )
  await assert.rejects(
    host.executeCommand(commandId, Array(1)),
    error => error?.code === 'RuntimeFailure',
  )
  const accessorArgument = {}
  Object.defineProperty(accessorArgument, 'nested', {
    enumerable: true,
    get() {
      throw new Error('JSON validation must not invoke accessors')
    },
  })
  await assert.rejects(
    host.executeCommand(commandId, accessorArgument),
    error => error?.code === 'RuntimeFailure',
  )
  await assert.rejects(
    host.executeCommand(commandId, 'invalid-result'),
    error => error?.code === 'RuntimeFailure',
  )
  await assert.rejects(
    host.context.storage.device.set('invalid', { nested: undefined }),
    error => error?.code === 'QuotaExceeded',
  )
  await assert.rejects(
    host.context.storage.device.set('sparse', Array(1)),
    error => error?.code === 'QuotaExceeded',
  )
  await host.deactivate()
})

test('stable plugin errors survive structural checks', () => {
  const error = new PluginError('PermissionDenied', 'denied')
  assert.equal(isPluginError(error), true)
})


test('menu conditions reject code and fail closed for missing contexts', () => {
  assert.equal(isValidPluginMenuCondition('editor == markdown && selection && !readOnly'), true)
  assert.equal(matchesPluginMenuCondition('editor == markdown && selection && !readOnly', { editor: 'markdown', selection: true, readOnly: false }), true)
  assert.equal(matchesPluginMenuCondition('!readOnly', {}), false)
  assert.equal(matchesPluginMenuCondition('selection || resourceKind == file && resourceExt == md', { resourceKind: 'file', resourceExt: 'txt' }), false)
  for (const condition of ['selection &&', 'window.alert(1)', 'editor.constructor', '(selection)', 'unknown == true']) assert.equal(isValidPluginMenuCondition(condition), false)
})

test('nested UI validates command ownership and unique identities', async () => {
  const host = createPluginTestHost({ manifest })
  await host.activate({ activate() {} })
  const action = { id: 'refresh', label: 'Refresh', icon: 'refresh-cw', command: 'com.example.contract.refresh' }
  await host.context.ui.views.update('com.example.contract.view', { blocks: [
    { type: 'section', id: 'section', title: 'Details', blocks: [
      { type: 'toolbar', id: 'tools', label: 'Actions', actions: [action] },
      { type: 'item-list', id: 'items', generation: '1', label: 'Items', emptyText: 'Empty', items: [{ id: 'a', label: 'A', checked: false }], toggleCommand: action.command },
    ] },
  ] })
  assert.equal(flattenPluginUiBlocks(host.views['com.example.contract.view'].blocks).length, 3)
  const normalized = host.views['com.example.contract.view'].blocks[0]
  assert.equal(Object.hasOwn(normalized, 'collapsible'), false)
  assert.equal(Object.hasOwn(normalized.blocks[0].actions[0], 'argument'), false)
  assert.equal(Object.hasOwn(normalized.blocks[1].items[0], 'description'), false)
  await assert.rejects(host.context.ui.views.update('com.example.contract.view', { blocks: [{ type: 'section', id: 'section', title: 'Details', blocks: [{ type: 'toolbar', id: 'tools', label: 'Actions', actions: [{ ...action, command: 'other.plugin.command' }] }] }] }), error => error.code === 'PermissionDenied')
  await assert.rejects(host.context.ui.views.update('com.example.contract.view', { blocks: [{ type: 'item-list', id: 'items', generation: '1', label: 'Items', emptyText: '', items: [{ id: 'same', label: 'A' }, { id: 'same', label: 'B' }] }] }), error => error.code === 'InvalidPath')
  let blocks = [{ type: 'text', text: 'deep' }]
  for (let i = 0; i < 8; i++) blocks = [{ type: 'layout', id: String(i), blocks }]
  await assert.rejects(host.context.ui.views.update('com.example.contract.view', { blocks }))
})


test('scriptless resources validate payloads and reject unsafe or executable declarations', () => {
  const { entry: _entry, ...base } = manifest
  const pack = { ...base, activationEvents: [], permissions: {}, contributes: {}, resources: {
    themes: [{ id: 'sample', name: 'Sample', light: { primary: [210, 30, 40] }, dark: {} }],
    languages: [{ locale: 'fr', name: 'French', messages: 'fr.json' }],
  } }
  const files = new Map([['fr.json', Buffer.from('{"settings":{"title":"Réglages"}}')]])
  assert.equal(validatePluginManifest(pack, { files }).entry, undefined)
  assert.throws(() => validatePluginManifest(pack, { files: new Map() }))
  assert.throws(() => validatePluginManifest({ ...pack, activationEvents: ['onWorkspace:open'] }))
  assert.throws(() => validatePluginManifest({ ...pack, resources: { themes: [{ ...pack.resources.themes[0], light: { primary: [0, 101, 20] } }] } }))
  assert.throws(() => validatePluginManifest({ ...pack, resources: { languages: [{ locale: 'fr', name: 'French', messages: '../fr.json' }] } }))
  assert.throws(() => validatePluginManifest(pack, { files: new Map([['fr.json', Buffer.from('{"constructor":"bad"}')]]) }))
})

test('document preview requires permission and permits only declared WASM assets', () => {
  const { entry: _entry, ...base } = manifest
  const preview = { id: 'sample', name: 'Sample', extensions: ['ngpreview'], script: 'preview.js', assets: ['decoder.wasm'] }
  const pack = { ...base, activationEvents: [], contributes: {}, permissions: {}, resources: { documentPreviews: [preview] } }
  assert.throws(() => validatePluginManifest(pack))
  const permitted = { ...pack, permissions: { 'attachments.read': { scope: 'workspace-file' } } }
  const files = new Map([['preview.js', Buffer.from('// bundled renderer')], ['decoder.wasm', Buffer.from([0, 97, 115, 109])]])
  assert.equal(validatePluginManifest(permitted, { files }).resources.documentPreviews[0].id, 'sample')
  assert.throws(() => validatePluginManifest(permitted, { files: new Map([...files, ['hidden.wasm', Buffer.from([0])]]) }))
})

test('settings views share visibility and reject pre-settings protocol hosts', async () => {
  const views = ['first', 'second'].map(name => ({ id: `com.example.contract.${name}`, title: name, location: 'settings' }))
  const settingsManifest = { ...manifest, apiVersion: '^0.1.4', contributes: { ...manifest.contributes, views } }
  assert.equal(validatePluginManifest(settingsManifest).contributes.views[0].location, 'settings')
  assert.throws(() => validatePluginManifest(settingsManifest, { apiVersion: '0.1.3' }))
  const host = createPluginTestHost({ manifest: settingsManifest })
  await host.activate({ activate() {} })
  const events = []
  host.context.ui.views.onDidChange(state => { events.push(state) })
  await host.context.ui.views.open(views[0].id)
  assert.equal((await host.context.ui.views.getState(views[1].id)).visible, true)
  await host.context.ui.views.close(views[1].id)
  assert.equal((await host.context.ui.views.getState(views[0].id)).visible, false)
  assert.deepEqual(events.map(event => event.visible), [true, true, false, false])
  await host.deactivate()
})


test('embedded views reject updates after context switches and do not navigate to absent surfaces', async () => {
  const locations = ['new-tab', 'document-top', 'document-bottom', 'file-panel', 'editor-toolbar', 'chat-input', 'record-list', 'status-bar-panel']
  const views = locations.map((location, index) => ({ id: `com.example.contract.embedded${index}`, title: location, location }))
  const embedded = { ...manifest, apiVersion: '^0.1.5', contributes: { ...manifest.contributes, views } }
  assert.equal(validatePluginManifest(embedded).contributes.views.length, locations.length)
  assert.throws(() => validatePluginManifest(embedded, { apiVersion: '0.1.4' }))
  const host = createPluginTestHost({ manifest: embedded })
  await host.activate({ activate() {} })
  const id = views[1].id
  const events = []
  host.context.ui.views.onDidChange(state => { events.push(state) })
  await host.context.ui.views.open(id)
  assert.equal((await host.context.ui.views.getState(id)).visible, false)
  await host.setEmbeddedViewContext(id, 'document-a')
  await host.context.ui.views.update(id, { blocks: [{ type: 'text', text: 'A' }], expectedContextId: 'document-a' })
  await host.setEmbeddedViewContext(id, 'document-b')
  assert.equal(host.views[id], undefined)
  await assert.rejects(host.context.ui.views.update(id, { blocks: [], expectedContextId: 'document-a' }), { code: 'StaleRevision' })
  await assert.rejects(host.context.ui.views.update(id, { blocks: [] }), { code: 'StaleRevision' })
  await host.context.ui.views.update(id, { blocks: [], expectedContextId: 'document-b' })
  await host.setEmbeddedViewContext(id, null)
  await assert.rejects(host.context.ui.views.update(id, { blocks: [], expectedContextId: 'document-b' }), { code: 'StaleRevision' })
  assert.deepEqual(events.filter(state => state.visible).map(state => state.contextId), ['document-a', 'document-b'])
  await host.deactivate()
})


test('record updates reject stale revisions and record grants are independent from note grants', async () => {
  const granted = { ...manifest, permissions: { 'records.read': { scope: 'application' }, 'records.write': { scope: 'application' }, 'chat.write': { scope: 'application' } } }
  const host = createPluginTestHost({ manifest: granted })
  await host.activate({ activate() {} })
  const todo = await host.context.records.create({ tagId: 1, type: 'todo', content: 'Review', completed: false })
  const changed = await host.context.records.update({ id: todo.id, expectedRevision: todo.revision, completed: true })
  assert.equal(changed.completed, true)
  await assert.rejects(host.context.records.update({ id: todo.id, expectedRevision: todo.revision, content: 'Stale' }), { code: 'StaleRevision' })
  assert.equal((await host.context.records.list()).items.length, 1)
  await host.context.chat.setDraft({ text: 'Keep this draft' })
  await assert.rejects(host.context.chat.setDraft({ text: 'Replace', mode: 'replace' }), { code: 'Conflict' })
  await host.context.chat.setDraft({ text: 'Replace', mode: 'replace', overwrite: true })
  const denied = createPluginTestHost({ manifest })
  await denied.activate({ activate() {} })
  await assert.rejects(denied.context.records.list(), { code: 'PermissionDenied' })
  await denied.deactivate(); await host.deactivate()
})

test('property patches preserve Markdown bytes and reject stale writes and duplicate YAML keys', async () => {
  const body = '# Title\r\n\r\n  Keep this body.\r\n'
  const host = createPluginTestHost({ manifest, notes: [{ path: 'Notes/properties.md', content: '---\r\nstatus: draft\r\ntags: [work]\r\n---\r\n' + body, revision: 1 }, { path: 'Notes/bad.md', content: '---\na: 1\na: 2\n---\n' }] })
  await host.activate({ activate() {} })
  const before = await readNoteProperties(host.context, 'Notes/properties.md')
  assert.equal(before.properties.status, 'draft')
  await updateNoteProperties(host.context, { path: before.path, expectedRevision: before.revision, set: { status: 'done' } })
  assert.ok((await host.context.notes.read({ path: before.path })).content.endsWith(body))
  await assert.rejects(updateNoteProperties(host.context, { path: before.path, expectedRevision: before.revision, set: { status: 'stale' } }), { code: 'StaleRevision' })
  await assert.rejects(readNoteProperties(host.context, 'Notes/bad.md'), { code: 'InvalidPath' })
  await host.deactivate()
})

test('registerView cancels old rendering when the embedded context changes', async () => {
  const id = 'com.example.contract.panel'
  const host = createPluginTestHost({ manifest: { ...manifest, contributes: { ...manifest.contributes, views: [{ id, title: 'Panel', location: 'new-tab' }] } } })
  await host.activate({ activate() {} })
  let finishOld
  let oldSignal
  const view = registerView(host.context, { id, render: async ({ state, signal }) => {
    if (state.contextId === 'old') { oldSignal = signal; await new Promise(resolve => { finishOld = resolve }) }
    return { blocks: [{ type: 'text', text: state.contextId }] }
  } })
  const old = host.setEmbeddedViewContext(id, 'old')
  await new Promise(resolve => setImmediate(resolve))
  await host.setEmbeddedViewContext(id, 'new')
  assert.equal(oldSignal.aborted, true)
  finishOld(); await old
  assert.equal(host.views[id].blocks[0].text, 'new')
  view.dispose(); await host.deactivate()
})

test('task queues keep cancellation from exceeding concurrency and validate AI JSON locally', async () => {
  const host = createPluginTestHost({ manifest: { ...manifest, permissions: { 'ai.generate': { scope: 'application' } } }, aiGenerate: async () => '{"answer":42}' })
  await host.activate({ activate() {} })
  const queue = createTaskQueue(host.context, 1)
  let finishFirst
  const first = queue.enqueue('First', async () => new Promise(resolve => { finishFirst = resolve }))
  const second = queue.enqueue('Second', async () => 2)
  await new Promise(resolve => setImmediate(resolve))
  const cancelled = assert.rejects(first.result, { code: 'Cancelled' })
  first.cancel()
  assert.equal(queue.snapshot()[1].status, 'queued')
  finishFirst(1); await cancelled
  assert.equal(await second.result, 2)
  const object = await generateJson(host.context, { requestId: 'json', prompt: 'Answer' }, value => {
    assert.equal(value.answer, 42)
    return value
  })
  assert.equal(object.answer, 42)
  queue.dispose(); await host.deactivate()
})
