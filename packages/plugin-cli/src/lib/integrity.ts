import { createHash } from 'node:crypto'

import {
  MAX_ARCHIVE_ENTRIES,
  MAX_ENTRY_BYTES,
  MAX_UNCOMPRESSED_BYTES,
} from './constants.js'
import { fail } from './diagnostics.js'
import {
  assertUniquePackagePaths,
  countPackageEntries,
  packagePathCollisionKey,
  validatePackagePath,
} from './path-rules.js'
import { assertJsonIntegerToken, isJsonObject, parseStrictJson } from './strict-json.js'

export const INTEGRITY_VERSION = 1 as const
export const INTEGRITY_ALGORITHM = 'sha256' as const
export const MAX_SIGNATURE_FILE_BYTES = 8 * 1_024

export interface IntegrityFileV1 {
  readonly path: string
  readonly size: number
  readonly sha256: string
}

export interface IntegrityManifestV1 {
  readonly version: 1
  readonly algorithm: 'sha256'
  readonly files: readonly IntegrityFileV1[]
}

export type PackageFileMap = ReadonlyMap<string, Uint8Array>

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!isJsonObject(value)) fail('integrity.expected-object', `${path} must be an object`, path)
  return value
}

function assertAllowedKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const accepted = new Set(allowed)
  const unknown = Object.keys(object).find((key) => !accepted.has(key))
  if (unknown !== undefined) {
    fail('integrity.unknown-field', `${path}.${unknown} is not supported`, `${path}.${unknown}`)
  }
}

function required(object: Record<string, unknown>, key: string, path: string): unknown {
  if (!Object.hasOwn(object, key)) fail('integrity.missing-field', `${path}.${key} is required`, `${path}.${key}`)
  return object[key]
}

function safeUnsignedInteger(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    fail('integrity.invalid-size', `${path} must be a non-negative safe integer`, path)
  }
  return value
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

export function isLowercaseSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$(?![\s\S])/u.test(value)
}

function payloadFiles(files: PackageFileMap): Map<string, Uint8Array> {
  return new Map(
    [...files.entries()].filter(([path]) => path !== 'integrity.json' && path !== 'signature.sig'),
  )
}

function validateActualFiles(files: PackageFileMap): void {
  const entries = [...files.entries()]
  assertUniquePackagePaths(entries.map(([path]) => ({ path })))
  let total = 0
  for (const [rawPath, bytes] of entries) {
    const path = validatePackagePath(rawPath, { label: rawPath })
    if (bytes.byteLength > MAX_ENTRY_BYTES) {
      fail('package.file-too-large', `${path} exceeds the 10 MiB file limit`, path)
    }
    total += bytes.byteLength
    if (total > MAX_UNCOMPRESSED_BYTES) {
      fail('package.too-large', 'Package exceeds the 50 MiB uncompressed limit', path)
    }
  }
  if (countPackageEntries(entries.map(([path]) => path)) > MAX_ARCHIVE_ENTRIES) {
    fail('package.too-many-entries', `Package exceeds the ${MAX_ARCHIVE_ENTRIES}-entry limit`)
  }
  const signature = files.get('signature.sig')
  if (signature && signature.byteLength > MAX_SIGNATURE_FILE_BYTES) {
    fail('package.signature-too-large', 'signature.sig exceeds the 8 KiB limit', 'signature.sig')
  }
}

export function createIntegrityManifest(files: PackageFileMap): IntegrityManifestV1 {
  validateActualFiles(files)
  const payload = payloadFiles(files)
  if (!payload.has('plugin.json')) {
    fail('integrity.missing-plugin-manifest', 'Integrity manifest must cover plugin.json', 'plugin.json')
  }
  const entries = [...payload.entries()]
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([path, bytes]): IntegrityFileV1 => ({
      path: validatePackagePath(path, { label: path }),
      size: bytes.byteLength,
      sha256: sha256Hex(bytes),
    }))
  return {
    version: INTEGRITY_VERSION,
    algorithm: INTEGRITY_ALGORITHM,
    files: entries,
  }
}

export function serializeIntegrityManifest(integrity: IntegrityManifestV1): string {
  return `${JSON.stringify(integrity, null, 2)}\n`
}

