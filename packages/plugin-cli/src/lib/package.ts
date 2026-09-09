import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import type { PluginManifestV1 } from '@notegen/plugin-api'
import { decodePackageSignature, assertPackageSignature } from './signing.js'
import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_UNCOMPRESSED_BYTES,
} from './constants.js'
import {
  MAX_SIGNATURE_FILE_BYTES,
  parseIntegrityManifest,
  type IntegrityManifestV1,
  type PackageFileMap,
} from './integrity.js'
import { parsePluginManifest } from './manifest.js'
import { parseStrictJson, isJsonObject } from './strict-json.js'
import { assertDirectory, assertInside } from './files.js'
import { diagnostic, DiagnosticError, fail } from './diagnostics.js'
import { assertUniquePackagePaths, validatePackagePath } from './path-rules.js'

export interface PackageValidationOptions {
  readonly apiVersion?: string
  readonly appVersion?: string
  readonly publicKey?: string
  readonly requireSignature?: boolean
}

export interface ValidatedPluginPackage {
  readonly manifest: PluginManifestV1
  readonly manifestValue: unknown
  readonly integrity: IntegrityManifestV1
  readonly integrityValue: unknown
  readonly files: PackageFileMap
  readonly signature: string | undefined
  readonly signatureVerified: boolean
}

function requiredFile(files: PackageFileMap, path: string): Uint8Array {
  const bytes = files.get(path)
  if (!bytes) fail('package.missing-file', `Plugin package is missing ${path}`, path)
  return bytes
}

function decodeUtf8(bytes: Uint8Array, path: string): string {
  try {
    const value = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    if (value.includes('\0')) fail('package.nul-byte', `${path} contains a NUL byte`, path)
    return value
  } catch (error) {
    if (error instanceof DiagnosticError) throw error
    fail('package.invalid-utf8', `${path} must contain valid UTF-8`, path)
  }
}

function validateOptionalPackageJson(files: PackageFileMap): void {
  const bytes = files.get('package.json')
  if (!bytes) return
  const value = parseStrictJson(bytes, 'package.json')
  if (!isJsonObject(value)) return
  const scripts = value.scripts
  if (!isJsonObject(scripts)) return
  for (const name of ['preinstall', 'install', 'postinstall']) {
    if (Object.hasOwn(scripts, name)) {
      fail(
        'package.install-script',
        `Plugin packages must not contain the ${name} lifecycle script`,
        `package.json#scripts.${name}`,
      )
    }
  }
}

export function validatePackageFiles(
  files: PackageFileMap,
  options: PackageValidationOptions = {},
): ValidatedPluginPackage {
  const pluginBytes = requiredFile(files, 'plugin.json')
  const integrityBytes = requiredFile(files, 'integrity.json')
  const manifestValue = parseStrictJson(pluginBytes, 'plugin.json')
  const integrityValue = parseStrictJson(integrityBytes, 'integrity.json')
  const integrity = parseIntegrityManifest(integrityBytes, files)
  const manifest = parsePluginManifest(pluginBytes, {
    files,
    ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
    ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
  })
  validateOptionalPackageJson(files)

  const signatureBytes = files.get('signature.sig')
  const signature = signatureBytes ? decodeUtf8(signatureBytes, 'signature.sig') : undefined
  if (signature !== undefined) decodePackageSignature(signature)
  if (options.requireSignature && signature === undefined) {
    fail('signature.missing', 'Signed plugin package is missing signature.sig', 'signature.sig')
  }
  if (options.publicKey !== undefined && signature === undefined) {
    fail('signature.missing', 'A public key was provided but the package has no signature.sig', 'signature.sig')
  }
  if (options.publicKey !== undefined && signature !== undefined) {
    assertPackageSignature(manifestValue, integrityValue, signature, options.publicKey)
  }

  return Object.freeze({
    manifest,
    manifestValue,
    integrity,
    integrityValue,
    files,
    signature,
    signatureVerified: options.publicKey !== undefined,
  })
}

