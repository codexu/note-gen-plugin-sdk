import { PLUGIN_API_VERSION } from '@notegen/plugin-api'
import { basename } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Command, CommanderError, Option } from 'commander'
import {
  PLUGIN_CLI_VERSION,
  EXIT_PROJECT_FAILURE,
  EXIT_SUCCESS,
  EXIT_UNSAFE_REFUSAL,
  EXIT_UNEXPECTED,
  EXIT_USAGE,
} from './lib/constants.js'
import {
  diagnostic,
  diagnosticsFromError,
  fail,
  formatDiagnostic,
  isDiagnosticError,
} from './lib/diagnostics.js'
import {
  createPluginProject,
  type PackageManager,
  type PluginTemplate,
} from './lib/scaffold.js'
import { buildPluginProject } from './lib/project.js'
import { watchPluginProject } from './lib/watch.js'
import {
  generatePublisherKeys,
  packPluginProject,
  signPluginArchive,
  validatePluginTarget,
} from './lib/tasks.js'

export { PLUGIN_CLI_VERSION } from './lib/constants.js'

export interface CliIo {
  readonly stdout: Pick<NodeJS.WriteStream, 'write'>
  readonly stderr: Pick<NodeJS.WriteStream, 'write'>
}

export interface CreateCliProgramOptions {
  /** Suppress Commander's prose errors so runCli can emit one JSON document. */
  readonly jsonMode?: boolean
  /** Captures help/version prose so runCli can wrap it in JSON. */
  readonly commanderOutput?: string[]
}

interface CommonOptions {
  readonly json?: boolean
  readonly apiVersion?: string
  readonly appVersion?: string
}

interface CreateOptions {
  readonly json?: boolean
  readonly id?: string
  readonly name?: string
  readonly description?: string
  readonly template: PluginTemplate
  readonly minAppVersion: string
  readonly apiVersion: string
  readonly packageManager: PackageManager
  readonly install?: boolean
  readonly yes?: boolean
}

interface PackOptions extends CommonOptions {
  readonly output?: string
  readonly force?: boolean
}

interface ValidateOptions extends CommonOptions {
  readonly publicKey?: string
  readonly requireSignature?: boolean
}

interface KeygenOptions extends CommonOptions {
  readonly output?: string
  readonly privateKey?: string
  readonly publicKey?: string
  readonly passphraseEnv?: string
  readonly force?: boolean
}

interface SignOptions extends CommonOptions {
  readonly privateKey: string
  readonly output?: string
  readonly passphraseEnv?: string
  readonly force?: boolean
}

function writeLine(stream: Pick<NodeJS.WriteStream, 'write'>, value = ''): void {
  stream.write(`${value}\n`)
}

function printJson(io: CliIo, value: unknown): void {
  writeLine(io.stdout, JSON.stringify(value, null, 2))
}

function isUnsafeRefusal(error: unknown): boolean {
  if (!isDiagnosticError(error)) return false
  const refusalCodes = new Set([
    'create.target_invalid',
    'create.target_not_empty',
    'file.exists',
    'file.not_regular',
    'key.output-exists',
    'key.same-output',
    'output.unsafe',
    'path.outside_project',
    'path.symlink',
    'sign.same-output',
  ])
  return error.diagnostics.some((item) => refusalCodes.has(item.code))
}

function titleFromDirectory(directory: string): string {
  const name = basename(directory).replace(/[-_]+/g, ' ').trim()
  return name.length === 0
    ? 'NoteGen Plugin'
    : name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
}

async function completeCreateOptions(
  directory: string,
  options: CreateOptions,
): Promise<{ readonly id: string; readonly name: string }> {
  if (options.id && options.name) return { id: options.id, name: options.name }
  if (options.yes || options.json) {
    if (!options.id) {
      fail(
        'create.id-required',
        '--id is required when --yes or --json disables interactive prompts',
      )
    }
    return { id: options.id, name: options.name ?? titleFromDirectory(directory) }
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    fail('create.non-interactive', 'Missing --id or --name in a non-interactive terminal')
  }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const id = options.id ?? (await prompt.question('Plugin ID (for example com.example.my-plugin): ')).trim()
    const fallbackName = titleFromDirectory(directory)
    const nameInput = options.name ?? (await prompt.question(`Plugin name (${fallbackName}): `)).trim()
    return { id, name: nameInput || fallbackName }
  } finally {
    prompt.close()
  }
}

