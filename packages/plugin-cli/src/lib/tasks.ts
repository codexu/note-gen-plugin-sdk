import { basename, join, resolve } from 'node:path'
import { lstat, readFile } from 'node:fs/promises'
import type { PluginManifestV1 } from '@notegen/plugin-api'
import {
  PACKAGE_EXTENSION,
  RELEASE_OUTPUT_DIRECTORY,
  UNSIGNED_PACKAGE_EXTENSION,
} from './constants.js'
import { readPackageArchive, writePackageArchive } from './archive.js'
import { diagnostic, DiagnosticError, fail } from './diagnostics.js'
import { atomicWriteFiles, assertRegularFile, pathExists } from './files.js'
import {
  readCompletePackageDirectory,
  readPackageDirectory,
  validatePackageFiles,
} from './package.js'
import {
  buildPluginProject,
  validatePluginProjectSource,
  type BuildPluginProjectOptions,
} from './project.js'
import {
  generatePublisherKeyPair,
  publisherKeyId,
  publisherPublicKeyFromPrivate,
  signPackage,
} from './signing.js'
import { isJsonObject, parseStrictJson } from './strict-json.js'

export interface ValidateTargetOptions {
  readonly target?: string
  readonly apiVersion?: string
  readonly appVersion?: string
  readonly publicKeyPath?: string
  readonly requireSignature?: boolean
  /** Treat a directory as a complete package and reject every undeclared entry. */
  readonly completeDirectory?: boolean
}

export interface ValidationResult {
  readonly kind: 'project' | 'directory' | 'archive'
  readonly target: string
  readonly manifest: PluginManifestV1
  readonly signed: boolean
  readonly signatureVerified: boolean
  readonly appCompatibilityChecked: boolean
  readonly appCompatibilityNote: string
  readonly archiveSha256?: string
  readonly archiveSize?: number
}

export interface PackPluginOptions extends BuildPluginProjectOptions {
  readonly output?: string
  readonly force?: boolean
}

export interface PackPluginResult {
  readonly path: string
  readonly pluginId: string
  readonly version: string
  readonly sha256: string
  readonly size: number
  readonly developmentDirectory: string
}

export interface GenerateKeysOptions {
  readonly directory?: string
  readonly privateKeyPath?: string
  readonly publicKeyPath?: string
  readonly passphrase?: string | Uint8Array
  readonly force?: boolean
}

export interface GeneratedKeysResult {
  readonly privateKeyPath: string
  readonly publicKeyPath: string
  readonly keyId: string
  readonly publicKey: string
}

export interface SignPluginOptions {
  readonly archive: string
  readonly privateKeyPath: string
  readonly output?: string
  readonly passphrase?: string | Uint8Array
  readonly force?: boolean
  readonly apiVersion?: string
  readonly appVersion?: string
}

export interface SignPluginResult {
  readonly path: string
  readonly pluginId: string
  readonly version: string
  readonly keyId: string
  readonly publicKey: string
  readonly sha256: string
  readonly size: number
}

interface PublisherPublicKeyFile {
  readonly algorithm: 'Ed25519'
  readonly keyId: string
  readonly publicKey: string
}

function publicKeyDocument(keyId: string, publicKey: string): PublisherPublicKeyFile {
  return Object.freeze({ algorithm: 'Ed25519', keyId, publicKey })
}

async function directoryEntryExists(path: string, label: string): Promise<boolean> {
  try {
    await lstat(path)
    return true
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause.code === 'ENOENT') return false
    throw new DiagnosticError(diagnostic({
      code: 'target.inspection-failed',
      message: `Unable to inspect ${label}`,
      path,
    }))
  }
}

export async function readPublisherPublicKey(path: string): Promise<string> {
  const target = resolve(path)
  await assertRegularFile(target, 'Publisher public key')
  const bytes = await readFile(target)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim()
  } catch {
    fail('key.invalid-encoding', 'Publisher public key file must be UTF-8', target)
  }
  if (text.startsWith('{')) {
    const value = parseStrictJson(text, 'publisher public key')
    if (!isJsonObject(value)) fail('key.invalid-public-document', 'Publisher public key must be an object', target)
    const unknown = Object.keys(value).find((key) => !['algorithm', 'keyId', 'publicKey'].includes(key))
    if (unknown !== undefined) {
      fail('key.unknown-field', `Publisher public key contains unknown field ${unknown}`, target)
    }
    if (value.algorithm !== 'Ed25519' || typeof value.keyId !== 'string' || typeof value.publicKey !== 'string') {
      fail('key.invalid-public-document', 'Publisher public key document is incomplete or unsupported', target)
    }
    if (publisherKeyId(value.publicKey) !== value.keyId) {
      fail('key.id-mismatch', 'Publisher public-key keyId does not match its key material', target)
    }
    return value.publicKey
  }
  return text
}

