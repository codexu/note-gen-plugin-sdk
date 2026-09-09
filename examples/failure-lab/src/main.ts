import type { PluginActivate } from '@notegen/plugin-api'
const prefix = 'com.example.failure-lab'
export const activate: PluginActivate = ctx => {
  ctx.commands.handle(`${prefix}.open`, async () => {
    await ctx.ui.views.update(`${prefix}.view`, { blocks: [
      { type: 'callout', title: '仅在隔离测试应用中使用', text: '普通异常应显示错误；死循环应立即停止插件；可从插件管理页重新启用。' },
      { type: 'actions', actions: [
        { id: 'memory', label: '触发内存超限', command: `${prefix}.memory`, variant: 'destructive' },
        { id: 'logs', label: '写入诊断日志', command: `${prefix}.logs` },
        { id: 'throw', label: '触发普通异常', command: `${prefix}.throw` },
        { id: 'loop', label: '触发死循环超时', command: `${prefix}.loop`, variant: 'destructive' },
        { id: 'quota', label: '触发 RPC 超额', command: `${prefix}.quota` },
      ] },
    ] })
    await ctx.ui.views.open(`${prefix}.view`)
  })
  ctx.commands.handle(`${prefix}.throw`, () => { throw new Error('预期测试异常：宿主应该继续响应') })
  ctx.commands.handle(`${prefix}.loop`, () => { while (!ctx.signal.aborted) { /* Intentional guest CPU exhaustion, bounded by the host watchdog. */ } })
  ctx.commands.handle(`${prefix}.memory`, () => { const values = new Array(10_000_000).fill('memory-limit'); return values.length })
  ctx.commands.handle(`${prefix}.logs`, () => { ctx.log.info('diagnostic-info'); ctx.log.warning('diagnostic-warning'); ctx.log.error(new Error('diagnostic-error').stack ?? 'diagnostic-error') })
  ctx.commands.handle(`${prefix}.quota`, async () => { await Promise.all(Array.from({ length: 65 }, () => ctx.workspace.getCurrent())) })
}
