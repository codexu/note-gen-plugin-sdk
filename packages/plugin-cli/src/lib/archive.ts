import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { deflateRawSync } from 'node:zlib'
import * as yauzl from 'yauzl'
import * as yazl from 'yazl'
import {
  MAX_ARCHIVE_BYTES,
  MAX_ARCHIVE_ENTRIES,
  MAX_COMPRESSION_RATIO,
  MAX_ENTRY_BYTES,
  MAX_UNCOMPRESSED_BYTES,
} from './constants.js'
import { diagnostic, DiagnosticError } from './diagnostics.js'
import { atomicWriteFile, assertRegularFile, fileSize } from './files.js'
import {
  assertUniquePackagePaths,
  validatePackagePath,
} from './path-rules.js'

export interface PackageFile {
  readonly path: string
  readonly bytes: Uint8Array
}

export interface PackageArchive {
  readonly files: ReadonlyMap<string, Buffer>
  readonly sha256: string
  readonly size: number
}

function archiveError(code: string, message: string, path?: string): DiagnosticError {
  return new DiagnosticError(diagnostic({ code, message, path }))
}

const CRC32_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let current = value
  for (let bit = 0; bit < 8; bit += 1) {
    current = (current & 1) === 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1
  }
  return current >>> 0
})

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff
  for (const byte of bytes) {
    value = (CRC32_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8)
  }
  return (value ^ 0xffffffff) >>> 0
}

function extractedEntryCount(
  entries: readonly { readonly path: string; readonly directory?: boolean }[],
): number {
  const extracted = new Set<string>()
  for (const entry of entries) {
    extracted.add(entry.path)
    const segments = entry.path.split('/')
    for (let index = 1; index < segments.length; index += 1) {
      extracted.add(segments.slice(0, index).join('/'))
    }
  }
  return extracted.size
}

async function openZip(bytes: Buffer, path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, {
      autoClose: true,
      decodeStrings: true,
      lazyEntries: true,
      strictFileNames: true,
      validateEntrySizes: true,
    }, (error, zipFile) => {
      if (error || !zipFile) {
        reject(archiveError(
          'archive.invalid',
          error?.message ?? 'The ZIP archive could not be opened',
          path,
        ))
        return
      }
      resolve(zipFile)
    })
  })
}

function openEntryStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(archiveError(
          'archive.entry_unreadable',
          error?.message ?? 'The ZIP entry could not be read',
          entry.fileName,
        ))
        return
      }
      resolve(stream)
    })
  })
}

async function readStreamLimited(stream: Readable, maximum: number, path: string): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const value of stream) {
    const chunk = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value)
    total += chunk.length
    if (total > maximum) {
      stream.destroy()
      throw archiveError(
        'archive.entry_too_large',
        `Archive entry exceeds ${maximum} bytes`,
        path,
      )
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, total)
}

