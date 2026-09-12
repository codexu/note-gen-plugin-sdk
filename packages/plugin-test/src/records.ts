import { createHash } from 'node:crypto'
import { PluginError, type PluginRecord, type PluginRecordsApi, type PluginPermissionName } from '@notegen/plugin-api'

export function createMemoryRecords(options: {
  records?: readonly PluginRecord[]
  tags?: readonly { id: number; name: string }[]
  guard: (permission: PluginPermissionName) => void
  now: () => number
}): PluginRecordsApi {
  const rows = new Map((options.records ?? []).map(record => [record.id, { ...record }]))
  const tags = (options.tags ?? [{ id: 1, name: 'Inbox' }]).map(tag => ({ ...tag }))
  const listeners = new Set<() => void | Promise<void>>()
  const id = (value: number) => { if (!Number.isSafeInteger(value) || value <= 0) throw new PluginError('InvalidPath', 'Invalid record ID') }
  const text = (value: unknown) => { if (typeof value !== 'string' || value.length > 20_000) throw new PluginError('InvalidPath', 'Invalid record text'); return value }
  const tag = (value: number) => { id(value); if (!tags.some(item => item.id === value)) throw new PluginError('NotFound', 'Record tag not found') }
  const get = (value: number) => { id(value); const row = rows.get(value); if (!row) throw new PluginError('NotFound', 'Record not found'); return row }
  const save = (row: PluginRecord) => {
    row.revision = createHash('sha256').update(JSON.stringify({ ...row, revision: undefined })).digest('hex')
    rows.set(row.id, row)
    for (const listener of listeners) void Promise.resolve().then(() => { options.guard('records.read'); return listener() }).catch(() => undefined)
    return { ...row }
  }
  return {
    async list(input = {}) {
      options.guard('records.read')
      const offset = input.offset ?? 0, limit = input.limit ?? 20
      if (!Number.isInteger(offset) || offset < 0 || offset > 100_000 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new PluginError('InvalidPath', 'Invalid pagination')
      if (input.tagId !== undefined) id(input.tagId)
      const result = [...rows.values()].filter(row => input.tagId === undefined || row.tagId === input.tagId).sort((a, b) => b.createdAt - a.createdAt || b.id - a.id).slice(offset, offset + limit + 1)
      return { items: result.slice(0, limit).map(row => ({ ...row, content: row.content.slice(0, 1000), description: row.description.slice(0, 500), ...(row.content.length > 1000 || row.description.length > 500 ? { truncated: true } : {}) })), hasMore: result.length > limit }
    },
    async read(value) { options.guard('records.read'); return { ...get(value) } },
    async tags() { options.guard('records.read'); return tags.map(item => ({ ...item })) },
    async create(input) {
      options.guard('records.write'); tag(input.tagId)
      if (!['text', 'todo'].includes(input.type) || (input.completed !== undefined && typeof input.completed !== 'boolean')) throw new PluginError('InvalidPath', 'Invalid record type or completion')
      return save({ id: Math.max(0, ...rows.keys()) + 1, tagId: input.tagId, type: input.type, content: text(input.content), description: text(input.description ?? ''), createdAt: options.now(), revision: '', ...(input.type === 'todo' ? { completed: input.completed ?? false } : {}) })
    },
    async update(input) {
      options.guard('records.read'); options.guard('records.write')
      const previous = get(input.id)
      if (!['text', 'todo'].includes(previous.type)) throw new PluginError('ReadOnly', 'Only text and todo records support updates')
      if (previous.revision !== input.expectedRevision) throw new PluginError('StaleRevision', 'Record changed')
      if (input.tagId !== undefined) tag(input.tagId)
      if (input.completed !== undefined && (previous.type !== 'todo' || typeof input.completed !== 'boolean')) throw new PluginError('InvalidPath', 'Invalid completion state')
      return save({ ...previous, tagId: input.tagId ?? previous.tagId, content: input.content === undefined ? previous.content : text(input.content), description: input.description === undefined ? previous.description : text(input.description), ...(input.completed === undefined ? {} : { completed: input.completed }) })
    },
    onDidChange(listener) { options.guard('records.read'); listeners.add(listener); return { dispose: () => { listeners.delete(listener) } } },
  }
}
