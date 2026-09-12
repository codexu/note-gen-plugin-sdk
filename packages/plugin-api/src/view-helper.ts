import { PluginError, isPluginError } from './index.js'
import type { PluginAbortListener, PluginAbortSignal, PluginContext, PluginDisposable, PluginUiDocument, PluginViewState } from './index.js'

export interface PluginViewRenderer {
  id: string
  render: (context: { state: PluginViewState; signal: PluginAbortSignal }) => PluginUiDocument | Promise<PluginUiDocument>
  onError?: (error: unknown) => void
}

/** Cancels obsolete renders and automatically echoes the current embedded context token. */
export function registerView(context: PluginContext, options: PluginViewRenderer): PluginDisposable & { refresh: () => Promise<void> } {
  let disposed = false
  let generation = 0
  let cancel: () => void = () => {}
  const report = (error: unknown) => {
    if (isPluginError(error) && ['Cancelled', 'StaleRevision', 'WorkspaceChanged'].includes(error.code)) return
    try {
      if (options.onError) options.onError(error)
      else context.log.error(error instanceof Error ? error.message : String(error))
    } catch { /* Error reporting must not reject an event-driven refresh. */ }
  }
  async function render(state: PluginViewState) {
    if (disposed || state.id !== options.id) return
    cancel()
    const current = ++generation
    if (!state.visible) return
    let aborted = false
    const listeners = new Set<PluginAbortListener>()
    const signal: PluginAbortSignal = {
      get aborted() { return aborted },
        get reason() { return aborted ? new PluginError('Cancelled', 'Operation cancelled') : undefined },
        throwIfAborted() { if (aborted) throw new PluginError('Cancelled', 'Operation cancelled') },
      addEventListener: (_type, listener) => { listeners.add(listener) },
      removeEventListener: (_type, listener) => { listeners.delete(listener) },
    }
    cancel = () => {
      if (aborted) return
      aborted = true
      for (const listener of listeners) { try { listener() } catch { /* Other listeners still need cancellation. */ } }
      listeners.clear()
    }
    try {
      const document = await options.render({ state, signal })
      if (disposed || aborted || current !== generation) return
      await context.ui.views.update(options.id, {
        ...document,
        ...(state.contextId ? { expectedContextId: state.contextId } : {}),
      })
    } catch (error) { if (!disposed && !aborted && current === generation) report(error) }
  }
  const subscription = context.ui.views.onDidChange(render)
  const dispose = () => {
    if (disposed) return
    disposed = true
    generation++
    cancel()
    subscription.dispose()
    context.signal.removeEventListener('abort', dispose)
  }
  context.signal.addEventListener('abort', dispose)
  const refresh = async () => {
    if (disposed) return
    const requestedGeneration = generation
    try {
      const state = await context.ui.views.getState(options.id)
      if (!disposed && generation === requestedGeneration) await render(state)
    } catch (error) { if (!disposed) report(error) }
  }
  if (context.signal.aborted) dispose()
  else void refresh()
  return { dispose, refresh }
}

/** Releases subscriptions in reverse order, including subscriptions added after disposal. */
export function createDisposables(): PluginDisposable & { add: <T extends PluginDisposable>(item: T) => T } {
  const items: PluginDisposable[] = []
  let disposed = false
  return {
    add(item) { if (disposed) item.dispose(); else items.push(item); return item },
    dispose() {
      if (disposed) return
      disposed = true
      let firstError: unknown
      for (const item of items.splice(0).reverse()) { try { item.dispose() } catch (error) { firstError ??= error } }
      if (firstError !== undefined) throw firstError
    },
  }
}
