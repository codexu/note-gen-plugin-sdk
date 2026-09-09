import { readdir, lstat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { buildPluginProject, type BuildPluginProjectOptions, type BuiltPluginProject } from './project.js'

const ignored = new Set(['node_modules', '.git', '.notegen', 'dist', 'build', '.next'])

async function sourceRevision(root: string): Promise<string> {
  const hash = createHash('sha256')
  let count = 0
  async function visit(directory: string, depth: number): Promise<void> {
    if (depth > 32) throw new Error('Development source tree exceeds 32 levels')
    const entries = await readdir(directory, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue
      if (++count > 10_000) throw new Error('Development source tree exceeds 10,000 entries')
      const path = join(directory, entry.name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) continue
      if (metadata.isDirectory()) await visit(path, depth + 1)
      else if (metadata.isFile()) hash.update(JSON.stringify([path, metadata.size, metadata.mtimeMs, metadata.ctimeMs]))
    }
  }
  await visit(root, 0)
  return hash.digest('hex')
}

export async function watchPluginProject(options: BuildPluginProjectOptions & {
  signal: AbortSignal
  onBuilt: (result: BuiltPluginProject) => void
  onError: (error: unknown) => void
}): Promise<void> {
  const root = resolve(options.directory ?? process.cwd())
  let previous: string | undefined
  let lastError = ''
  while (!options.signal.aborted) {
    try {
      const revision = await sourceRevision(root)
      if (revision !== previous) {
        previous = revision
        const built = await buildPluginProject(options)
        lastError = ''
        if (!options.signal.aborted) options.onBuilt(built)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (lastError !== message) options.onError(error)
      lastError = message
    }
    if (options.signal.aborted) break
    await new Promise<void>(resolveWait => {
      const finish = () => { clearTimeout(timer); options.signal.removeEventListener('abort', finish); resolveWait() }
      const timer = setTimeout(finish, 1_000)
      options.signal.addEventListener('abort', finish, { once: true })
      if (options.signal.aborted) finish()
    })
  }
}