function assertSafeZipMetadata(entry: yauzl.Entry): boolean {
  if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
    throw archiveError(
      'archive.encrypted',
      'Encrypted ZIP entries are not supported',
      entry.fileName,
    )
  }
  const directory = entry.fileName.endsWith('/')
  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw archiveError(
      'archive.compression',
      'Only stored and deflate ZIP entries are supported',
      entry.fileName,
    )
  }
  if (entry.uncompressedSize > MAX_ENTRY_BYTES) {
    throw archiveError(
      'archive.entry_too_large',
      `Archive entry exceeds ${MAX_ENTRY_BYTES} bytes`,
      entry.fileName,
    )
  }
  if (
    entry.uncompressedSize > 0
    && (entry.compressedSize === 0
      || (entry.uncompressedSize > 1024 * 1024
        && entry.uncompressedSize / entry.compressedSize > MAX_COMPRESSION_RATIO))
  ) {
    throw archiveError(
      'archive.compression_ratio',
      `Archive entry exceeds the ${MAX_COMPRESSION_RATIO}:1 compression-ratio limit`,
      entry.fileName,
    )
  }

  const hostSystem = (entry.versionMadeBy >>> 8) & 0xff
  if (hostSystem === 3) {
    const mode = (entry.externalFileAttributes >>> 16) & 0xffff
    const fileType = mode & 0o170000
    if (
      (fileType !== 0 && fileType !== 0o040000 && fileType !== 0o100000)
      || (directory && fileType === 0o100000)
      || (!directory && fileType === 0o040000)
    ) {
      throw archiveError(
        'archive.special_file',
        'Symbolic links and special files are not allowed',
        entry.fileName,
      )
    }
    if (!directory && (mode & 0o111) !== 0) {
      throw archiveError(
        'archive.executable',
        'Executable file modes are not allowed',
        entry.fileName,
      )
    }
  } else if (hostSystem === 0 && entry.externalFileAttributes !== 0) {
    const attributesDescribeDirectory = (entry.externalFileAttributes & 0x10) !== 0
    if (attributesDescribeDirectory !== directory) {
      throw archiveError(
        'archive.file-type-mismatch',
        'DOS ZIP attributes disagree with the entry path type',
        entry.fileName,
      )
    }
  }
  if (directory && entry.uncompressedSize !== 0) {
    throw archiveError(
      'archive.directory_payload',
      'ZIP directory entries must not contain payload bytes',
      entry.fileName,
    )
  }
  return directory
}

export async function readPackageArchive(path: string): Promise<PackageArchive> {
  await assertRegularFile(path, 'Plugin archive')
  const size = await fileSize(path)
  if (size > MAX_ARCHIVE_BYTES) {
    throw archiveError(
      'archive.too_large',
      `Plugin archive exceeds ${MAX_ARCHIVE_BYTES} bytes`,
      path,
    )
  }

  const archiveBytes = await readFile(path)
  if (archiveBytes.byteLength > MAX_ARCHIVE_BYTES) {
    throw archiveError(
      'archive.too_large',
      `Plugin archive exceeds ${MAX_ARCHIVE_BYTES} bytes`,
      path,
    )
  }
  const sha256 = createHash('sha256').update(archiveBytes).digest('hex')
  const zipFile = await openZip(archiveBytes, path)
  if (zipFile.entryCount > MAX_ARCHIVE_ENTRIES) {
    zipFile.close()
    throw archiveError(
      'archive.too_many_entries',
      `Plugin archive contains more than ${MAX_ARCHIVE_ENTRIES} entries`,
      path,
    )
  }

  const files = new Map<string, Buffer>()
  const paths: Array<{ readonly path: string; readonly directory?: boolean }> = []
  let totalUncompressed = 0

  await new Promise<void>((resolve, reject) => {
    let settled = false
    const failArchive = (error: unknown): void => {
      if (settled) return
      settled = true
      zipFile.close()
      reject(error)
    }
    zipFile.once('error', (error) => {
      failArchive(archiveError('archive.invalid', error.message, path))
    })
    zipFile.on('entry', (entry) => {
      void (async () => {
        const directory = assertSafeZipMetadata(entry)
        const safePath = validatePackagePath(entry.fileName, {
          directory,
          label: 'ZIP entry path',
        })
        totalUncompressed += entry.uncompressedSize
        if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
          throw archiveError(
            'archive.uncompressed_too_large',
            `Expanded plugin archive exceeds ${MAX_UNCOMPRESSED_BYTES} bytes`,
            path,
          )
        }
        paths.push({ path: safePath, directory })
        assertUniquePackagePaths(paths)
        if (directory) {
          zipFile.readEntry()
          return
        }
        const stream = await openEntryStream(zipFile, entry)
        const bytes = await readStreamLimited(stream, MAX_ENTRY_BYTES, safePath)
        if (bytes.length !== entry.uncompressedSize) {
          throw archiveError(
            'archive.size_mismatch',
            'ZIP entry size does not match its central-directory metadata',
            safePath,
          )
        }
        if (crc32(bytes) !== (entry.crc32 >>> 0)) {
          throw archiveError(
            'archive.crc-mismatch',
            'ZIP entry content does not match its CRC32 metadata',
            safePath,
          )
        }
        files.set(safePath, bytes)
        zipFile.readEntry()
      })().catch(failArchive)
    })
    zipFile.once('end', () => {
      if (settled) return
      settled = true
      resolve()
    })
    zipFile.readEntry()
  })

  if (extractedEntryCount(paths) > MAX_ARCHIVE_ENTRIES) {
    throw archiveError(
      'archive.too_many_extracted_entries',
      `Extracted plugin archive would exceed ${MAX_ARCHIVE_ENTRIES} entries`,
      path,
    )
  }

  return Object.freeze({ files, sha256, size: archiveBytes.byteLength })
}

