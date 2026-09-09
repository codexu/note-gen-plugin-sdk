import type { PluginActivate, PluginCommandArgument, PluginTableCell } from '@notegen/plugin-api'

const prefix = 'com.example.task-dashboard'
interface Task { path: string; revision: number; line: number; original: string; title: string }

export const activate: PluginActivate = async ctx => {
  let tasks = new Map<string, Task>()
  let nextCursor: string | undefined
  let currentCursor: string | undefined
  let generation = 0
  let running = false

  async function load(cursor?: string) {
    const page = await ctx.notes.list({ recursive: true, limit: 25, cursor })
    const nextTasks = new Map<string, Task>()
    const rows: PluginTableCell[][] = []
    const revision = ++generation
    let limited = false
    let rowCharacters = 0
    for (const entry of page.entries) {
      ctx.signal.throwIfAborted()
      // This example keeps each scan bounded; it is not a full-vault task index.
      if (entry.size > 256 * 1024) { limited = true; continue }
      const note = await ctx.notes.read({ path: entry.path })
      let fence: string | undefined
      let fenceLength = 0
      const lines = note.content.split('\n')
      for (let line = 0; line < lines.length; line++) {
        const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(lines[line])
        if (marker) {
          if (!fence) { fence = marker[1][0]; fenceLength = marker[1].length }
          else if (marker[1][0] === fence && marker[1].length >= fenceLength) fence = undefined
          continue
        }
        if (fence) continue
        const match = /^\s*[-*+] \[ \] (.+)/.exec(lines[line])
        if (!match) continue
        if (rows.length >= 100) { limited = true; break }
        const existing = [...tasks.entries()].find(([, task]) => task.path === note.path && task.line === line && task.original === lines[line])
        const id = existing?.[0] ?? `${revision}:${nextTasks.size}`
        const row: PluginTableCell[] = [match[1].slice(0, 2000), note.path, { text: '完成', command: `${prefix}.complete`, argument: id }]
        rowCharacters += JSON.stringify(row).length
        if (rowCharacters > 24_000) { limited = true; break }
        nextTasks.set(id, { path: note.path, revision: note.revision, line, original: lines[line], title: match[1] })
        rows.push(row)
      }
    }
    ctx.signal.throwIfAborted()
    await ctx.ui.views.update(`${prefix}.view`, { blocks: [
      { type: 'callout', title: '任务面板示例', text: '每页扫描 25 篇笔记。请先关闭任务源笔记，再点击完成。' },
      ...(limited ? [{ type: 'text' as const, text: '部分内容超过本示例的大小或任务数量限制，未展示。', tone: 'warning' as const }] : []),
      { type: 'table', id: 'tasks', rowIds: [...nextTasks.keys()], columns: ['任务', '文件', '操作'], rows },
      { type: 'actions', actions: [
        { id: 'refresh', label: '从头刷新', command: `${prefix}.refresh` },
        { id: 'next', label: '下一页笔记', command: `${prefix}.next`, disabled: !page.nextCursor },
      ] },
    ] })
    tasks = nextTasks
    nextCursor = page.nextCursor
    currentCursor = cursor
  }

  function register(name: string, operation: (argument?: PluginCommandArgument) => Promise<void>) {
    ctx.commands.handle(`${prefix}.${name}`, async argument => {
      if (running) return
      running = true
      try { await operation(argument) }
      catch (error) {
        if (!ctx.signal.aborted) await ctx.ui.showNotice(error instanceof Error ? error.message : String(error))
      } finally { running = false }
    })
  }
  register('open', async () => { await load(); await ctx.ui.views.open(`${prefix}.view`) })
  register('refresh', async () => load())
  register('next', async () => { if (nextCursor) await load(nextCursor) })
  register('complete', async argument => {
    const task = typeof argument === 'string' ? tasks.get(argument) : undefined
    if (!task) { await ctx.ui.showNotice('任务已过期，请刷新。'); return }
    const note = await ctx.notes.read({ path: task.path })
    const lines = note.content.split('\n')
    if (note.revision !== task.revision || lines[task.line] !== task.original) {
      await ctx.ui.showNotice('笔记已变化，本次未修改，请刷新。')
      return
    }
    lines[task.line] = task.original.replace(/^(\s*[-*+] )\[ \]/, '$1[x]')
    await ctx.notes.write({ path: task.path, expectedRevision: task.revision, content: lines.join('\n') })
    tasks.delete(String(argument))
    await load(currentCursor)
  })
}
