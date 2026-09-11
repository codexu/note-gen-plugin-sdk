import { fail } from './diagnostics.js'

export const MAX_PACKAGE_PATH_BYTES = 1_024
export const MAX_PACKAGE_SEGMENT_BYTES = 240
export const MAX_PACKAGE_PATH_DEPTH = 12

const RESERVED_SEGMENTS = new Set([
  '.notegen',
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.cache',
])

const FORBIDDEN_FILE_SUFFIXES = Object.freeze([
  '.exe', '.dll', '.dylib', '.so', '.node', '.msi', '.dmg', '.pkg',
  '.deb', '.rpm', '.apk', '.ipa', '.app', '.jar', '.class', '.bat', '.cmd',
  '.ps1', '.sh', '.map', '.pem', '.p12', '.pfx',
] as const)

const INVALID_PORTABLE_CHARACTERS = /[<>:"|?*]/u
const CONTROL_CHARACTER = /\p{Cc}/u

export interface PackagePathOptions {
  readonly directory?: boolean
  readonly label?: string
}

export interface PackagePathEntry {
  readonly path: string
  readonly directory?: boolean
}

export function utf8ByteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8')
}

export function hasControlCharacter(value: string): boolean {
  return CONTROL_CHARACTER.test(value)
}

function asciiUppercase(value: string): string {
  return value.replace(/[a-z]/g, (character) => character.toUpperCase())
}

function isWindowsReservedName(segment: string): boolean {
  const stem = asciiUppercase(segment.replace(/[. ]+$/u, '').split('.')[0] ?? '')
  return stem === 'CON'
    || stem === 'PRN'
    || stem === 'AUX'
    || stem === 'NUL'
    || stem === 'CLOCK$'
    || stem === 'CONIN$'
    || stem === 'CONOUT$'
    || /^(?:COM|LPT)(?:[1-9¹²³])$(?![\s\S])/u.test(stem)
}

export function packagePathCollisionKey(path: string): string {
  return path.toLowerCase().normalize('NFC')
}

export function isForbiddenPackageFilePath(path: string): boolean {
  const lower = path.toLowerCase()
  return FORBIDDEN_FILE_SUFFIXES.some((suffix) => lower.endsWith(suffix))
}

/** Validates and returns the canonical forward-slash package path. */
export function validatePackagePath(raw: string, options: PackagePathOptions = {}): string {
  const label = options.label ?? 'package path'
  const directory = options.directory === true
  if (
    raw.length === 0
    || raw.startsWith('/')
    || raw.startsWith('\\')
    || raw.includes('\\')
    || hasControlCharacter(raw)
  ) {
    fail('path.unsafe', `${label} is not a safe relative package path`, label)
  }

  let path = raw
  if (directory) {
    if (path.endsWith('/')) path = path.slice(0, -1)
  } else if (path.endsWith('/')) {
    fail('path.file-trailing-slash', `${label} is a file path and must not end in /`, label)
  }

  if (
    path.length === 0
    || utf8ByteLength(path) > MAX_PACKAGE_PATH_BYTES
    || path.includes('//')
  ) {
    fail('path.unsafe', `${label} is empty, duplicated, or too long`, label)
  }

  const segments = path.split('/')
  if (segments.length > MAX_PACKAGE_PATH_DEPTH) {
    fail(
      'path.too-deep',
      `${label} exceeds the ${MAX_PACKAGE_PATH_DEPTH}-segment nesting limit`,
      label,
    )
  }

  for (const segment of segments) {
    if (
      segment.length === 0
      || utf8ByteLength(segment) > MAX_PACKAGE_SEGMENT_BYTES
      || segment === '.'
      || segment === '..'
      || segment.normalize('NFC') !== segment
      || segment.endsWith('.')
      || segment.endsWith(' ')
      || INVALID_PORTABLE_CHARACTERS.test(segment)
      || isWindowsReservedName(segment)
    ) {
      fail('path.non-portable', `${label} contains a non-canonical or non-portable segment`, label)
    }

    const lower = segment.toLowerCase()
    if (
      RESERVED_SEGMENTS.has(lower)
      || lower === '.env'
      || lower.startsWith('.env.')
    ) {
      fail('path.reserved', `${label} contains a reserved or sensitive segment`, label)
    }
  }

  if (!directory && isForbiddenPackageFilePath(path)) {
    fail('path.forbidden-file', `${label} has an executable, native, or sensitive suffix`, label)
  }
  return path
}

/**
 * Enforces exact and case/NFC collision rules as well as the file-as-parent
 * prohibition used by the desktop host.
 */
export function assertUniquePackagePaths(entries: readonly PackagePathEntry[]): void {
  const exact = new Map<string, boolean>()
  const folded = new Map<string, string>()

  for (const entry of entries) {
    const directory = entry.directory === true
    const path = validatePackagePath(entry.path, { directory, label: entry.path })
    if (exact.has(path)) {
      fail('path.duplicate', `Package contains the path more than once: ${path}`, path)
    }
    exact.set(path, directory)

    // ZIPs need not contain directory entries. Check their implicit parents as
    // well, otherwise A/x.json and a/y.json pass here but cannot be installed
    // consistently on case-sensitive and case-insensitive filesystems.
    const segments = path.split('/')
    for (let index = 1; index <= segments.length; index += 1) {
      const expandedPath = segments.slice(0, index).join('/')
      const collisionKey = packagePathCollisionKey(expandedPath)
      const previous = folded.get(collisionKey)
      if (previous !== undefined && previous !== expandedPath) {
        fail(
          'path.case-collision',
          `Package paths collide by case or Unicode normalization: ${previous}, ${expandedPath}`,
          path,
        )
      }
      folded.set(collisionKey, expandedPath)
    }
  }

  const files = new Set(
    [...exact.entries()]
      .filter(([, directory]) => !directory)
      .map(([path]) => path),
  )
  for (const [path, directory] of exact) {
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join('/')
      if (files.has(parent)) {
        fail('path.file-as-parent', `Package file is also used as a directory: ${parent}`, path)
      }
    }
    if (directory && files.has(path)) {
      fail('path.file-directory-collision', `Package path is both a file and directory: ${path}`, path)
    }
  }
}

export function countPackageEntries(filePaths: readonly string[]): number {
  const directories = new Set<string>()
  for (const raw of filePaths) {
    const path = validatePackagePath(raw, { label: raw })
    const segments = path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      directories.add(segments.slice(0, index).join('/'))
    }
  }
  return filePaths.length + directories.size
}
