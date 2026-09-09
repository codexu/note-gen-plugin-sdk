import { constants as fsConstants } from 'node:fs'
import {
  chmod,
  copyFile,
  link,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { diagnostic, DiagnosticError } from './diagnostics.js'

export async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause.code === 'ENOENT') return false
    throw new DiagnosticError(diagnostic({
      code: 'path.inspection-failed',
      message: 'Unable to inspect path existence',
      path,
    }))
  }
}

export async function assertRegularFile(path: string, label = 'File'): Promise<void> {
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause.code !== 'ENOENT') {
      throw new DiagnosticError(diagnostic({
        code: 'file.inspection-failed',
        message: `Unable to inspect ${label.toLowerCase()}`,
        path,
      }))
    }
    throw new DiagnosticError(diagnostic({
      code: 'file.missing',
      message: `${label} does not exist`,
      path,
    }))
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) {
    throw new DiagnosticError(diagnostic({
      code: 'file.not_regular',
      message: `${label} must be a regular file and cannot be a symbolic link`,
      path,
    }))
  }
}

export async function assertDirectory(path: string, label = 'Directory'): Promise<void> {
  let metadata
  try {
    metadata = await lstat(path)
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause.code !== 'ENOENT') {
      throw new DiagnosticError(diagnostic({
        code: 'directory.inspection-failed',
        message: `Unable to inspect ${label.toLowerCase()}`,
        path,
      }))
    }
    throw new DiagnosticError(diagnostic({
      code: 'directory.missing',
      message: `${label} does not exist`,
      path,
    }))
  }
  if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
    throw new DiagnosticError(diagnostic({
      code: 'directory.not_regular',
      message: `${label} must be a directory and cannot be a symbolic link`,
      path,
    }))
  }
}

export function assertInside(parent: string, candidate: string, label = 'Path'): void {
  const parentPath = resolve(parent)
  const candidatePath = resolve(candidate)
  const child = relative(parentPath, candidatePath)
  if (child === '' || (!child.startsWith(`..${sep}`) && child !== '..' && !isAbsolute(child))) {
    return
  }
  throw new DiagnosticError(diagnostic({
    code: 'path.outside_project',
    message: `${label} must stay inside ${parentPath}`,
    path: candidatePath,
  }))
}

export async function assertNoSymlinkComponents(
  parent: string,
  candidate: string,
  label = 'Path',
): Promise<void> {
  const root = resolve(parent)
  const target = resolve(candidate)
  assertInside(root, target, label)
  const child = relative(root, target)
  if (child === '') return
  const segments = child.split(sep)
  let current = root
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index] ?? '')
    let metadata
    try {
      metadata = await lstat(current)
    } catch (error) {
      const cause = error as NodeJS.ErrnoException
      if (cause.code === 'ENOENT') return
      throw error
    }
    if (metadata.isSymbolicLink()) {
      throw new DiagnosticError(diagnostic({
        code: 'path.symlink',
        message: `${label} cannot contain symbolic links`,
        path: current,
      }))
    }
    if (index < segments.length - 1 && !metadata.isDirectory()) {
      throw new DiagnosticError(diagnostic({
        code: 'path.parent_not_directory',
        message: `${label} has a parent that is not a directory`,
        path: current,
      }))
    }
  }
}

export async function readUtf8File(path: string, label = 'File'): Promise<string> {
  await assertRegularFile(path, label)
  const bytes = await readFile(path)
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  if (decoded.includes('\0')) {
    throw new DiagnosticError(diagnostic({
      code: 'file.nul_byte',
      message: `${label} must not contain NUL bytes`,
      path,
    }))
  }
  return decoded
}

export async function writeFileExclusive(
  path: string,
  contents: string | Uint8Array,
  mode?: number,
): Promise<void> {
  await atomicWriteFiles([{
    path,
    contents,
    ...(mode === undefined ? {} : { mode }),
  }])
}