async function outputStreamToBuffer(stream: Readable, maximum: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const value of stream) {
    const chunk = typeof value === 'string' ? Buffer.from(value) : Buffer.from(value)
    size += chunk.length
    if (size > maximum) {
      stream.destroy()
      throw archiveError(
        'archive.too_large',
        `Generated plugin archive exceeds ${maximum} bytes`,
      )
    }
    chunks.push(chunk)
  }
  return Buffer.concat(chunks, size)
}

export async function writePackageArchive(
  input: Iterable<PackageFile>,
  outputPath: string,
  options: { readonly force?: boolean } = {},
): Promise<{ readonly path: string; readonly sha256: string; readonly size: number }> {
  const files = [...input].map((file) => ({
    path: validatePackagePath(file.path),
    bytes: Buffer.from(file.bytes),
  }))
  if (files.length === 0) {
    throw archiveError('archive.empty', 'A plugin archive cannot be empty')
  }
  if (files.length > MAX_ARCHIVE_ENTRIES) {
    throw archiveError(
      'archive.too_many_entries',
      `A plugin archive cannot contain more than ${MAX_ARCHIVE_ENTRIES} entries`,
    )
  }
  assertUniquePackagePaths(files.map((file) => ({ path: file.path })))
  if (extractedEntryCount(files.map((file) => ({ path: file.path }))) > MAX_ARCHIVE_ENTRIES) {
    throw archiveError(
      'archive.too_many_extracted_entries',
      `A plugin archive cannot expand to more than ${MAX_ARCHIVE_ENTRIES} entries`,
    )
  }
  let expandedSize = 0
  for (const file of files) {
    if (file.bytes.length > MAX_ENTRY_BYTES) {
      throw archiveError(
        'archive.entry_too_large',
        `Package file exceeds ${MAX_ENTRY_BYTES} bytes`,
        file.path,
      )
    }
    expandedSize += file.bytes.length
  }
  if (expandedSize > MAX_UNCOMPRESSED_BYTES) {
    throw archiveError(
      'archive.uncompressed_too_large',
      `Package payload exceeds ${MAX_UNCOMPRESSED_BYTES} bytes`,
    )
  }

  files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
  const zip = new yazl.ZipFile()
  const timestamp = new Date('1980-01-01T00:00:00.000Z')
  for (const file of files) {
    const compressed = file.bytes.length <= 1024 * 1024
      ? true
      : file.bytes.length <= deflateRawSync(file.bytes, { level: 9 }).byteLength * MAX_COMPRESSION_RATIO
    zip.addBuffer(file.bytes, file.path, {
      compress: compressed,
      compressionLevel: 9,
      forceZip64Format: false,
      mode: 0o100644,
      mtime: timestamp,
    })
  }
  zip.end()
  const bytes = await outputStreamToBuffer(zip.outputStream as Readable, MAX_ARCHIVE_BYTES)
  await atomicWriteFile(outputPath, bytes, { force: options.force, mode: 0o644 })
  return Object.freeze({
    path: outputPath,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: bytes.length,
  })
}