export function validateIntegrityManifest(
  value: unknown,
  actualFiles?: PackageFileMap,
): IntegrityManifestV1 {
  const integrity = objectValue(value, '$')
  assertAllowedKeys(integrity, ['version', 'algorithm', 'files'], '$')
  if (required(integrity, 'version', '$') !== INTEGRITY_VERSION) {
    fail('integrity.unsupported-version', 'integrity.json version must be 1', '$.version')
  }
  assertJsonIntegerToken(integrity, 'version', '$.version')
  if (required(integrity, 'algorithm', '$') !== INTEGRITY_ALGORITHM) {
    fail('integrity.unsupported-algorithm', 'integrity.json algorithm must be sha256', '$.algorithm')
  }
  const rawFiles = required(integrity, 'files', '$')
  if (!Array.isArray(rawFiles)) fail('integrity.expected-array', '$.files must be an array', '$.files')

  const declared = new Map<string, IntegrityFileV1>()
  const folded = new Set<string>()
  let declaredBytes = 0
  for (const [index, rawFile] of rawFiles.entries()) {
    const pathLabel = `$.files[${index}]`
    const file = objectValue(rawFile, pathLabel)
    assertAllowedKeys(file, ['path', 'size', 'sha256'], pathLabel)
    const rawPath = required(file, 'path', pathLabel)
    if (typeof rawPath !== 'string') fail('integrity.invalid-path', `${pathLabel}.path must be a string`, `${pathLabel}.path`)
    const path = validatePackagePath(rawPath, { label: `${pathLabel}.path` })
    const size = safeUnsignedInteger(required(file, 'size', pathLabel), `${pathLabel}.size`)
    assertJsonIntegerToken(file, 'size', `${pathLabel}.size`)
    const digest = required(file, 'sha256', pathLabel)
    if (!isLowercaseSha256(digest)) {
      fail('integrity.invalid-digest', `${pathLabel}.sha256 must be a lowercase SHA-256 digest`, `${pathLabel}.sha256`)
    }
    const collisionKey = packagePathCollisionKey(path)
    if (
      path === 'integrity.json'
      || path === 'signature.sig'
      || declared.has(path)
      || folded.has(collisionKey)
    ) {
      fail('integrity.duplicate-or-forbidden-path', `${pathLabel}.path is duplicated or forbidden`, `${pathLabel}.path`)
    }
    if (size > MAX_ENTRY_BYTES) {
      fail('package.file-too-large', `${path} exceeds the 10 MiB file limit`, `${pathLabel}.size`)
    }
    declaredBytes += size
    if (declaredBytes > MAX_UNCOMPRESSED_BYTES) {
      fail('package.too-large', 'Declared payload exceeds the 50 MiB uncompressed limit', '$.files')
    }
    folded.add(collisionKey)
    declared.set(path, { path, size, sha256: digest })
  }

  if (!declared.has('plugin.json')) {
    fail('integrity.missing-plugin-manifest', 'Integrity manifest must cover plugin.json', '$.files')
  }
  assertUniquePackagePaths([...declared.keys()].map((path) => ({ path })))
  if (countPackageEntries([...declared.keys(), 'integrity.json']) > MAX_ARCHIVE_ENTRIES) {
    fail('package.too-many-entries', `Package exceeds the ${MAX_ARCHIVE_ENTRIES}-entry limit`, '$.files')
  }

  if (actualFiles) {
    validateActualFiles(actualFiles)
    const actualPayload = payloadFiles(actualFiles)
    if (declared.size !== actualPayload.size) {
      fail('integrity.file-set-mismatch', 'Payload file set does not exactly match integrity.json', '$.files')
    }
    for (const [path, declaration] of declared) {
      const bytes = actualPayload.get(path)
      if (!bytes) fail('integrity.missing-file', `integrity.json references missing file ${path}`, path)
      if (bytes.byteLength !== declaration.size || sha256Hex(bytes) !== declaration.sha256) {
        fail('integrity.content-mismatch', `${path} does not match its size or SHA-256 digest`, path)
      }
    }
    const undeclared = [...actualPayload.keys()].find((path) => !declared.has(path))
    if (undeclared !== undefined) {
      fail('integrity.undeclared-file', `Package contains undeclared payload ${undeclared}`, undeclared)
    }
  }

  return integrity as unknown as IntegrityManifestV1
}

export function parseIntegrityManifest(
  input: string | Uint8Array,
  actualFiles?: PackageFileMap,
): IntegrityManifestV1 {
  return validateIntegrityManifest(parseStrictJson(input, 'integrity.json'), actualFiles)
}
