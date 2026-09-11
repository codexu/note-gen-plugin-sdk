import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  PLUGIN_API_VERSION,
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
  assert.equal(PLUGIN_API_VERSION, '0.1.3')
  assert.equal(validatePluginManifest(manifest).id, manifest.id)
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
