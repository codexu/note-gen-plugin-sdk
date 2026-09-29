import type { PluginEmbeddedViewInit } from './index.js'

/** Structural port type keeps the core SDK usable without DOM TypeScript libraries. */
export interface PluginEmbeddedFramePort {
  postMessage(message: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
  close(): void
}

export function acceptEmbeddedFrameInit(
  event: { source: unknown; data: unknown; ports: readonly unknown[] },
  expectedToken: string,
  parent: unknown,
): { init: PluginEmbeddedViewInit; port: PluginEmbeddedFramePort } | null {
  const data = event.data
  if (!expectedToken || event.source !== parent || event.ports.length !== 1
    || !data || typeof data !== 'object' || Array.isArray(data)) return null
  const init = data as Partial<PluginEmbeddedViewInit>
  if (init.type !== 'notegen:embedded-view-init' || init.protocol !== 1 || init.token !== expectedToken
    || typeof init.locale !== 'string' || !Array.isArray(init.capabilities)) return null
  const port = event.ports[0]
  if (!port || typeof port !== 'object' || !('onmessage' in port)
    || typeof (port as { postMessage?: unknown }).postMessage !== 'function'
    || typeof (port as { close?: unknown }).close !== 'function') return null
  return { init: init as PluginEmbeddedViewInit, port: port as unknown as PluginEmbeddedFramePort }
}

export interface PluginEmbeddedFrameSession {
  request(method: string, values?: Readonly<Record<string, unknown>>, signal?: { aborted: boolean; addEventListener(type: 'abort', listener: () => void): void; removeEventListener(type: 'abort', listener: () => void): void }): Promise<unknown>
  ready(): void
  dispose(): void
}

/** Own request IDs, replies and cancellation; pass non-RPC events to the frame UI. */
export function createEmbeddedFrameSession(port: PluginEmbeddedFramePort, options: {
  onTheme?: (value: unknown, background?: unknown, foreground?: unknown) => void
  onSettings?: (value: unknown) => void
  onEvent?: (event: Readonly<Record<string, unknown>>) => void
} = {}): PluginEmbeddedFrameSession {
  let nextId = 0
  let closed = false
  const pending = new Map<number, {
    resolve(value: unknown): void
    reject(error: Error): void
    cleanup(): void
  }>()
  port.onmessage = ({ data }) => {
    if (closed || !data || typeof data !== 'object' || Array.isArray(data)) return
    const message = data as Record<string, unknown>
    if (typeof message.id === 'number') {
      const reply = pending.get(message.id)
      if (!reply) return
      pending.delete(message.id)
      reply.cleanup()
      if (message.error !== undefined) reply.reject(new Error(String(message.error)))
      else reply.resolve(message.result)
      return
    }
    if (message.type === 'host.theme') options.onTheme?.(message.theme, message.background, message.foreground)
    else if (message.type === 'host.settings') options.onSettings?.(message.settings)
    else if (typeof message.type === 'string') options.onEvent?.(message)
  }
  return {
    request(method, values = {}, signal) {
      if (closed) return Promise.reject(new Error('Frame closed'))
      if (signal?.aborted) return Promise.reject(new Error('Frame request cancelled'))
      return new Promise((resolve, reject) => {
        const id = ++nextId
        const onAbort = () => {
          const reply = pending.get(id)
          if (!reply) return
          pending.delete(id)
          reply.cleanup()
          reject(new Error('Frame request cancelled'))
        }
        const cleanup = () => signal?.removeEventListener('abort', onAbort)
        pending.set(id, { resolve, reject, cleanup })
        signal?.addEventListener('abort', onAbort)
        try { port.postMessage({ ...values, id, method }) }
        catch (error) {
          pending.delete(id)
          cleanup()
          reject(error instanceof Error ? error : new Error(String(error)))
        }
      })
    },
    ready() { if (!closed) port.postMessage({ type: 'frame.ready' }) },
    dispose() {
      if (closed) return
      closed = true
      port.onmessage = null
      for (const reply of pending.values()) { reply.cleanup(); reply.reject(new Error('Frame closed')) }
      pending.clear()
      port.close()
    },
  }
}
