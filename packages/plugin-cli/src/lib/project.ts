import { pluginResourcePaths } from '@notegen/plugin-api'
import { readFile, readdir, stat } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { build as esbuild } from 'esbuild'
import { init, parse } from 'es-module-lexer'
import type { PluginManifestV1 } from '@notegen/plugin-api'
import { DEVELOPMENT_OUTPUT_DIRECTORY } from './constants.js'
import { diagnostic, DiagnosticError, fail } from './diagnostics.js'
import {
  assertDirectory,
  assertInside,
  assertNoSymlinkComponents,
  assertRegularFile,
  replaceDirectoryAtomically,
  writeFileExclusive,
} from './files.js'
import {
  createIntegrityManifest,
  serializeIntegrityManifest,
} from './integrity.js'
import { parsePluginManifest } from './manifest.js'
import { validatePackageFiles, type ValidatedPluginPackage } from './package.js'
import { validatePackagePath } from './path-rules.js'
import { isJsonObject, parseStrictJson } from './strict-json.js'

interface NoteGenProjectConfig {
  readonly source: string
}

export interface BuildPluginProjectOptions {
  readonly directory?: string
  readonly apiVersion?: string
  readonly appVersion?: string
}

export interface BuiltPluginProject {
  readonly projectDirectory: string
  readonly outputDirectory: string
  readonly sourcePath: string
  readonly manifest: PluginManifestV1
  readonly package: ValidatedPluginPackage
}

export interface ValidatedPluginProjectSource {
  readonly projectDirectory: string
  readonly sourcePath: string
  readonly manifest: PluginManifestV1
}

async function readProjectConfiguration(projectDirectory: string): Promise<NoteGenProjectConfig> {
  const packageJsonPath = join(projectDirectory, 'package.json')
  let value: unknown
  try {
    value = parseStrictJson(await readFile(packageJsonPath), 'package.json')
  } catch (error) {
    const cause = error as NodeJS.ErrnoException
    if (cause.code === 'ENOENT') return { source: 'src/main.ts' }
    throw error
  }
  if (!isJsonObject(value)) fail('project.invalid-package-json', 'package.json must be an object', packageJsonPath)
  const notegen = value.notegen
  if (notegen === undefined) return { source: 'src/main.ts' }
  if (!isJsonObject(notegen)) {
    fail('project.invalid-config', 'package.json notegen must be an object', 'package.json#notegen')
  }
  const unknown = Object.keys(notegen).find((key) => key !== 'source')
  if (unknown !== undefined) {
    fail('project.unknown-config', `Unknown NoteGen project option ${unknown}`, `package.json#notegen.${unknown}`)
  }
  if (typeof notegen.source !== 'string') {
    fail('project.invalid-source', 'package.json notegen.source must be a string', 'package.json#notegen.source')
  }
  return {
    source: validatePackagePath(notegen.source, { label: 'package.json#notegen.source' }),
  }
}

async function readProjectPayloadFile(projectDirectory: string, packagePath: string): Promise<Buffer> {
  const path = resolve(projectDirectory, ...packagePath.split('/'))
  assertInside(projectDirectory, path, 'Project payload')
  await assertNoSymlinkComponents(projectDirectory, path, 'Project payload')
  await assertRegularFile(path, `Plugin payload ${packagePath}`)
  return readFile(path)
}

