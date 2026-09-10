import { spawn } from 'node:child_process'
import { lstat, mkdir, readdir, rm, rmdir } from 'node:fs/promises'
import { basename, join, resolve } from 'node:path'
import { diagnostic, DiagnosticError } from './diagnostics.js'
import { pathExists, writeFileExclusive } from './files.js'
import { parsePluginManifest } from './manifest.js'

export type PluginTemplate = 'command' | 'editor-statistics'
export type PackageManager = 'pnpm' | 'npm'

export interface CreatePluginProjectOptions {
  readonly directory: string
  readonly id: string
  readonly name: string
  readonly description?: string
  readonly template?: PluginTemplate
  readonly minAppVersion?: string
  readonly apiVersion?: string
  readonly packageManager?: PackageManager
  readonly install?: boolean
  /** Receives package-manager stdout and stderr; defaults to inherited stdio. */
  readonly installOutput?: Pick<NodeJS.WritableStream, 'write'>
}

export interface CreatedPluginProject {
  readonly directory: string
  readonly files: readonly string[]
  readonly packageManager: PackageManager
  readonly installed: boolean
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function projectSlug(directory: string): string {
  const normalized = basename(resolve(directory))
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return normalized || 'notegen-plugin'
}

function commandSource(id: string): string {
  const commandId = `${id}.hello`
  return `import type { PluginActivate } from '@notegen/plugin-api'\n\nexport const activate: PluginActivate = async (context) => {\n  context.commands.handle('${commandId}', async () => {\n    await context.ui.showNotice('Hello from ${id}')\n  })\n}\n`
}

function editorStatisticsSource(id: string): string {
  return `import type { ActiveEditorContext, PluginActivate } from '@notegen/plugin-api'\n\nfunction formatSize(editor: ActiveEditorContext | null): string {\n  if (!editor) return 'No active editor'\n  return editor.size.lines + ' lines · ' + editor.size.utf16Length + ' characters'\n}\n\nexport const activate: PluginActivate = async (context) => {\n  const statusId = '${id}.status'\n  const update = async () => {\n    const editor = await context.editor.getActiveEditor()\n    await context.ui.statusBar.update(statusId, {\n      visible: editor !== null,\n      text: formatSize(editor),\n      accessibleLabel: formatSize(editor),\n    })\n  }\n\n  context.editor.onDidChangeActiveEditor(update)\n  context.editor.onDidChangeContent(update)\n  await update()\n}\n`
}

function templateFiles(options: CreatePluginProjectOptions): ReadonlyMap<string, string> {
  const template = options.template ?? 'command'
  const packageManager = options.packageManager ?? 'pnpm'
  const source = template === 'editor-statistics'
    ? editorStatisticsSource(options.id)
    : commandSource(options.id)
  const commandId = `${options.id}.hello`
  const manifest = template === 'editor-statistics'
    ? {
        manifestVersion: 1,
        id: options.id,
        name: options.name,
        description: options.description ?? 'Show statistics for the active NoteGen editor.',
        version: '0.1.0',
        apiVersion: options.apiVersion ?? '^0.1.1',
        minAppVersion: options.minAppVersion ?? '0.37.0',
        platforms: ['desktop'],
        entry: 'dist/main.js',
        activationEvents: ['onEditor:markdown'],
        permissions: {
          'editor.read': {
            scope: 'active-editor',
            description: 'Read the active editor size to display live statistics.',
          },
        },
        contributes: {
          statusBar: [{ id: `${options.id}.status`, alignment: 'right' }],
        },
        license: 'MIT',
      }
    : {
        manifestVersion: 1,
        id: options.id,
        name: options.name,
        description: options.description ?? 'A NoteGen command plugin.',
        version: '0.1.0',
        apiVersion: options.apiVersion ?? '^0.1.1',
        minAppVersion: options.minAppVersion ?? '0.37.0',
        platforms: ['desktop'],
        entry: 'dist/main.js',
        activationEvents: [`onCommand:${commandId}`],
        permissions: {},
        contributes: {
          commands: [{
            id: commandId,
            title: 'Say hello',
            description: 'Show a notice from this plugin.',
          }],
        },
        license: 'MIT',
      }

  const scripts = {
    dev: 'notegen-plugin dev',
    build: 'tsc -p tsconfig.json --noEmit && notegen-plugin build',
    validate: 'tsc -p tsconfig.json --noEmit && notegen-plugin validate',
    pack: 'notegen-plugin pack',
  }

  return new Map([
    ['.gitignore', 'node_modules/\n.notegen/\n'],
    ['plugin.json', json(manifest)],
    ['package.json', json({
      name: projectSlug(options.directory),
      version: '0.1.0',
      private: true,
      type: 'module',
      scripts,
      notegen: { source: 'src/main.ts' },
      devDependencies: {
        '@notegen/plugin-api': '^0.1.1',
        '@notegen/plugin-cli': '^0.1.1',
        typescript: '^5.8.3',
      },
      packageManager: packageManager === 'pnpm' ? 'pnpm@10.20.0' : undefined,
    })],
    ['tsconfig.json', json({
      compilerOptions: {
        target: 'ES2022',
        module: 'ESNext',
        moduleResolution: 'Bundler',
        lib: ['ES2022'],
        strict: true,
        noEmit: true,
        isolatedModules: true,
        verbatimModuleSyntax: true,
        skipLibCheck: true,
      },
      include: ['src/**/*.ts'],
    })],
    ['src/main.ts', source],
  ])
}

function generatedParentDirectories(paths: Iterable<string>): readonly string[] {
  const directories = new Set<string>()
  for (const path of paths) {
    const segments = path.split('/')
    segments.pop()
    while (segments.length > 0) {
      directories.add(segments.join('/'))
      segments.pop()
    }
  }
  return [...directories].sort((left, right) => (
    right.split('/').length - left.split('/').length
  ))
}

async function runInstall(
  directory: string,
  packageManager: PackageManager,
  output?: Pick<NodeJS.WritableStream, 'write'>,
): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(packageManager, ['install'], {
      cwd: directory,
      stdio: output === undefined ? 'inherit' : ['inherit', 'pipe', 'pipe'],
      shell: process.platform === 'win32',
    })
    if (output !== undefined) {
      child.stdout?.on('data', (chunk: Buffer) => output.write(chunk))
      child.stderr?.on('data', (chunk: Buffer) => output.write(chunk))
    }
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      reject(new DiagnosticError(diagnostic({
        code: 'create.install_failed',
        message: signal
          ? `${packageManager} install was interrupted by ${signal}`
          : `${packageManager} install exited with code ${code ?? 'unknown'}`,
        path: directory,
      })))
    })
  })
}