export async function validatePluginTarget(
  options: ValidateTargetOptions = {},
): Promise<ValidationResult> {
  const target = resolve(options.target ?? process.cwd())
  let metadata
  try {
    metadata = await lstat(target)
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause.code !== 'ENOENT') {
      throw new DiagnosticError(diagnostic({
        code: 'target.inspection-failed',
        message: 'Unable to inspect the validation target',
        path: target,
      }))
    }
    throw new DiagnosticError(diagnostic({
      code: 'target.missing',
      message: 'Validation target does not exist',
      path: target,
    }))
  }
  if (metadata.isSymbolicLink()) {
    fail('target.symlink', 'Validation target cannot be a symbolic link', target)
  }
  const publicKey = options.publicKeyPath === undefined
    ? undefined
    : await readPublisherPublicKey(options.publicKeyPath)
  const appCompatibilityChecked = options.appVersion !== undefined
  const appCompatibilityNote = appCompatibilityChecked
    ? `Compatibility checked against NoteGen ${options.appVersion}.`
    : 'NoteGen app compatibility was not checked; pass --app-version to check minAppVersion.'

  if (metadata.isDirectory()) {
    if (!await directoryEntryExists(join(target, 'integrity.json'), 'integrity.json')) {
      const project = await validatePluginProjectSource({
        directory: target,
        ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
        ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      })
      if (publicKey !== undefined || options.requireSignature) {
        fail(
          'signature.not-applicable',
          'A source project has no package signature; build it before verifying a signature',
          target,
        )
      }
      return Object.freeze({
        kind: 'project',
        target,
        manifest: project.manifest,
        signed: false,
        signatureVerified: false,
        appCompatibilityChecked,
        appCompatibilityNote,
      })
    }
    const files = options.completeDirectory
      ? await readCompletePackageDirectory(target)
      : await readPackageDirectory(target)
    const validated = validatePackageFiles(files, {
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      ...(publicKey === undefined ? {} : { publicKey }),
      ...(options.requireSignature === undefined ? {} : { requireSignature: options.requireSignature }),
    })
    return Object.freeze({
      kind: 'directory',
      target,
      manifest: validated.manifest,
      signed: validated.signature !== undefined,
      signatureVerified: validated.signatureVerified,
      appCompatibilityChecked,
      appCompatibilityNote,
    })
  }
  if (!metadata.isFile()) fail('target.invalid-type', 'Validation target must be a file or directory', target)
  if (!basename(target).endsWith(PACKAGE_EXTENSION)) {
    fail('target.invalid-extension', `Plugin archives must end with ${PACKAGE_EXTENSION}`, target)
  }
  const archive = await readPackageArchive(target)
  const finalPackage = !target.endsWith(UNSIGNED_PACKAGE_EXTENSION)
  const validated = validatePackageFiles(archive.files, {
    ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
    ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
    ...(publicKey === undefined ? {} : { publicKey }),
    requireSignature: finalPackage || options.requireSignature === true,
  })
  if (!finalPackage && validated.signature !== undefined) {
    fail(
      'signature.unexpected',
      `An archive ending with ${UNSIGNED_PACKAGE_EXTENSION} must not contain signature.sig`,
      target,
    )
  }
  return Object.freeze({
    kind: 'archive',
    target,
    manifest: validated.manifest,
    signed: validated.signature !== undefined,
    signatureVerified: validated.signatureVerified,
    appCompatibilityChecked,
    appCompatibilityNote,
    archiveSha256: archive.sha256,
    archiveSize: archive.size,
  })
}