export async function atomicWriteFile(
  path: string,
  contents: string | Uint8Array,
  options: { readonly force?: boolean; readonly mode?: number } = {},
): Promise<void> {
  await atomicWriteFiles([{
    path,
    contents,
    ...(options.mode === undefined ? {} : { mode: options.mode }),
  }], { force: options.force })
}

export interface AtomicFileWrite {
  readonly path: string
  readonly contents: string | Uint8Array
  readonly mode?: number
}

interface StagedAtomicFile {
  readonly output: string
  readonly temporary: string
  readonly backup: string
  readonly contents: string | Uint8Array
  readonly mode?: number
  existed: boolean
  backedUp: boolean
  committed: boolean
}

/**
 * Publishes a related set of files as one recoverable transaction. Each target
 * is linked from a fully written sibling file, and any replaced files are kept
 * until every new target has been committed. If a later commit fails, already
 * committed targets are removed and the previous set is restored.
 */
export async function atomicWriteFiles(
  input: readonly AtomicFileWrite[],
  options: { readonly force?: boolean } = {},
): Promise<void> {
  const transactionId = randomBytes(12).toString('hex')
  const files: StagedAtomicFile[] = input.map((item, index) => {
    const output = resolve(item.path)
    return {
      output,
      temporary: join(dirname(output), `.${transactionId}-${index}.tmp`),
      backup: join(dirname(output), `.${transactionId}-${index}.previous`),
      contents: item.contents,
      ...(item.mode === undefined ? {} : { mode: item.mode }),
      existed: false,
      backedUp: false,
      committed: false,
    }
  })
  if (new Set(files.map((item) => item.output)).size !== files.length) {
    throw new DiagnosticError(diagnostic({
      code: 'file.duplicate-output',
      message: 'A transactional write cannot target the same file more than once',
    }))
  }

  let completed = false
  try {
    for (const item of files) {
      await mkdir(dirname(item.output), { recursive: true })
      try {
        const metadata = await lstat(item.output)
        item.existed = true
        if (!metadata.isFile() || metadata.isSymbolicLink()) {
          throw new DiagnosticError(diagnostic({
            code: 'file.not_regular',
            message: 'Refusing to replace a non-regular file',
            path: item.output,
          }))
        }
        if (!options.force) {
          throw new DiagnosticError(diagnostic({
            code: 'file.exists',
            message: 'Refusing to overwrite an existing file',
            path: item.output,
            hint: 'Choose another output path or pass --force after reviewing the target.',
          }))
        }
      } catch (error) {
        const cause = error as NodeJS.ErrnoException
        if (cause.code !== 'ENOENT') throw error
      }
      await writeFile(item.temporary, item.contents, {
        flag: 'wx',
        ...(item.mode === undefined ? {} : { mode: item.mode }),
      })
      if (item.mode !== undefined) await chmod(item.temporary, item.mode)
    }

    for (const item of files) {
      if (item.existed) {
        await rename(item.output, item.backup)
        item.backedUp = true
      }
    }
    for (const item of files) {
      // A hard link is an atomic no-clobber publish because the staged file is
      // in the same directory (and therefore on the same filesystem).
      await link(item.temporary, item.output)
      item.committed = true
      await rm(item.temporary, { force: true })
    }
    completed = true
    const retainedBackups: string[] = []
    for (const item of files) {
      if (!item.backedUp) continue
      try {
        await rm(item.backup, { force: true })
        item.backedUp = false
      } catch {
        retainedBackups.push(item.backup)
      }
    }
    if (retainedBackups.length > 0) {
      throw new DiagnosticError(diagnostic({
        code: 'file.backup-cleanup-failed',
        message: 'The new files were published, but an old backup could not be removed',
        path: retainedBackups.join(', '),
        hint: 'The new files are active. Securely remove the listed .previous backup files.',
      }))
    }
  } catch (error) {
    if (completed) throw error
    const recoveryFailures: string[] = []
    for (const item of [...files].reverse()) {
      if (item.committed) {
        try {
          await rm(item.output, { force: true })
          item.committed = false
        } catch {
          recoveryFailures.push(item.output)
        }
      }
    }
    for (const item of [...files].reverse()) {
      if (item.backedUp) {
        await rename(item.backup, item.output).then(() => {
          item.backedUp = false
        }).catch(() => {
          recoveryFailures.push(item.backup)
        })
      }
    }
    for (const item of files) {
      await rm(item.temporary, { force: true }).catch(() => {
        recoveryFailures.push(item.temporary)
      })
    }
    if (recoveryFailures.length > 0) {
      throw new DiagnosticError(diagnostic({
        code: 'file.transaction-recovery-failed',
        message: 'A transactional write failed and cleanup or recovery was incomplete',
        path: recoveryFailures.join(', '),
        hint: 'Keep any listed .previous files; they contain the recoverable originals.',
      }))
    }
    throw error
  } finally {
    for (const item of files) {
      await rm(item.temporary, { force: true }).catch(() => undefined)
      if (completed && item.backedUp) await rm(item.backup, { force: true }).catch(() => undefined)
    }
  }
}