export async function createPluginProject(
  options: CreatePluginProjectOptions,
): Promise<CreatedPluginProject> {
  if (options.template !== undefined && !['command', 'editor-statistics'].includes(options.template)) {
    throw new DiagnosticError(diagnostic({
      code: 'create.invalid-template',
      message: `Unsupported plugin template: ${options.template}`,
    }))
  }
  if (options.packageManager !== undefined && !['pnpm', 'npm'].includes(options.packageManager)) {
    throw new DiagnosticError(diagnostic({
      code: 'create.invalid-package-manager',
      message: `Unsupported package manager: ${options.packageManager}`,
    }))
  }
  const files = templateFiles(options)
  const manifestSource = files.get('plugin.json')
  if (manifestSource === undefined) {
    throw new DiagnosticError(diagnostic({
      code: 'create.template-invalid',
      message: 'Plugin template did not produce plugin.json',
    }))
  }
  parsePluginManifest(manifestSource)

  const directory = resolve(options.directory)
  const existed = await pathExists(directory)
  if (existed) {
    const metadata = await lstat(directory)
    if (!metadata.isDirectory() || metadata.isSymbolicLink()) {
      throw new DiagnosticError(diagnostic({
        code: 'create.target_invalid',
        message: 'The project target must be a real directory',
        path: directory,
      }))
    }
    const children = await readdir(directory)
    if (children.length > 0) {
      throw new DiagnosticError(diagnostic({
        code: 'create.target_not_empty',
        message: 'Refusing to create a plugin in a non-empty directory',
        path: directory,
      }))
    }
  } else {
    await mkdir(directory, { recursive: true })
  }

  const written: string[] = []
  try {
    for (const [path, contents] of files) {
      await writeFileExclusive(join(directory, path), contents)
      written.push(path)
    }
  } catch (error) {
    for (const path of written.reverse()) {
      await rm(join(directory, path), { force: true }).catch(() => undefined)
    }
    if (!existed) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    } else {
      for (const path of generatedParentDirectories(files.keys())) {
        await rmdir(join(directory, ...path.split('/'))).catch(() => undefined)
      }
    }
    throw error
  }

  const packageManager = options.packageManager ?? 'pnpm'
  if (options.install) await runInstall(directory, packageManager, options.installOutput)
  return Object.freeze({
    directory,
    files: Object.freeze([...files.keys()]),
    packageManager,
    installed: options.install === true,
  })
}
