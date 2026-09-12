import { isMap, parseDocument } from 'yaml'
import { PluginError } from './index.js'
import type { PluginContext, PluginJsonValue, NoteSnapshot } from './index.js'

export interface PluginNoteProperties { path: string; revision: number; properties: Readonly<Record<string, PluginJsonValue>> }

function json(value: unknown, depth = 0): PluginJsonValue {
  if (depth > 12) throw new PluginError('QuotaExceeded', 'Note properties are too deeply nested')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(item => json(item, depth + 1))
  if (value && typeof value === 'object' && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)) {
    const result: Record<string, PluginJsonValue> = Object.create(null)
    for (const [key, item] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new PluginError('InvalidPath', 'Unsafe note property key')
      result[key] = json(item, depth + 1)
    }
    return result
  }
  throw new PluginError('InvalidPath', 'Note properties must contain JSON-compatible values')
}
function parse(content: string) {
  const bom = content.startsWith('\uFEFF') ? '\uFEFF' : ''
  const source = content.slice(bom.length)
  const opening = /^---\r?\n/.exec(source)
  let yaml = '', body = source
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  if (opening) {
    const rest = source.slice(opening[0].length)
    const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest)
    if (!closing) throw new PluginError('InvalidPath', 'Frontmatter closing delimiter is missing')
    yaml = rest.slice(0, closing.index)
    body = rest.slice(closing.index + closing[0].length)
  }
  if (yaml.length > 64 * 1024) throw new PluginError('QuotaExceeded', 'Frontmatter exceeds 64 KiB')
  const document = parseDocument(yaml, { schema: 'core', uniqueKeys: true })
  if (document.errors.length || (document.contents !== null && !isMap(document.contents))) throw new PluginError('InvalidPath', 'Frontmatter must be a valid YAML mapping')
  let value: unknown
  try { value = document.toJS({ maxAliasCount: 0 }) ?? {} } catch { throw new PluginError('InvalidPath', 'Frontmatter aliases are not supported') }
  const properties = json(value) as Record<string, PluginJsonValue>
  return { document, properties, body, bom, newline }
}
function properties(snapshot: NoteSnapshot): PluginNoteProperties {
  return { path: snapshot.path, revision: snapshot.revision, properties: parse(snapshot.content).properties }
}

export async function readNoteProperties(context: PluginContext, path: string): Promise<PluginNoteProperties> {
  return properties(await context.notes.read({ path }))
}

/** Patches top-level properties; delete names explicitly. Preserves the exact Markdown body. */
export async function updateNoteProperties(context: PluginContext, options: {
  path: string; expectedRevision: number; set?: Readonly<Record<string, PluginJsonValue>>; delete?: readonly string[]
}): Promise<PluginNoteProperties> {
  const snapshot = await context.notes.read({ path: options.path })
  if (snapshot.revision !== options.expectedRevision) throw new PluginError('StaleRevision', 'Note changed')
  const parsed = parse(snapshot.content)
  const patch = json(options.set ?? {}) as Record<string, PluginJsonValue>
  for (const key of options.delete ?? []) {
    if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new PluginError('InvalidPath', 'Unsafe note property key')
    parsed.document.delete(key)
  }
  for (const [key, value] of Object.entries(patch)) parsed.document.set(key, value)
  const yaml = parsed.document.toString().replace(/\r?\n/g, parsed.newline)
  if (yaml.length > 64 * 1024) throw new PluginError('QuotaExceeded', 'Frontmatter exceeds 64 KiB')
  const content = `${parsed.bom}---${parsed.newline}${yaml}---${parsed.newline}${parsed.body}`
  const result = await context.notes.write({ path: options.path, content, expectedRevision: snapshot.revision })
  return { path: result.path, revision: result.revision, properties: parse(content).properties }
}

/** Scans one bounded page of saved notes; the caller follows nextCursor even if no matches occur. */
export async function queryNoteProperties(context: PluginContext, options: {
  folder?: string; cursor?: string; pageSize?: number; equals?: Readonly<Record<string, string | number | boolean | null>>; tag?: string
} = {}): Promise<{ items: readonly PluginNoteProperties[]; nextCursor?: string; truncated: boolean }> {
  const size = options.pageSize ?? 20
  if (!Number.isInteger(size) || size < 1 || size > 50) throw new PluginError('InvalidPath', 'Page size must be between 1 and 50')
  const page = await context.notes.list({ ...(options.folder === undefined ? {} : { folder: options.folder }), ...(options.cursor === undefined ? {} : { cursor: options.cursor }), recursive: true, limit: size })
  const items: PluginNoteProperties[] = []
  for (const entry of page.entries) {
    if (context.signal.aborted) throw new PluginError('Cancelled', 'Plugin stopped')
    const note = await readNoteProperties(context, entry.path)
    if (Object.entries(options.equals ?? {}).some(([key, value]) => note.properties[key] !== value)) continue
    if (options.tag) {
      const tags = note.properties.tags
      if (typeof tags === 'string' ? tags !== options.tag : !Array.isArray(tags) || !tags.includes(options.tag)) continue
    }
    items.push(note)
  }
  return { items, ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}), truncated: page.truncated }
}