async function collectUsageFiles(projectDirectory: string, files: Map<string, Buffer>): Promise<void> {
  const names = (await readdir(projectDirectory)).filter(name => /^USAGE(?:\.[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*)?\.md$/.test(name))
  if (names.length > 50) fail('project.usage-limit', 'At most 50 usage translations are allowed')
  for (const name of names) {
    const path = join(projectDirectory, name)
    await assertNoSymlinkComponents(projectDirectory, path, 'Usage guide')
    if ((await stat(path)).size > 131_072) fail('project.usage-limit', 'Usage guide exceeds 128 KiB', name)
    const bytes = await readProjectPayloadFile(projectDirectory, name)
    if (bytes.length > 131_072) fail('project.usage-limit', 'Usage guide exceeds 128 KiB', name)
    try { new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
    catch { fail('project.invalid-usage', 'Usage guide must be UTF-8 Markdown', name) }
    files.set(name, bytes)
  }
}

function assertSelfContainedModule(source: string): void {
  const parsed = parse(source)
  const imports = parsed[0]
  const exports = parsed[1]
  if (imports.some((item) => item.type !== 'import-meta')) {
    fail(
      'build.residual-import',
      'Bundled entry still contains a static or dynamic module import',
      'dist/main.js',
      'Bundle every dependency into the entry; NoteGen does not resolve plugin imports at runtime.',
    )
  }
  const names = new Set(exports.flatMap((item) => 'name' in item ? [item.name] : []))
  if (!names.has('activate')) {
    fail(
      'build.missing-activate',
      'Plugin entry must export a named activate function',
      'dist/main.js',
    )
  }
}

async function bundleEntry(sourcePath: string, entryPath: string): Promise<Buffer> {
  let result
  try {
    result = await esbuild({
      entryPoints: [sourcePath],
      bundle: true,
      write: false,
      format: 'esm',
      platform: 'neutral',
      target: ['es2022'],
      charset: 'utf8',
      legalComments: 'none',
      sourcemap: false,
      treeShaking: true,
      splitting: false,
      mainFields: ['module', 'main'],
      conditions: ['import', 'module', 'default'],
      outfile: entryPath,
      logLevel: 'silent',
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'esbuild failed'
    throw new DiagnosticError(diagnostic({
      code: 'build.failed',
      message,
      path: sourcePath,
    }))
  }
  const javascript = result.outputFiles.filter((file) => file.path.endsWith('.js'))
  if (result.outputFiles.length !== 1 || javascript.length !== 1) {
    fail(
      'build.multiple-outputs',
      'Plugin build must produce exactly one JavaScript file',
      sourcePath,
      'Inline imported assets or remove loaders that create additional files.',
    )
  }
  const bytes = Buffer.from(javascript[0]?.contents ?? new Uint8Array())
  if (bytes.byteLength === 0) fail('build.empty-entry', 'Plugin entry build is empty', sourcePath)
  if (bytes.byteLength > 5 * 1_048_576) {
    fail('build.entry-too-large', 'Plugin entry exceeds the 5 MiB limit', sourcePath)
  }
  await init()
  const decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  assertSelfContainedModule(decoded)
  return bytes
}

export async function buildPluginProject(
  options: BuildPluginProjectOptions = {},
): Promise<BuiltPluginProject> {
  const projectDirectory = resolve(options.directory ?? process.cwd())
  await assertDirectory(projectDirectory, 'Plugin project')
  const manifestBytes = await readProjectPayloadFile(projectDirectory, 'plugin.json')
  const manifest = parsePluginManifest(manifestBytes, {
    ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
    ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
  })
  const configuration = await readProjectConfiguration(projectDirectory)
  const sourcePath = resolve(projectDirectory, ...configuration.source.split('/'))
  assertInside(projectDirectory, sourcePath, 'Plugin source')
  await assertNoSymlinkComponents(projectDirectory, sourcePath, 'Plugin source')
  if (manifest.entry) await assertRegularFile(sourcePath, 'Plugin source entry')

  const files = new Map<string, Buffer>([['plugin.json', manifestBytes]])
  if (manifest.entry) {
    const entry = validatePackagePath(manifest.entry, { label: '$.entry' })
    files.set(entry, await bundleEntry(sourcePath, entry))
  }
  for (const path of pluginResourcePaths(manifest.resources)) files.set(path, await readProjectPayloadFile(projectDirectory, path))
  for (const localePath of Object.values(manifest.locales ?? {})) {
    if (!files.has(localePath)) {
      files.set(localePath, await readProjectPayloadFile(projectDirectory, localePath))
    }
  }
  await collectUsageFiles(projectDirectory, files)
  const integrity = createIntegrityManifest(files)
  files.set('integrity.json', Buffer.from(serializeIntegrityManifest(integrity), 'utf8'))
  const validated = validatePackageFiles(files, {
    ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
    ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
  })

  const outputDirectory = join(projectDirectory, DEVELOPMENT_OUTPUT_DIRECTORY)
  assertInside(projectDirectory, outputDirectory, 'Development output')
  await assertNoSymlinkComponents(projectDirectory, outputDirectory, 'Development output')
  await replaceDirectoryAtomically(outputDirectory, async (temporary) => {
    for (const [path, bytes] of files) {
      await writeFileExclusive(join(temporary, ...path.split('/')), bytes, 0o644)
    }
  })

  return Object.freeze({
    projectDirectory,
    outputDirectory,
    sourcePath,
    manifest,
    package: validated,
  })
}

export async function validatePluginProjectSource(
  options: BuildPluginProjectOptions = {},
): Promise<ValidatedPluginProjectSource> {
  const projectDirectory = resolve(options.directory ?? process.cwd())
  await assertDirectory(projectDirectory, 'Plugin project')
  const manifestBytes = await readProjectPayloadFile(projectDirectory, 'plugin.json')
  const manifest = parsePluginManifest(manifestBytes, {
    ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
    ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
  })
  const configuration = await readProjectConfiguration(projectDirectory)
  const sourcePath = resolve(projectDirectory, ...configuration.source.split('/'))
  assertInside(projectDirectory, sourcePath, 'Plugin source')
  await assertNoSymlinkComponents(projectDirectory, sourcePath, 'Plugin source')
  if (manifest.entry) await assertRegularFile(sourcePath, 'Plugin source entry')
  // Source preflight cannot require the configured built entry yet. Supply a
  // harmless placeholder for that one package file so the authoritative
  // manifest validator can still parse locale payloads and verify that the
  // default locale covers every contribution reference.
  const sourceValidationFiles = new Map<string, Buffer>([
    ...(manifest.entry ? [[manifest.entry, Buffer.from('// source-project preflight placeholder\n', 'utf8')] as [string, Buffer]] : []),
  ])
  for (const localePath of Object.values(manifest.locales ?? {})) {
    sourceValidationFiles.set(
      localePath,
      await readProjectPayloadFile(projectDirectory, localePath),
    )
  }
  for (const path of pluginResourcePaths(manifest.resources)) sourceValidationFiles.set(path, await readProjectPayloadFile(projectDirectory, path))
  await collectUsageFiles(projectDirectory, sourceValidationFiles)
  const validatedManifest = parsePluginManifest(manifestBytes, {
    files: sourceValidationFiles,
    ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
    ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
  })
  return Object.freeze({
    projectDirectory,
    sourcePath,
    manifest: validatedManifest,
  })
}
