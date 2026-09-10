import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { PLUGIN_API_VERSION } from '../packages/plugin-api/dist/index.js'
import { runCli } from '../packages/plugin-cli/dist/index.js'

function capture() {
  let value = ''
  return {
    stream: {
      write(chunk) {
        value += String(chunk)
        return true
      },
    },
    read: () => value,
  }
}

async function invoke(arguments_) {
  const stdout = capture()
  const stderr = capture()
  const code = await runCli(
    ['node', 'notegen-plugin', ...arguments_],
    { stdout: stdout.stream, stderr: stderr.stream },
  )
  return { code, stdout: stdout.read(), stderr: stderr.read() }
}

test('CLI creates, deterministically packs, signs, verifies, and rejects tampering', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'notegen-plugin-cli-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))

  const project = join(temporary, 'fixture')
  const created = await invoke([
    'create', project,
    '--id', 'com.example.e2e',
    '--name', 'E2E fixture',
    '--yes',
    '--json',
  ])
  assert.equal(created.code, 0, created.stderr)
  const manifest = JSON.parse(await readFile(join(project, 'plugin.json'), 'utf8'))
  assert.equal(manifest.apiVersion, `^${PLUGIN_API_VERSION}`)
  const packageJson = JSON.parse(await readFile(join(project, 'package.json'), 'utf8'))
  assert.match(packageJson.scripts.build, /^tsc .*--noEmit && notegen-plugin build$/u)

  const firstArchive = join(temporary, 'first.unsigned.notegen-plugin')
  const secondArchive = join(temporary, 'second.unsigned.notegen-plugin')
  const firstPack = await invoke(['pack', project, '--output', firstArchive, '--json'])
  const secondPack = await invoke(['pack', project, '--output', secondArchive, '--json'])
  assert.equal(firstPack.code, 0, firstPack.stderr)
  assert.equal(secondPack.code, 0, secondPack.stderr)
  assert.deepEqual(await readFile(firstArchive), await readFile(secondArchive))

  const keyDirectory = join(temporary, 'keys')
  const generated = await invoke(['keygen', '--output', keyDirectory, '--json'])
  assert.equal(generated.code, 0, generated.stderr)
  const keyResult = JSON.parse(generated.stdout)

  const signedArchive = join(temporary, 'fixture.notegen-plugin')
  const signed = await invoke([
    'sign', firstArchive,
    '--private-key', keyResult.privateKeyPath,
    '--output', signedArchive,
    '--json',
  ])
  assert.equal(signed.code, 0, signed.stderr)

  const verified = await invoke([
    'verify', signedArchive,
    '--public-key', keyResult.publicKeyPath,
    '--require-signature',
    '--json',
  ])
  assert.equal(verified.code, 0, verified.stderr)
  assert.equal(JSON.parse(verified.stdout).signatureVerified, true)

  const tamperedArchive = join(temporary, 'tampered.notegen-plugin')
  const tamperedBytes = Buffer.from(await readFile(signedArchive))
  tamperedBytes[Math.floor(tamperedBytes.length / 2)] ^= 0x01
  await writeFile(tamperedArchive, tamperedBytes)
  const tampered = await invoke([
    'verify', tamperedArchive,
    '--public-key', keyResult.publicKeyPath,
    '--require-signature',
    '--json',
  ])
  assert.notEqual(tampered.code, 0)
})

test('archive writer refuses traversal paths before bytes are emitted', async () => {
  const { writePackageArchive } = await import('../packages/plugin-cli/dist/index.js')
  await assert.rejects(
    writePackageArchive(
      [{ path: '../escape', bytes: Buffer.from('unsafe') }],
      join(tmpdir(), 'never-written.unsigned.notegen-plugin'),
    ),
    error => error?.diagnostics?.some(item => item.code.startsWith('path.')),
  )
})

test('source-project validation parses locales and checks default-locale references', async (t) => {
  const temporary = await mkdtemp(join(tmpdir(), 'notegen-plugin-locales-'))
  t.after(() => rm(temporary, { recursive: true, force: true }))

  const project = join(temporary, 'fixture')
  await mkdir(join(project, 'src'), { recursive: true })
  await mkdir(join(project, 'locales'), { recursive: true })
  await writeFile(join(project, 'src/main.ts'), 'export function activate() {}\n')
  await writeFile(join(project, 'plugin.json'), `${JSON.stringify({
    manifestVersion: 1,
    id: 'com.example.locale-validation',
    name: 'Locale validation fixture',
    version: '1.0.0',
    apiVersion: '^0.1.0',
    minAppVersion: '0.37.0',
    platforms: ['desktop'],
    entry: 'dist/main.js',
    activationEvents: ['onCommand:com.example.locale-validation.open'],
    permissions: {},
    contributes: {
      commands: [{
        id: 'com.example.locale-validation.open',
        title: '%command.open%',
      }],
    },
    defaultLocale: 'en',
    locales: { en: 'locales/en.json' },
  }, null, 2)}\n`)

  const localePath = join(project, 'locales/en.json')
  await writeFile(localePath, '{ invalid json')
  const invalidJson = await invoke(['validate', project, '--json'])
  assert.equal(invalidJson.code, 1)
  assert.equal(JSON.parse(invalidJson.stdout).diagnostics[0]?.code, 'json.invalid-syntax')

  await writeFile(localePath, '{"command.open":42}\n')
  const nonStringMessage = await invoke(['validate', project, '--json'])
  assert.equal(nonStringMessage.code, 1)
  assert.equal(
    JSON.parse(nonStringMessage.stdout).diagnostics[0]?.code,
    'manifest.invalid-locale-message',
  )

  await writeFile(localePath, '{"command.close":"Close"}\n')
  const missingDefaultKey = await invoke(['validate', project, '--json'])
  assert.equal(missingDefaultKey.code, 1)
  assert.equal(
    JSON.parse(missingDefaultKey.stdout).diagnostics[0]?.code,
    'manifest.missing-translation',
  )

  await writeFile(localePath, '{"command.open":"Open"}\n')
  const valid = await invoke(['validate', project, '--json'])
  assert.equal(valid.code, 0, valid.stderr)
  assert.equal(JSON.parse(valid.stdout).kind, 'project')
})


test('CLI version follows the installed package metadata', async () => {
  const metadata = JSON.parse(await readFile(new URL('../packages/plugin-cli/package.json', import.meta.url), 'utf8'))
  const result = await invoke(['--version'])
  assert.equal(result.code, 0, result.stderr)
  assert.equal(result.stdout.trim(), metadata.version)
})