export async function replaceDirectoryAtomically(
  destination: string,
  populate: (temporary: string) => Promise<void>,
): Promise<void> {
  const output = resolve(destination)
  await mkdir(dirname(output), { recursive: true })
  const temporary = await mkdtemp(join(dirname(output), '.notegen-stage-'))
  const previous = `${output}.previous-${randomBytes(8).toString('hex')}`
  let movedPrevious = false
  let published = false
  try {
    await populate(temporary)
    if (await pathExists(output)) {
      const existing = await lstat(output)
      if (!existing.isDirectory() || existing.isSymbolicLink()) {
        throw new DiagnosticError(diagnostic({
          code: 'output.unsafe',
          message: 'Development output must be a real directory',
          path: output,
        }))
      }
      await rename(output, previous)
      movedPrevious = true
    }
    await rename(temporary, output)
    published = true
    if (movedPrevious) {
      try {
        await rm(previous, { recursive: true, force: true })
        movedPrevious = false
      } catch {
        throw new DiagnosticError(diagnostic({
          code: 'output.backup-cleanup-failed',
          message: 'The new development output is active, but its previous backup could not be removed',
          path: previous,
          hint: 'Review the new output, then remove the listed previous backup manually.',
        }))
      }
    }
  } catch (error) {
    if (!published && movedPrevious) {
      let outputExists = false
      try {
        await lstat(output)
        outputExists = true
      } catch (inspectionError) {
        const cause = inspectionError as NodeJS.ErrnoException
        if (cause.code !== 'ENOENT') {
          throw new DiagnosticError(diagnostic({
            code: 'output.transaction-recovery-failed',
            message: 'Publishing failed and the destination could not be inspected during recovery',
            path: previous,
            hint: 'Keep the listed previous backup; it contains the recoverable original output.',
          }))
        }
      }
      if (outputExists) {
        throw new DiagnosticError(diagnostic({
          code: 'output.transaction-recovery-failed',
          message: 'Publishing failed because the destination changed, so the previous output was preserved separately',
          path: previous,
          hint: 'Keep the listed previous backup and reconcile it with the current destination manually.',
        }))
      }
      try {
        await rename(previous, output)
        movedPrevious = false
      } catch {
        throw new DiagnosticError(diagnostic({
          code: 'output.transaction-recovery-failed',
          message: 'Publishing failed and the previous development output could not be restored',
          path: previous,
          hint: 'Keep the listed previous backup; it contains the recoverable original output.',
        }))
      }
    }
    throw error
  } finally {
    await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
  }
}

export async function makeTemporaryDirectory(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix))
}

export async function copyRegularFile(source: string, destination: string): Promise<void> {
  await assertRegularFile(source)
  await mkdir(dirname(destination), { recursive: true })
  await copyFile(source, destination, fsConstants.COPYFILE_EXCL)
}

export async function canonicalPath(path: string): Promise<string> {
  return realpath(resolve(path))
}

export async function fileSize(path: string): Promise<number> {
  return (await stat(path)).size
}
