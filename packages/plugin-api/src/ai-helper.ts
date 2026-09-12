import { PluginError } from './index.js'
import type { PluginAbortSignal, PluginAiRequest, PluginContext } from './index.js'

/** Connects per-render cancellation and streaming to the host's AI request. */
export async function generateText(context: PluginContext, request: PluginAiRequest, options: {
  signal?: PluginAbortSignal; onUpdate?: (text: string) => void
} = {}): Promise<string> {
  if (options.signal?.aborted || context.signal.aborted) throw new PluginError('Cancelled', 'AI request cancelled')
  const subscription = context.ai.onDidStream(event => {
    if (event.requestId === request.requestId && !options.signal?.aborted) options.onUpdate?.(event.text)
  })
  const cancel = () => { void context.ai.cancel(request.requestId).catch(() => undefined) }
  options.signal?.addEventListener('abort', cancel)
  try {
    const result = await context.ai.generate(request)
    if (options.signal?.aborted) throw new PluginError('Cancelled', 'AI request cancelled')
    options.onUpdate?.(result.text)
    return result.text
  } finally {
    subscription.dispose()
    options.signal?.removeEventListener('abort', cancel)
  }
}

/** Validates model output locally; the host does not promise provider-specific JSON mode. */
export async function generateJson<T>(context: PluginContext, request: PluginAiRequest, validate: (value: unknown) => T, signal?: PluginAbortSignal): Promise<T> {
  const system = `${request.system ?? ''}\nReturn only a valid JSON value. Do not use Markdown fences.`
  if (system.length > 10_000) throw new PluginError('InvalidPath', 'System prompt including JSON instruction exceeds 10000 characters')
  const text = await generateText(context, { ...request, system }, { signal })
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new PluginError('RuntimeFailure', 'The model did not return valid JSON') }
  return validate(value)
}
