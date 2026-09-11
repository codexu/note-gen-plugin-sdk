import type { PluginActivate } from '@notegen/plugin-api'

export const activate: PluginActivate = async context => {
  await context.fileIcons.setRules([
    { kind: 'file', extension: 'md', icon: { name: 'book-open' } },
    { kind: 'folder', icon: { emoji: '📁' } },
  ])
}
