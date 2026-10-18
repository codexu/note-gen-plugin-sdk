/** Resource-only Markdown rendering. This protocol is independent of QuickJS RPC. */
export interface PluginCodeBlockRendererResource {
  id: string
  name: string
  languages: string[]
  /** Self-contained classic browser script, executed inside an opaque sandbox. */
  script: string
  assets?: string[]
}

export const CODE_BLOCK_RENDERER_PROTOCOL = 1 as const
export const CODE_BLOCK_RENDERER_LIMITS = Object.freeze({
  sourceBytes: 128 * 1024,
  resultBytes: 2 * 1024 * 1024,
  assetBytes: 5 * 1024 * 1024,
  timeoutMs: 15_000,
})

export interface CodeBlockRenderRequest {
  requestId: string
  language: string
  source: string
  theme: 'light' | 'dark'
  locale: string
}
export type CodeBlockRenderResult =
  | { type: 'svg'; svg: string }
  | { type: 'png'; bytes: Uint8Array }

export interface CodeBlockRendererInit {
  type: 'notegen:code-block-renderer-init'
  protocol: typeof CODE_BLOCK_RENDERER_PROTOCOL
  token: string
}
export interface CodeBlockRendererContext {
  /** Only this renderer's manifest-declared package assets are readable. */
  readAsset(path: string): Promise<Uint8Array>
}

/** Structural browser types keep the SDK usable in QuickJS and Node without DOM libs. */
interface RendererPort {
  postMessage(value: unknown): void
  onmessage: ((event: { data: unknown }) => void) | null
  close(): void
}
interface RendererWindow {
  parent: unknown
  addEventListener(type: 'message', callback: (event: {
    source: unknown; data: unknown; ports: readonly RendererPort[]
  }) => void): void
}

/** Call synchronously from the resource script. One render is dispatched at a time.
 * No editor, file, network or general plugin context is exposed to this sandbox.
 * Large/expensive engines should execute in a dedicated Worker.
 */
export function registerCodeBlockRenderer(
  render: (request: CodeBlockRenderRequest, context: CodeBlockRendererContext) => Promise<CodeBlockRenderResult> | CodeBlockRenderResult,
): void {
  const scope = globalThis as unknown as RendererWindow
  let connected = false
  scope.addEventListener('message', event => {
    const init = event.data as Partial<CodeBlockRendererInit> | null
    if (connected || event.source !== scope.parent || !init
      || init.type !== 'notegen:code-block-renderer-init' || init.protocol !== CODE_BLOCK_RENDERER_PROTOCOL
      || typeof init.token !== 'string' || event.ports.length !== 1) return
    connected = true
    const port = event.ports[0]!
    let assetSequence = 0
    let busy = false
    const assets = new Map<number, { resolve(value: Uint8Array): void; reject(reason: Error): void }>()
    const context: CodeBlockRendererContext = {
      readAsset(path) {
        return new Promise((resolve, reject) => {
          const id = ++assetSequence
          assets.set(id, { resolve, reject })
          port.postMessage({ type: 'renderer.readAsset', id, path })
        })
      },
    }
    port.onmessage = ({ data }) => {
      if (!data || typeof data !== 'object') return
      const message = data as Record<string, unknown>
      if (message.type === 'host.asset' && typeof message.id === 'number') {
        const pending = assets.get(message.id)
        if (!pending) return
        assets.delete(message.id)
        if (message.result instanceof Uint8Array) pending.resolve(message.result)
        else pending.reject(new Error(typeof message.error === 'string' ? message.error : 'Asset unavailable'))
        return
      }
      if (message.type !== 'host.render' || typeof message.request !== 'object' || !message.request) return
      const request = message.request as CodeBlockRenderRequest
      if (typeof request.requestId !== 'string' || typeof request.source !== 'string'
        || typeof request.language !== 'string' || typeof request.locale !== 'string'
        || !['light', 'dark'].includes(request.theme)) return
      if (busy) {
        port.postMessage({ type: 'renderer.result', requestId: request.requestId, error: 'Renderer is busy' })
        return
      }
      busy = true
      void Promise.resolve().then(() => render(request, context)).then(
        result => port.postMessage({ type: 'renderer.result', requestId: request.requestId, result }),
        error => port.postMessage({ type: 'renderer.result', requestId: request.requestId, error: String(error instanceof Error ? error.message : error).slice(0, 500) }),
      ).finally(() => { busy = false })
    }
    port.postMessage({ type: 'renderer.ready', token: init.token })
  })
}

/** In addition to the host's canonical path validation. */
export function validateCodeBlockRendererResources(value: unknown, validatePath: (value: unknown) => void): asserts value is PluginCodeBlockRendererResource[] {
  if (!Array.isArray(value) || value.length > 30) throw new Error('Invalid code block renderers')
  const ids = new Set<string>()
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid renderer')
    const r = item as Record<string, unknown>
    if (Object.keys(r).some(key => !['id', 'name', 'languages', 'script', 'assets'].includes(key))
      || typeof r.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$(?![\s\S])/.test(r.id) || ids.has(r.id)
      || typeof r.name !== 'string' || !r.name.trim() || [...r.name].reduce((size, char) => { const point = char.codePointAt(0)!; return size + (point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4) }, 0) > 160 || /\p{Cc}/u.test(r.name)) throw new Error('Invalid renderer metadata')
    if (r.name.startsWith('%') && !/^%[A-Za-z0-9._-]+%$/.test(r.name)) throw new Error('Invalid renderer localization reference')
    ids.add(r.id)
    if (!Array.isArray(r.languages) || !r.languages.length || r.languages.length > 30
      || new Set(r.languages).size !== r.languages.length
      || r.languages.some(language => typeof language !== 'string' || !/^[a-z0-9][a-z0-9_+.#-]{0,31}$(?![\s\S])/.test(language))) throw new Error('Invalid renderer languages')
    validatePath(r.script)
    if (!(r.script as string).endsWith('.js')) throw new Error('Renderer script must be JavaScript')
    if (r.assets !== undefined) {
      if (!Array.isArray(r.assets) || r.assets.length > 100 || new Set(r.assets).size !== r.assets.length) throw new Error('Invalid renderer assets')
      r.assets.forEach(validatePath)
    }
  }
}
