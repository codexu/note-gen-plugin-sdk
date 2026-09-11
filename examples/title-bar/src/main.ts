import type { PluginActivate } from '@notegen/plugin-api'

export const activate: PluginActivate = async context => {
  const prefix = 'org.example.title-bar'
  context.commands.handle(`${prefix}.hello`, async () => {
    await context.ui.showNotice('Hello from the title bar')
  })
  await context.ui.views.update(`${prefix}.left`, { blocks: [{
    type: 'toolbar', id: 'quick-actions', label: 'Quick actions', actions: [{
      id: 'hello', label: 'Say hello', command: `${prefix}.hello`, icon: 'sparkles', iconOnly: true,
    }],
  }] })
  await context.ui.views.update(`${prefix}.center`, { blocks: [
    { type: 'text', text: 'My workspace', tone: 'muted' },
    { type: 'badge', text: 'Ready' },
  ] })
  await context.ui.views.update(`${prefix}.right`, { blocks: [{
    type: 'toolbar', id: 'tools', label: 'Plugin tools', actions: [{
      id: 'greet', label: 'Hello', command: `${prefix}.hello`, icon: 'hand',
    }],
  }] })
}