function readPassphrase(environmentVariable: string | undefined): string | undefined {
  if (environmentVariable === undefined) return undefined
  if (!/^[A-Za-z_][A-Za-z0-9_]*$(?![\s\S])/u.test(environmentVariable)) {
    fail('key.invalid-environment-variable', '--passphrase-env must name a valid environment variable')
  }
  const value = process.env[environmentVariable]
  if (!value) {
    fail(
      'key.missing-passphrase',
      `Environment variable ${environmentVariable} is empty or unavailable`,
    )
  }
  return value
}

function addCompatibilityOptions(command: Command): Command {
  return command
    .option('--api-version <version>', 'validate against a concrete NoteGen plugin API version')
    .option('--app-version <version>', 'validate against a concrete NoteGen app version')
}

function addJsonOption(command: Command): Command {
  return command.option('--json', 'write a machine-readable JSON result')
}

function hasJsonOption(argv: readonly string[]): boolean {
  const arguments_ = argv.slice(2)
  const optionTerminator = arguments_.indexOf('--')
  const options = optionTerminator === -1
    ? arguments_
    : arguments_.slice(0, optionTerminator)
  return options.includes('--json')
}

function appCompatibilityStatus(appVersion: string | undefined): {
  readonly appCompatibilityChecked: boolean
  readonly appCompatibilityNote: string
} {
  return appVersion === undefined
    ? {
        appCompatibilityChecked: false,
        appCompatibilityNote: 'NoteGen app compatibility was not checked; pass --app-version to check minAppVersion.',
      }
    : {
        appCompatibilityChecked: true,
        appCompatibilityNote: `Compatibility checked against NoteGen ${appVersion}.`,
      }
}

