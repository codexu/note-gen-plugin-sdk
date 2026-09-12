import { createDisposables, registerView, type PluginActivate, type PluginDisposable } from '@notegen/plugin-api'

let subscriptions: PluginDisposable | undefined
export const activate: PluginActivate = async context => {
  const disposables = createDisposables()
  subscriptions = disposables
  for (let index = 0; index < 8; index++) {
    disposables.add(registerView(context, {
      id: `org.example.embedded-views.${index}`,
      render: ({ state }) => ({ blocks: [
        { type: 'text', text: `Hello from ${state.location}` },
        { type: 'badge', text: 'Ready' },
      ] }),
    }))
  }
}
export function deactivate() { subscriptions?.dispose(); subscriptions = undefined }