export async function packPluginProject(options: PackPluginOptions = {}): Promise<PackPluginResult> {
  const built = await buildPluginProject(options)
  const output = resolve(options.output ?? join(
    built.projectDirectory,
    RELEASE_OUTPUT_DIRECTORY,
    `${built.manifest.id}-${built.manifest.version}${UNSIGNED_PACKAGE_EXTENSION}`,
  ))
  if (!output.endsWith(UNSIGNED_PACKAGE_EXTENSION)) {
    fail(
      'pack.unsigned-extension',
      `Unsigned packages must end with ${UNSIGNED_PACKAGE_EXTENSION}`,
      output,
    )
  }
  const archive = await writePackageArchive(
    [...built.package.files].map(([path, bytes]) => ({ path, bytes })),
    output,
    { force: options.force },
  )
  return Object.freeze({
    ...archive,
    pluginId: built.manifest.id,
    version: built.manifest.version,
    developmentDirectory: built.outputDirectory,
  })
}

export async function generatePublisherKeys(
  options: GenerateKeysOptions = {},
): Promise<GeneratedKeysResult> {
  const directory = resolve(options.directory ?? join(process.cwd(), '.notegen/keys'))
  const privateKeyPath = resolve(options.privateKeyPath ?? join(directory, 'publisher-private.pem'))
  const publicKeyPath = resolve(options.publicKeyPath ?? join(directory, 'publisher-public.json'))
  if (privateKeyPath === publicKeyPath) fail('key.same-output', 'Private and public key paths must differ', privateKeyPath)
  if (!options.force) {
    for (const path of [privateKeyPath, publicKeyPath]) {
      if (await pathExists(path)) {
        fail(
          'key.output-exists',
          'Refusing to overwrite an existing publisher key',
          path,
          'Use a new location, or pass --force only after backing up the existing key.',
        )
      }
    }
  }
  const generated = generatePublisherKeyPair(options.passphrase)
  await atomicWriteFiles([
    {
      path: privateKeyPath,
      contents: generated.privateKeyPem,
      mode: 0o600,
    },
    {
      path: publicKeyPath,
      contents: `${JSON.stringify(publicKeyDocument(generated.keyId, generated.publicKey), null, 2)}\n`,
      mode: 0o644,
    },
  ], { force: options.force })
  return Object.freeze({
    privateKeyPath,
    publicKeyPath,
    keyId: generated.keyId,
    publicKey: generated.publicKey,
  })
}

export async function signPluginArchive(options: SignPluginOptions): Promise<SignPluginResult> {
  const input = resolve(options.archive)
  if (!input.endsWith(UNSIGNED_PACKAGE_EXTENSION)) {
    fail(
      'sign.unsigned-extension',
      `Signer input must end with ${UNSIGNED_PACKAGE_EXTENSION}`,
      input,
      'Run notegen-plugin pack first; the signer never compiles source code.',
    )
  }
  const archive = await readPackageArchive(input)
  if (archive.files.has('signature.sig')) {
    fail('sign.already-signed', 'Unsigned package already contains signature.sig', input)
  }
  const compatibility = {
    ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
    ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
  }
  const validated = validatePackageFiles(archive.files, compatibility)
  const privateKeyPath = resolve(options.privateKeyPath)
  await assertRegularFile(privateKeyPath, 'Publisher private key')
  const privateKey = await readFile(privateKeyPath)
  const signature = signPackage(
    validated.manifestValue,
    validated.integrityValue,
    privateKey,
    options.passphrase === undefined ? {} : { passphrase: options.passphrase },
  )
  const publicKey = publisherPublicKeyFromPrivate(
    privateKey,
    options.passphrase === undefined ? {} : { passphrase: options.passphrase },
  )
  const files = new Map(archive.files)
  files.set('signature.sig', Buffer.from(`${signature}\n`, 'utf8'))
  validatePackageFiles(files, { ...compatibility, publicKey, requireSignature: true })

  const defaultOutput = input.slice(0, -UNSIGNED_PACKAGE_EXTENSION.length) + PACKAGE_EXTENSION
  const output = resolve(options.output ?? defaultOutput)
  if (!output.endsWith(PACKAGE_EXTENSION) || output.endsWith(UNSIGNED_PACKAGE_EXTENSION)) {
    fail('sign.output-extension', `Signed package output must end with ${PACKAGE_EXTENSION}`, output)
  }
  if (output === input) fail('sign.same-output', 'Signer output must not overwrite its unsigned input', output)
  const written = await writePackageArchive(
    [...files].map(([path, bytes]) => ({ path, bytes })),
    output,
    { force: options.force },
  )
  return Object.freeze({
    ...written,
    pluginId: validated.manifest.id,
    version: validated.manifest.version,
    keyId: publisherKeyId(publicKey),
    publicKey,
  })
}