export function createCliProgram(
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
  options: CreateCliProgramOptions = {},
): Command {
  const program = new Command()
    .name('notegen-plugin')
    .description('Create, build, validate, package, sign, and verify NoteGen plugins.')
    .version(PLUGIN_CLI_VERSION)
    .exitOverride()
    .configureOutput({
      writeOut: (value) => {
        if (options.jsonMode) options.commanderOutput?.push(value)
        else io.stdout.write(value)
      },
      writeErr: (value) => {
        if (!options.jsonMode) io.stderr.write(value)
      },
    })

  if (!options.jsonMode) program.showHelpAfterError()

  const createCommand = addJsonOption(program.command('create <directory>')
    .description('create a new NoteGen plugin project')
    .option('--id <plugin-id>', 'reverse-domain plugin ID')
    .option('--name <name>', 'display name')
    .option('--description <description>', 'short plugin description')
    .addOption(new Option('--template <template>', 'starter template')
      .choices(['command', 'editor-statistics'])
      .default('command'))
    .option('--min-app-version <version>', 'minimum NoteGen version', '0.37.0')
    .option('--api-version <range>', 'supported plugin API range', `^${PLUGIN_API_VERSION}`)
    .addOption(new Option('--package-manager <manager>', 'generated project package manager')
      .choices(['pnpm', 'npm'])
      .default('pnpm'))
    .option('--install', 'install generated project dependencies')
    .option('--yes', 'disable prompts; --id is required'))

  createCommand.action(async (directory: string) => {
    const options = createCommand.opts<CreateOptions>()
    const identity = await completeCreateOptions(directory, options)
    const created = await createPluginProject({
      directory,
      ...identity,
      ...(options.description === undefined ? {} : { description: options.description }),
      template: options.template,
      minAppVersion: options.minAppVersion,
      apiVersion: options.apiVersion,
      packageManager: options.packageManager,
      install: options.install,
      ...(options.json ? { installOutput: io.stderr } : {}),
    })
    if (options.json) {
      printJson(io, { ok: true, command: 'create', ...created })
      return
    }
    writeLine(io.stdout, `Created NoteGen plugin project at ${created.directory}`)
    writeLine(io.stdout, created.installed
      ? `Dependencies installed with ${created.packageManager}.`
      : `Run ${created.packageManager} install before building.`)
  })

  const doctorCommand = addJsonOption(addCompatibilityOptions(program.command('doctor [path]')
    .description('diagnose manifest, resources and explicit host-version compatibility without building')))
  doctorCommand.action(async (path: string | undefined) => {
    const options = doctorCommand.opts<CommonOptions>()
    const result = await validatePluginTarget({
      ...(path === undefined ? {} : { target: path }),
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
    })
    const warnings: string[] = []
    if (!options.appVersion) warnings.push('Host app version not supplied; use --app-version to check the minimum NoteGen version.')
    if (!options.apiVersion) warnings.push('Checking against this SDK protocol, not a connected NoteGen host; pass --api-version for your installed host.')
    if (Object.keys(result.manifest.permissions).length) warnings.push('Permission declarations are valid. Actual user grants must be reviewed in NoteGen.')
    if (result.manifest.contributes.views?.some(view => ['new-tab', 'document-top', 'document-bottom', 'file-panel', 'editor-toolbar', 'chat-input', 'record-list', 'status-bar-panel'].includes(view.location))) warnings.push('Embedded views must echo getState().contextId as expectedContextId; registerView handles this automatically.')
    const report = { ok: true, command: 'doctor', pluginId: result.manifest.id, sdkVersion: PLUGIN_CLI_VERSION, apiVersion: options.apiVersion ?? PLUGIN_API_VERSION, appCompatibilityChecked: options.appVersion !== undefined, warnings }
    if (options.json) printJson(io, report)
    else {
      writeLine(io.stdout, `Valid plugin: ${report.pluginId}`)
      writeLine(io.stdout, `SDK ${report.sdkVersion}; protocol ${report.apiVersion}`)
      for (const warning of warnings) writeLine(io.stdout, warning)
    }
  })

  const validateCommand = addJsonOption(addCompatibilityOptions(program.command('validate [path]')
    .description('validate a source project, development directory, or plugin archive')
    .option('--public-key <file>', 'publisher public-key JSON or raw Base64 file')
    .option('--require-signature', 'reject unsigned packages')))
  validateCommand.action(async (path: string | undefined) => {
    const options = validateCommand.opts<ValidateOptions>()
    const result = await validatePluginTarget({
      ...(path === undefined ? {} : { target: path }),
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      ...(options.publicKey === undefined ? {} : { publicKeyPath: options.publicKey }),
      ...(options.requireSignature === undefined ? {} : { requireSignature: options.requireSignature }),
    })
    if (options.json) {
      printJson(io, { ok: true, command: 'validate', ...result })
      return
    }
    writeLine(io.stdout, `Valid ${result.kind}: ${result.manifest.id}@${result.manifest.version}`)
    writeLine(io.stdout, result.appCompatibilityNote)
    if (result.signed) {
      writeLine(io.stdout, result.signatureVerified
        ? 'Publisher signature verified.'
        : 'Signature is structurally valid; pass --public-key to verify its identity.')
    }
  })

  const devCommand = addJsonOption(addCompatibilityOptions(program.command('dev [directory]')
    .description('watch source changes and atomically replace the development package after successful builds')))
  devCommand.action(async (directory: string | undefined) => {
    const options = devCommand.opts<CommonOptions>()
    const controller = new AbortController()
    const stop = () => controller.abort()
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
    try {
      await watchPluginProject({
        ...(directory === undefined ? {} : { directory }),
        ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
        ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
        signal: controller.signal,
        onBuilt: built => {
          const result = { ok: true, command: 'dev', pluginId: built.manifest.id, outputDirectory: built.outputDirectory }
          if (options.json) printJson(io, result)
          else writeLine(io.stdout, `Built ${built.manifest.id}. Watching source changes. Import and enable auto-reload for: ${built.outputDirectory}`)
        },
        onError: error => {
          const message = error instanceof Error ? error.message : String(error)
          if (options.json) printJson(io, { ok: false, command: 'dev', message })
          else writeLine(io.stderr, `${message}\nBuild did not finish cleanly; waiting for source changes. See the diagnostic for output recovery details.`)
        },
      })
    } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
    }
  })

  const buildCommand = addJsonOption(addCompatibilityOptions(program.command('build [directory]')
    .description('bundle a plugin into an importable development directory')))
  buildCommand.action(async (directory: string | undefined) => {
    const options = buildCommand.opts<CommonOptions>()
    const built = await buildPluginProject({
      ...(directory === undefined ? {} : { directory }),
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
    })
    const result = {
      ok: true,
      command: 'build',
      pluginId: built.manifest.id,
      version: built.manifest.version,
      outputDirectory: built.outputDirectory,
      ...appCompatibilityStatus(options.appVersion),
    }
    if (options.json) printJson(io, result)
    else {
      writeLine(io.stdout, `Built ${result.pluginId}@${result.version}`)
      writeLine(io.stdout, `Development import directory: ${result.outputDirectory}`)
      writeLine(io.stdout, result.appCompatibilityNote)
    }
  })

  const packCommand = addJsonOption(addCompatibilityOptions(program.command('pack [directory]')
    .description('build and create an unsigned .notegen-plugin archive')
    .option('--output <file>', 'unsigned archive output path')
    .option('--force', 'overwrite an existing output archive')))
  packCommand.action(async (directory: string | undefined) => {
    const options = packCommand.opts<PackOptions>()
    const result = await packPluginProject({
      ...(directory === undefined ? {} : { directory }),
      ...(options.output === undefined ? {} : { output: options.output }),
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      force: options.force,
    })
    const compatibility = appCompatibilityStatus(options.appVersion)
    if (options.json) printJson(io, { ok: true, command: 'pack', ...result, ...compatibility })
    else {
      writeLine(io.stdout, `Packed unsigned ${result.pluginId}@${result.version}`)
      writeLine(io.stdout, `${result.path} (${result.sha256})`)
      writeLine(io.stdout, 'Signing is a separate step; no private key was accessed.')
      writeLine(io.stdout, compatibility.appCompatibilityNote)
    }
  })

  const keygenCommand = addJsonOption(program.command('keygen')
    .description('generate an Ed25519 publisher key pair')
    .option('--output <directory>', 'key output directory (default: .notegen/keys)')
    .option('--private-key <file>', 'private-key PEM output path')
    .option('--public-key <file>', 'public-key JSON output path')
    .option('--passphrase-env <name>', 'encrypt the private key using this environment variable')
    .option('--force', 'overwrite both existing key files'))
  keygenCommand.action(async () => {
    const options = keygenCommand.opts<KeygenOptions>()
    const passphrase = readPassphrase(options.passphraseEnv)
    const result = await generatePublisherKeys({
      ...(options.output === undefined ? {} : { directory: options.output }),
      ...(options.privateKey === undefined ? {} : { privateKeyPath: options.privateKey }),
      ...(options.publicKey === undefined ? {} : { publicKeyPath: options.publicKey }),
      ...(passphrase === undefined ? {} : { passphrase }),
      force: options.force,
    })
    if (options.json) printJson(io, { ok: true, command: 'keygen', ...result })
    else {
      writeLine(io.stdout, `Generated publisher key ${result.keyId}`)
      writeLine(io.stdout, `Private key: ${result.privateKeyPath}`)
      writeLine(io.stdout, `Public key: ${result.publicKeyPath}`)
      writeLine(io.stdout, 'The private key contents were not printed. Keep that file offline.')
    }
  })

  const signCommand = addJsonOption(addCompatibilityOptions(program.command('sign <unsigned-archive>')
    .description('sign an already-built unsigned archive without executing or compiling it')
    .requiredOption('--private-key <file>', 'publisher PKCS#8 PEM private key')
    .option('--output <file>', 'signed archive output path')
    .option('--passphrase-env <name>', 'read the private-key passphrase from this environment variable')
    .option('--force', 'overwrite an existing signed archive')))
  signCommand.action(async (archive: string) => {
    const options = signCommand.opts<SignOptions>()
    const passphrase = readPassphrase(options.passphraseEnv)
    const result = await signPluginArchive({
      archive,
      privateKeyPath: options.privateKey,
      ...(options.output === undefined ? {} : { output: options.output }),
      ...(passphrase === undefined ? {} : { passphrase }),
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      force: options.force,
    })
    const compatibility = appCompatibilityStatus(options.appVersion)
    if (options.json) printJson(io, { ok: true, command: 'sign', ...result, ...compatibility })
    else {
      writeLine(io.stdout, `Signed ${result.pluginId}@${result.version} with ${result.keyId}`)
      writeLine(io.stdout, `${result.path} (${result.sha256})`)
      writeLine(io.stdout, compatibility.appCompatibilityNote)
    }
  })

  const verifyCommand = addJsonOption(addCompatibilityOptions(program.command('verify <path>')
    .description('verify a complete package directory or archive without executing plugin code')
    .option('--public-key <file>', 'publisher public-key JSON or raw Base64 file')
    .option('--require-signature', 'reject unsigned development packages')))
  verifyCommand.action(async (path: string) => {
    const options = verifyCommand.opts<ValidateOptions>()
    const result = await validatePluginTarget({
      target: path,
      completeDirectory: true,
      ...(options.apiVersion === undefined ? {} : { apiVersion: options.apiVersion }),
      ...(options.appVersion === undefined ? {} : { appVersion: options.appVersion }),
      ...(options.publicKey === undefined ? {} : { publicKeyPath: options.publicKey }),
      ...(options.requireSignature === undefined ? {} : { requireSignature: options.requireSignature }),
    })
    if (result.kind === 'project') {
      fail('verify.incomplete-project', 'verify requires a built directory or archive; run build first', result.target)
    }
    if (options.json) printJson(io, { ok: true, command: 'verify', ...result })
    else {
      writeLine(io.stdout, `Verified ${result.manifest.id}@${result.manifest.version}`)
      writeLine(io.stdout, result.appCompatibilityNote)
      writeLine(io.stdout, result.signed
        ? result.signatureVerified
          ? 'Integrity and publisher signature are valid.'
          : 'Integrity and signature encoding are valid; publisher identity was not checked.'
        : 'Integrity is valid; this development package is unsigned.')
    }
  })

  return program
}

