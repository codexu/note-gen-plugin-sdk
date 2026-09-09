import type { PluginActivate, PluginCommandArgument, PluginJsonValue, PluginUiDocument } from '@notegen/plugin-api'

const prefix = 'com.example.interaction-lab'
const path = 'PluginLab/fixture.md'
function record(value: PluginCommandArgument | PluginJsonValue | undefined): Record<string, PluginJsonValue> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, PluginJsonValue> : {}
}

export const activate: PluginActivate = async ctx => {
  let title = '测试便笺'
  let message = '就绪。文件操作仅针对 PluginLab/fixture.md；请只在隔离工作区运行。'
  let writes = 0
  const saved = record(await ctx.storage.workspace.get('form'))
  if (typeof saved.title === 'string') title = saved.title

  const document = (): PluginUiDocument => ({ blocks: [
    { type: 'heading', text: '插件交互实验室' },
    { type: 'text', text: message },
    { type: 'form', id: 'memo', submitLabel: '保存表单', command: `${prefix}.save`, fields: [
      { type: 'text', id: 'title', label: '便笺标题', value: title, required: true, maxLength: 80 },
      { type: 'checkbox', id: 'details', label: '显示备注', value: false },
      { type: 'textarea', id: 'body', label: '备注内容', maxLength: 500, visibleWhen: { field: 'details', equals: true } },
      { type: 'select', id: 'priority', label: '优先级', value: 'normal', options: [{ label: '普通', value: 'normal' }, { label: '重要', value: 'high' }] },
    ] },
    { type: 'table', id: 'results', rowIds: ['title', 'writes'], columns: ['状态', '值'], rows: [['保存的标题', title], ['本次追加次数', String(writes)]] },
    { type: 'actions', actions: [
      { id: 'dialog', label: '打开弹窗', command: `${prefix}.dialog` },
      { id: 'create', label: '创建测试笔记', command: `${prefix}.create` },
      { id: 'write', label: '追加测试笔记', command: `${prefix}.write` },
      { id: 'stale', label: '验证冲突保护', command: `${prefix}.stale` },
      { id: 'trash', label: '测试笔记移入废纸篓', command: `${prefix}.trash`, variant: 'destructive' },
    ] },
  ] })
  async function render() { await ctx.ui.views.update(`${prefix}.view`, document()) }
  async function report(text: string) {
    message = text
    await render()
    await ctx.ui.statusBar.update(`${prefix}.status`, { visible: true, text: '实验室运行中', tooltip: text })
  }
  ctx.commands.handle(`${prefix}.open`, async () => { await render(); await ctx.ui.views.open(`${prefix}.view`) })
  ctx.commands.handle(`${prefix}.save`, async (argument): Promise<PluginJsonValue> => {
    const values = record(record(argument).values)
    const next = typeof values.title === 'string' ? values.title.trim() : ''
    if (next.length < 2) return { fieldErrors: { title: '标题至少需要两个字符' } }
    await ctx.storage.workspace.set('form', values)
    title = next
    await report(`已保存：${title}；备注字段${'body' in values ? '已提交' : '未提交（隐藏）'}`)
    return { message: '保存成功，重启插件后仍可读取标题。' }
  })
  ctx.commands.handle(`${prefix}.dialog`, async () => {
    await ctx.ui.openDialog({ title: '实验室确认弹窗', description: '测试弹窗内表单及程序关闭。', content: { blocks: [
      { type: 'form', id: 'confirmation', command: `${prefix}.confirm`, submitLabel: '确认并关闭', fields: [
        { type: 'text', id: 'answer', label: '确认内容', required: true, maxLength: 100 },
      ] },
    ] } })
  })
  ctx.commands.handle(`${prefix}.confirm`, async argument => {
    const data = record(argument)
    await report(`弹窗提交：${String(record(data.values).answer ?? '')}`)
    if (typeof data.dialogId === 'string') await ctx.ui.closeDialog(data.dialogId)
  })
  ctx.commands.handle(`${prefix}.create`, async () => {
    const workspace = await ctx.workspace.getCurrent()
    const result = await ctx.notes.openOrCreate({ workspaceId: workspace.id, path, initialContent: '# 插件测试\n\n- [ ] 测试任务\n', conflict: 'open-existing', open: false, idempotencyKey: 'interaction-lab-fixture' })
    await report(`测试笔记：${result.status}（已有内容不会被覆盖）`)
  })
  ctx.commands.handle(`${prefix}.write`, async () => {
    const note = await ctx.notes.read({ path })
    await ctx.notes.write({ path, content: note.content + '\n实验室追加\n', expectedRevision: note.revision })
    writes += 1
    await report('按最新 revision 追加成功')
  })
  ctx.commands.handle(`${prefix}.stale`, async () => {
    const before = await ctx.notes.read({ path })
    const changed = await ctx.notes.write({ path, content: before.content + '\n冲突保护标记\n', expectedRevision: before.revision })
    try {
      await ctx.notes.write({ path, content: '错误覆盖', expectedRevision: before.revision })
      throw new Error('保护失败：过期写入被接受')
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'StaleRevision')) throw error
      const current = await ctx.notes.read({ path })
      if (current.revision !== changed.revision) throw new Error('拒绝后文件内容发生变化')
      await report('通过：过期 revision 被拒绝，当前内容保持不变')
    }
  })
  ctx.commands.handle(`${prefix}.trash`, async () => {
    const note = await ctx.notes.read({ path })
    await ctx.notes.delete({ path, expectedRevision: note.revision })
    await report('测试笔记已移入系统废纸篓')
  })
}