async function readSafePackageFile(
  root: string,
  relativePath: string,
  maximumBytes = MAX_ENTRY_BYTES,
): Promise<Buffer> {
  const segments = relativePath.split('/')
  let current = root
  for (let index = 0; index < segments.length; index += 1) {
    current = join(current, segments[index] ?? '')
    let metadata
    try {
      metadata = await lstat(current)
    } catch {
      throw new DiagnosticError(diagnostic({
        code: 'package.missing-file',
        message: `Plugin package is missing ${relativePath}`,
        path: current,
      }))
    }
    if (metadata.isSymbolicLink()) {
      throw new DiagnosticError(diagnostic({
        code: 'package.symlink',
        message: 'Plugin package paths cannot contain symbolic links',
        path: current,
      }))
    }
    const final = index === segments.length - 1
    if (final ? !metadata.isFile() : !metadata.isDirectory()) {
      throw new DiagnosticError(diagnostic({
        code: 'package.file-type',
        message: final ? 'Package payload must be a regular file' : 'Package path parent must be a directory',
        path: current,
      }))
    }
    if (final && (metadata.mode & 0o111) !== 0) {
      throw new DiagnosticError(diagnostic({
        code: 'package.executable',
        message: 'Executable package files are not allowed',
        path: current,
      }))
    }
    if (final && metadata.size > maximumBytes) {
      throw new DiagnosticError(diagnostic({
        code: 'package.file-too-large',
        message: `Package file exceeds ${maximumBytes} bytes`,
        path: current,
      }))
    }
  }
  assertInside(root, current, 'Package file')
  const bytes = await readFile(current)
  if (bytes.byteLength > maximumBytes) {
    fail('package.file-too-large', `Package file exceeds ${maximumBytes} bytes`, current)
  }
  return bytes
}

export async function readPackageDirectory(directory: string): Promise<Map<string, Buffer>> {
  const root = resolve(directory)
  await assertDirectory(root, 'Plugin package directory')
  const manifestBytes = await readSafePackageFile(root, 'plugin.json')
  const integrityBytes = await readSafePackageFile(root, 'integrity.json')
  const integrity = parseIntegrityManifest(integrityBytes)
  const files = new Map<string, Buffer>([
    ['plugin.json', manifestBytes],
    ['integrity.json', integrityBytes],
  ])
  for (const item of integrity.files) {
    if (!files.has(item.path)) {
      files.set(item.path, await readSafePackageFile(root, item.path))
    }
  }
  const signaturePath = join(root, 'signature.sig')
  let hasSignature = false
  try {
    await lstat(signaturePath)
    hasSignature = true
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause.code !== 'ENOENT') {
      throw new DiagnosticError(diagnostic({
        code: 'package.signature-inspection-failed',
        message: 'Unable to inspect development plugin signature.sig',
        path: signaturePath,
      }))
    }
  }
  if (hasSignature) {
    files.set(
      'signature.sig',
      await readSafePackageFile(root, 'signature.sig', MAX_SIGNATURE_FILE_BYTES),
    )
  }
  return files
}

/** Reads every entry in a complete package directory, unlike development import. */
export async function readCompletePackageDirectory(directory: string): Promise<Map<string, Buffer>> {
  const root = resolve(directory)
  await assertDirectory(root, 'Complete plugin package directory')
  const files = new Map<string, Buffer>()
  const entries: Array<{ readonly path: string; readonly directory?: boolean }> = []
  let totalBytes = 0

  const visit = async (relativeDirectory: string): Promise<void> => {
    const current = relativeDirectory === ''
      ? root
      : join(root, ...relativeDirectory.split('/'))
    const names = await readdir(current)
    names.sort((left, right) => left < right ? -1 : left > right ? 1 : 0)
    for (const name of names) {
      const relativePath = relativeDirectory === '' ? name : `${relativeDirectory}/${name}`
      const path = join(current, name)
      const metadata = await lstat(path)
      if (metadata.isSymbolicLink()) {
        fail('package.symlink', 'Complete package directories cannot contain symbolic links', path)
      }
      const directoryEntry = metadata.isDirectory()
      if (!directoryEntry && !metadata.isFile()) {
        fail('package.file-type', 'Complete package directories cannot contain special files', path)
      }
      const packagePath = validatePackagePath(relativePath, {
        directory: directoryEntry,
        label: relativePath,
      })
      entries.push({ path: packagePath, directory: directoryEntry })
      if (entries.length > MAX_ARCHIVE_ENTRIES) {
        fail('package.too-many-entries', `Package exceeds the ${MAX_ARCHIVE_ENTRIES}-entry limit`, path)
      }
      assertUniquePackagePaths(entries)
      if (directoryEntry) {
        await visit(packagePath)
        continue
      }
      if ((metadata.mode & 0o111) !== 0) {
        fail('package.executable', 'Executable package files are not allowed', path)
      }
      const maximum = packagePath === 'signature.sig'
        ? MAX_SIGNATURE_FILE_BYTES
        : MAX_ENTRY_BYTES
      if (metadata.size > maximum) {
        fail('package.file-too-large', `Package file exceeds ${maximum} bytes`, path)
      }
      const bytes = await readFile(path)
      if (bytes.byteLength !== metadata.size || bytes.byteLength > maximum) {
        fail('package.changed', 'Package file changed while it was being read', path)
      }
      totalBytes += bytes.byteLength
      if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
        fail('package.too-large', 'Package exceeds the 50 MiB uncompressed limit', path)
      }
      files.set(packagePath, bytes)
    }
  }

  await visit('')
  return files
}
