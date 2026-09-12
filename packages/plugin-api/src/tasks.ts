import { PluginError } from './index.js'
import type { PluginAbortListener, PluginAbortSignal, PluginContext, PluginDisposable } from './index.js'

export interface PluginTaskState { id: string; label: string; status: 'queued' | 'running' | 'completed' | 'cancelled' | 'failed'; progress: number; message?: string }
export interface PluginTaskHandle<T> { id: string; result: Promise<T>; cancel: () => void }
export interface PluginTaskQueue extends PluginDisposable {
  enqueue<T>(label: string, run: (context: { signal: PluginAbortSignal; report: (progress: number, message?: string) => void }) => Promise<T>): PluginTaskHandle<T>
  snapshot(): readonly PluginTaskState[]
  onDidChange(listener: (states: readonly PluginTaskState[]) => void): PluginDisposable
}

/** In-process task queue. Work stops with the plugin; this does not schedule work while NoteGen is closed. */
export function createTaskQueue(context: PluginContext, concurrency = 1): PluginTaskQueue {
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new PluginError('InvalidPath', 'Task concurrency must be between 1 and 4')
  const states = new Map<string, PluginTaskState>()
  const pending: { id: string; start: () => void; cancel: () => void }[] = []
  const cancelRunning = new Map<string, () => void>()
  const listeners = new Set<(states: readonly PluginTaskState[]) => void>()
  let running = 0, sequence = 0, disposed = false
  const snapshot = () => [...states.values()].map(state => ({ ...state }))
  const notify = () => { for (const listener of listeners) { try { listener(snapshot()) } catch { /* Isolated observer. */ } } }
  const pump = () => {
    while (!disposed && running < concurrency && pending.length) pending.shift()!.start()
  }
  const dispose = () => {
    if (disposed) return
    disposed = true
    for (const item of pending.splice(0)) item.cancel()
    for (const cancel of cancelRunning.values()) cancel()
    listeners.clear()
    context.signal.removeEventListener('abort', dispose)
  }
  context.signal.addEventListener('abort', dispose)
  if (context.signal.aborted) dispose()
  return {
    snapshot,
    dispose,
    onDidChange(listener) { if (!disposed) listeners.add(listener); return { dispose: () => { listeners.delete(listener) } } },
    enqueue<T>(label: string, run: (value: { signal: PluginAbortSignal; report: (progress: number, message?: string) => void }) => Promise<T>) {
      if (disposed) throw new PluginError('Cancelled', 'Task queue is disposed')
      if (!label || label.length > 160) throw new PluginError('InvalidPath', 'Invalid task label')
      if (pending.length + running >= 100) throw new PluginError('QuotaExceeded', 'Task queue is full')
      for (const [id, state] of states) {
        if (states.size < 100) break
        if (!['queued', 'running'].includes(state.status)) states.delete(id)
      }
      const id = `task-${++sequence}`
      const state: PluginTaskState = { id, label, status: 'queued', progress: 0 }
      states.set(id, state)
      let resolve!: (value: T) => void, reject!: (error: unknown) => void, aborted = false
      const result = new Promise<T>((yes, no) => { resolve = yes; reject = no })
      const abortListeners = new Set<PluginAbortListener>()
      const signal: PluginAbortSignal = {
        get aborted() { return aborted },
        get reason() { return aborted ? new PluginError('Cancelled', 'Operation cancelled') : undefined },
        throwIfAborted() { if (aborted) throw new PluginError('Cancelled', 'Operation cancelled') },
        addEventListener: (_type, listener) => { abortListeners.add(listener) },
        removeEventListener: (_type, listener) => { abortListeners.delete(listener) },
      }
      const cancel = () => {
        if (!['queued', 'running'].includes(state.status)) return
        aborted = true
        state.status = 'cancelled'
        for (const listener of abortListeners) { try { listener() } catch { /* Isolated cancellation. */ } }
        abortListeners.clear()
        const index = pending.findIndex(item => item.id === id)
        if (index >= 0) pending.splice(index, 1)
        reject(new PluginError('Cancelled', 'Task cancelled'))
        notify()
      }
      pending.push({ id, cancel, start: () => {
        if (aborted) return
        running++
        state.status = 'running'
        cancelRunning.set(id, cancel)
        notify()
        void Promise.resolve().then(() => {
          if (aborted || disposed) throw new PluginError('Cancelled', 'Task cancelled')
          return run({ signal, report: (progress, message) => {
            if (aborted || disposed) return
            if (!Number.isFinite(progress) || progress < 0 || progress > 100 || (message !== undefined && message.length > 500)) throw new PluginError('InvalidPath', 'Invalid task progress')
            state.progress = progress
            if (message !== undefined) state.message = message
            notify()
          } })
        }).then(value => {
          if (!aborted) { state.status = 'completed'; state.progress = 100; resolve(value) }
        }, error => { if (!aborted) { state.status = 'failed'; reject(error) } }).finally(() => {
          running--; cancelRunning.delete(id); abortListeners.clear(); notify(); pump()
        })
      } })
      notify(); pump()
      return { id, result, cancel }
    },
  }
}