export async function runCli(
  argv: readonly string[] = process.argv,
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const jsonMode = hasJsonOption(argv)
  const commanderOutput: string[] = []
  const program = createCliProgram(io, { jsonMode, commanderOutput })
  try {
    await program.parseAsync([...argv], { from: 'node' })
    return EXIT_SUCCESS
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.exitCode === 0) {
        if (jsonMode) {
          printJson(io, {
            ok: true,
            command: error.code === 'commander.version' ? 'version' : 'help',
            output: commanderOutput.join('').trimEnd(),
          })
        }
        return EXIT_SUCCESS
      }
      if (jsonMode) {
        printJson(io, {
          ok: false,
          diagnostics: [diagnostic({
            code: 'cli.usage',
            message: error.message.replace(/^error:\s*/u, ''),
          })],
        })
      }
      return EXIT_USAGE
    }
    const diagnostics = diagnosticsFromError(error)
    if (jsonMode) printJson(io, { ok: false, diagnostics })
    else for (const item of diagnostics) writeLine(io.stderr, formatDiagnostic(item))
    if (isDiagnosticError(error)) {
      return isUnsafeRefusal(error) ? EXIT_UNSAFE_REFUSAL : EXIT_PROJECT_FAILURE
    }
    return EXIT_UNEXPECTED
  }
}

export async function runCreateCli(
  argv: readonly string[] = process.argv,
  io: CliIo = { stdout: process.stdout, stderr: process.stderr },
): Promise<number> {
  const forwarded = [argv[0] ?? 'node', argv[1] ?? 'create-notegen-plugin', 'create', ...argv.slice(2)]
  return runCli(forwarded, io)
}
