import { validatePluginResources, pluginResourcePaths, validatePluginLanguageMessages } from '@notegen/plugin-api'
import { PLUGIN_API_VERSION, isValidPluginMenuCondition, type PluginManifestV1 } from '@notegen/plugin-api'
import { compare as compareSemver, valid as validSemver } from 'semver'

import { fail } from './diagnostics.js'
import {
  hasControlCharacter,
  packagePathCollisionKey,
  utf8ByteLength,
  validatePackagePath,
} from './path-rules.js'
import { assertJsonIntegerToken, isJsonObject, parseStrictJson } from './strict-json.js'

const PLUGIN_ID_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$(?![\s\S])/u
const PRERELEASE_IDENTIFIER = String.raw`(?:0|[1-9]\d*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)`
const SEMVER_SOURCE = String.raw`(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-${PRERELEASE_IDENTIFIER}(?:\.${PRERELEASE_IDENTIFIER})*)?`
const SEMVER_PATTERN = new RegExp(String.raw`^${SEMVER_SOURCE}(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$(?![\s\S])`, 'u')
const API_SEMVER_PATTERN = new RegExp(String.raw`^${SEMVER_SOURCE}$(?![\s\S])`, 'u')
const LOCALIZATION_PATTERN = /^%([A-Za-z0-9][A-Za-z0-9._-]*)%$(?![\s\S])/u
const NAMESPACED_ID_CHARACTERS = /^[A-Za-z0-9._-]+$(?![\s\S])/u
const ICON_PATTERN = /^[A-Za-z0-9-]+$(?![\s\S])/u
const SUPPORTED_PERMISSIONS = Object.freeze({
  'editor.read': new Set(['active-editor']),
  'editor.write': new Set(['active-editor']),
  'notes.read': new Set(['workspace-file', 'workspace-files', 'workspace-folder']),
  'attachments.read': new Set(['workspace-file', 'workspace-files', 'workspace-folder']),
  'attachments.create': new Set(['workspace-folder']),
  'notes.list': new Set(['workspace-folder']),
  'notes.create': new Set(['workspace-folder']),
  'notes.open': new Set(['workspace-folder']),
  'notes.write': new Set(['workspace-file', 'workspace-files', 'workspace-folder']),
  'notes.delete': new Set(['workspace-file', 'workspace-files', 'workspace-folder']),
  'notes.move': new Set(['workspace-folder']),
  'network.fetch': new Set(['network-origins']),
} as const)

export interface ManifestValidationOptions {
  /** Concrete host API version. Defaults to the API package's current version. */
  readonly apiVersion?: string
  /** Concrete NoteGen version. Compatibility is checked only when supplied. */
  readonly appVersion?: string
  /** Package payload, keyed by canonical relative path. Enables file and locale checks. */
  readonly files?: ReadonlyMap<string, Uint8Array>
}

interface ContributionValidation {
  readonly commandIds: ReadonlySet<string>
  readonly localizedTexts: readonly string[]
}

type ApiOperator = '' | '>=' | '<=' | '^' | '~' | '>' | '<'

function objectValue(value: unknown, path: string): Record<string, unknown> {
  if (!isJsonObject(value)) fail('manifest.expected-object', `${path} must be an object`, path)
  return value
}

function arrayValue(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) fail('manifest.expected-array', `${path} must be an array`, path)
  return value
}

function required(object: Record<string, unknown>, key: string, path: string): unknown {
  if (!Object.hasOwn(object, key)) {
    fail('manifest.missing-field', `${path}.${key} is required`, `${path}.${key}`)
  }
  return object[key]
}

function assertAllowedKeys(
  object: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const accepted = new Set(allowed)
  const unknown = Object.keys(object).find((key) => !accepted.has(key))
  if (unknown !== undefined) {
    fail('manifest.unknown-field', `${path}.${unknown} is not supported`, `${path}.${unknown}`)
  }
}

function stringValue(value: unknown, path: string): string {
  if (typeof value !== 'string') fail('manifest.expected-string', `${path} must be a string`, path)
  return value
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail('manifest.expected-boolean', `${path} must be a boolean`, path)
  return value
}

function finiteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail('manifest.expected-number', `${path} must be a finite number`, path)
  }
  return value
}

function integerValue(value: unknown, path: string): number {
  const number = finiteNumber(value, path)
  if (!Number.isSafeInteger(number)) {
    fail('manifest.expected-integer', `${path} must be a safe integer`, path)
  }
  return number
}

function validateText(value: unknown, path: string, maximumBytes: number): string {
  const text = stringValue(value, path)
  if (text.trim().length === 0 || utf8ByteLength(text) > maximumBytes || hasControlCharacter(text)) {
    fail(
      'manifest.invalid-text',
      `${path} must be non-empty, contain no control characters, and use at most ${maximumBytes} UTF-8 bytes`,
      path,
    )
  }
  return text
}

function localizationKey(text: string): string | undefined {
  const key = text.match(LOCALIZATION_PATTERN)?.[1]
  return key !== undefined && utf8ByteLength(key) <= 160 ? key : undefined
}

function validateLocalizedText(value: unknown, path: string): string {
  const text = validateText(value, path, 240)
  if (text.startsWith('%') && localizationKey(text) === undefined) {
    fail('manifest.invalid-localization', `${path} contains a malformed localization reference`, path)
  }
  return text
}

function validateSemver(value: unknown, path: string, allowBuild: boolean): string {
  const version = stringValue(value, path)
  if (
    utf8ByteLength(version) > 80
    || !(allowBuild ? SEMVER_PATTERN : API_SEMVER_PATTERN).test(version)
    || validSemver(version) === null
  ) {
    fail('manifest.invalid-semver', `${path} must be a canonical semantic version`, path)
  }
  return version
}

function parseApiRequirement(value: unknown, path: string): { operator: ApiOperator; version: string } {
  const requirement = stringValue(value, path)
  if (requirement.length === 0 || utf8ByteLength(requirement) > 80 || hasControlCharacter(requirement)) {
    fail('manifest.invalid-api-range', `${path} is not a supported API version requirement`, path)
  }
  const operators: readonly ApiOperator[] = ['>=', '<=', '^', '~', '>', '<']
  const operator = operators.find((candidate) => requirement.startsWith(candidate)) ?? ''
  const remainder = requirement.slice(operator.length)
  const version = operator === '' ? remainder : remainder.replace(/^ +/u, '')
  if (
    version.length === 0
    || version.endsWith(' ')
    || (operator === '' && version.length !== requirement.length)
    || !API_SEMVER_PATTERN.test(version)
    || validSemver(version) === null
  ) {
    fail('manifest.invalid-api-range', `${path} is not a supported API version requirement`, path)
  }
  return { operator, version }
}

export function satisfiesPluginApiRequirement(supported: string, requirement: string): boolean {
  if (!API_SEMVER_PATTERN.test(supported) || validSemver(supported) === null) return false
  let parsed: { operator: ApiOperator; version: string }
  try {
    parsed = parseApiRequirement(requirement, 'apiVersion')
  } catch {
    return false
  }
  const comparison = compareSemver(supported, parsed.version)
  const [supportedMajor, supportedMinor, supportedPatch] = supported.split('-')[0]?.split('.').map(Number) ?? []
  const [targetMajor, targetMinor, targetPatch] = parsed.version.split('-')[0]?.split('.').map(Number) ?? []
  switch (parsed.operator) {
    case '': return comparison === 0
    case '>=': return comparison >= 0
    case '>': return comparison > 0
    case '<=': return comparison <= 0
    case '<': return comparison < 0
    case '~':
      return comparison >= 0 && supportedMajor === targetMajor && supportedMinor === targetMinor
    case '^':
      if ((targetMajor ?? 0) > 0) return comparison >= 0 && supportedMajor === targetMajor
      if ((targetMinor ?? 0) > 0) {
        return comparison >= 0 && supportedMajor === 0 && supportedMinor === targetMinor
      }
      return comparison >= 0
        && supportedMajor === 0
        && supportedMinor === 0
        && supportedPatch === targetPatch
  }
}

function validatePluginId(value: unknown): string {
  const id = stringValue(value, '$.id')
  const segments = id.split('.')
  if (
    utf8ByteLength(id) < 3
    || utf8ByteLength(id) > 160
    || !PLUGIN_ID_PATTERN.test(id)
    || segments.some((segment) => utf8ByteLength(segment) > 63)
  ) {
    fail('manifest.invalid-id', 'Plugin id must be a lowercase reverse-domain identifier', '$.id')
  }
  if (id === 'app.notegen' || id.startsWith('app.notegen.')) {
    fail('manifest.reserved-id', 'The app.notegen.* namespace is reserved for NoteGen host internals', '$.id')
  }
  return id
}

function validateNamespacedId(value: unknown, pluginId: string, path: string): string {
  const id = stringValue(value, path)
  const suffix = id.startsWith(pluginId) ? id.slice(pluginId.length) : ''
  if (
    !suffix.startsWith('.')
    || suffix.length <= 1
    || utf8ByteLength(id) > 220
    || !NAMESPACED_ID_CHARACTERS.test(id)
  ) {
    fail('manifest.invalid-namespaced-id', `${path} must use the ${pluginId}. namespace`, path)
  }
  return id
}

function validatePermissionDeclarations(value: unknown): void {
  const permissions = objectValue(value, '$.permissions')
  assertAllowedKeys(permissions, Object.keys(SUPPORTED_PERMISSIONS), '$.permissions')
  for (const [name, rawDeclaration] of Object.entries(permissions)) {
    const path = `$.permissions.${name}`
    const declaration = objectValue(rawDeclaration, path)
    assertAllowedKeys(declaration, ['scope', 'optional', 'description'], path)
    const scope = stringValue(required(declaration, 'scope', path), `${path}.scope`)
    const allowedScopes: ReadonlySet<string> = SUPPORTED_PERMISSIONS[
      name as keyof typeof SUPPORTED_PERMISSIONS
    ]
    if (!allowedScopes.has(scope)) {
      fail('manifest.invalid-permission-scope', `${name} does not support the ${scope} scope`, `${path}.scope`)
    }
    if (Object.hasOwn(declaration, 'optional')) booleanValue(declaration.optional, `${path}.optional`)
    if (Object.hasOwn(declaration, 'description')) {
      validateText(declaration.description, `${path}.description`, 240)
    }
  }
}

function validateSetting(
  value: unknown,
  pluginId: string,
  index: number,
  keys: Set<string>,
  localizedTexts: string[],
): void {
  const path = `$.contributes.settings[${index}]`
  const setting = objectValue(value, path)
  const type = stringValue(required(setting, 'type', path), `${path}.type`)
  const common = ['key', 'type', 'scope', 'title', 'description', 'default']
  const allowedByType: Readonly<Record<string, readonly string[]>> = {
    boolean: common,
    string: [...common, 'placeholder', 'maxLength', 'permissionPaths'],
    number: [...common, 'min', 'max', 'step'],
    select: [...common, 'options'],
    'workspace-file': common,
    'workspace-folder': common,
  }
  const allowed = allowedByType[type]
  if (!allowed) fail('manifest.invalid-setting-type', `${path}.type is unsupported`, `${path}.type`)
  assertAllowedKeys(setting, allowed, path)

  const key = validateNamespacedId(required(setting, 'key', path), pluginId, `${path}.key`)
  if (keys.has(key)) fail('manifest.duplicate-setting', `Setting ${key} is declared more than once`, `${path}.key`)
  keys.add(key)
  const scope = stringValue(required(setting, 'scope', path), `${path}.scope`)
  if (scope !== 'device' && scope !== 'workspace') {
    fail('manifest.invalid-setting-scope', `${path}.scope must be device or workspace`, `${path}.scope`)
  }
  const title = validateLocalizedText(required(setting, 'title', path), `${path}.title`)
  localizedTexts.push(title)
  if (Object.hasOwn(setting, 'description')) {
    localizedTexts.push(validateLocalizedText(setting.description, `${path}.description`))
  }

  const defaultValue = required(setting, 'default', path)
  if (type === 'boolean') {
    booleanValue(defaultValue, `${path}.default`)
    return
  }
  if (type === 'string') {
    const defaultText = stringValue(defaultValue, `${path}.default`)
    let maximum = 65_536
    if (Object.hasOwn(setting, 'maxLength')) {
      maximum = integerValue(setting.maxLength, `${path}.maxLength`)
      assertJsonIntegerToken(setting, 'maxLength', `${path}.maxLength`)
      if (maximum <= 0 || maximum > 65_536) {
        fail('manifest.invalid-setting', `${path}.maxLength must be between 1 and 65536`, `${path}.maxLength`)
      }
    }
    if (utf8ByteLength(defaultText) > maximum) {
      fail('manifest.invalid-setting', `${path}.default exceeds maxLength`, `${path}.default`)
    }
    if (Object.hasOwn(setting, 'placeholder')) {
      localizedTexts.push(validateLocalizedText(setting.placeholder, `${path}.placeholder`))
    }
    return
  }
  if (type === 'number') {
    const defaultNumber = finiteNumber(defaultValue, `${path}.default`)
    const minimum = Object.hasOwn(setting, 'min') ? finiteNumber(setting.min, `${path}.min`) : undefined
    const maximum = Object.hasOwn(setting, 'max') ? finiteNumber(setting.max, `${path}.max`) : undefined
    const step = Object.hasOwn(setting, 'step') ? finiteNumber(setting.step, `${path}.step`) : 1
    if (step <= 0 || (minimum !== undefined && maximum !== undefined && minimum > maximum)) {
      fail('manifest.invalid-setting', `${path} has an invalid numeric range or step`, path)
    }
    if (
      (minimum !== undefined && defaultNumber < minimum)
      || (maximum !== undefined && defaultNumber > maximum)
    ) {
      fail('manifest.invalid-setting', `${path}.default is outside its numeric range`, `${path}.default`)
    }
    return
  }
  if (type === 'select') {
    const defaultText = stringValue(defaultValue, `${path}.default`)
    const options = arrayValue(required(setting, 'options', path), `${path}.options`)
    if (options.length === 0 || options.length > 100) {
      fail('manifest.invalid-setting', `${path}.options must contain between 1 and 100 values`, `${path}.options`)
    }
    const values = new Set<string>()
    for (const [optionIndex, rawOption] of options.entries()) {
      const optionPath = `${path}.options[${optionIndex}]`
      const option = objectValue(rawOption, optionPath)
      assertAllowedKeys(option, ['label', 'value'], optionPath)
      const label = validateLocalizedText(required(option, 'label', optionPath), `${optionPath}.label`)
      localizedTexts.push(label)
      const optionValue = stringValue(required(option, 'value', optionPath), `${optionPath}.value`)
      if (
        optionValue.length === 0
        || utf8ByteLength(optionValue) > 160
        || hasControlCharacter(optionValue)
        || values.has(optionValue)
      ) {
        fail('manifest.invalid-setting', `${optionPath}.value is empty, invalid, or duplicated`, `${optionPath}.value`)
      }
      values.add(optionValue)
    }
    if (!values.has(defaultText)) {
      fail('manifest.invalid-setting', `${path}.default must match an option value`, `${path}.default`)
    }
    return
  }

  if (scope !== 'workspace') {
    fail('manifest.invalid-setting', `${path}.scope must be workspace for ${type}`, `${path}.scope`)
  }
  const defaultPath = stringValue(defaultValue, `${path}.default`)
  if (defaultPath.length > 0) {
    validatePackagePath(defaultPath, {
      directory: type === 'workspace-folder',
      label: `${path}.default`,
    })
  }
}

function validateContributions(value: unknown, pluginId: string): ContributionValidation {
  const contributes = objectValue(value, '$.contributes')
  assertAllowedKeys(contributes, ['commands', 'settings', 'statusBar', 'menus', 'views'], '$.contributes')
  const commandIds = new Set<string>()
  const localizedTexts: string[] = []

  const commands = Object.hasOwn(contributes, 'commands')
    ? arrayValue(contributes.commands, '$.contributes.commands')
    : []
  if (commands.length > 100) fail('manifest.too-many-contributions', 'A plugin may declare at most 100 commands', '$.contributes.commands')
  for (const [index, rawCommand] of commands.entries()) {
    const path = `$.contributes.commands[${index}]`
    const command = objectValue(rawCommand, path)
    assertAllowedKeys(command, ['id', 'title', 'description', 'icon', 'suggestedShortcut', 'keywords'], path)
    const id = validateNamespacedId(required(command, 'id', path), pluginId, `${path}.id`)
    if (commandIds.has(id)) fail('manifest.duplicate-command', `Command ${id} is declared more than once`, `${path}.id`)
    commandIds.add(id)
    localizedTexts.push(validateLocalizedText(required(command, 'title', path), `${path}.title`))
    if (Object.hasOwn(command, 'description')) {
      localizedTexts.push(validateLocalizedText(command.description, `${path}.description`))
    }
    if (Object.hasOwn(command, 'icon')) {
      const icon = stringValue(command.icon, `${path}.icon`)
      if (utf8ByteLength(icon) === 0 || utf8ByteLength(icon) > 80 || !ICON_PATTERN.test(icon)) {
        fail('manifest.invalid-icon', `${path}.icon must be a symbolic ASCII icon name`, `${path}.icon`)
      }
    }
    if (Object.hasOwn(command, 'suggestedShortcut')) {
      validateText(command.suggestedShortcut, `${path}.suggestedShortcut`, 80)
    }
  }

  const settings = Object.hasOwn(contributes, 'settings')
    ? arrayValue(contributes.settings, '$.contributes.settings')
    : []
  if (settings.length > 100) fail('manifest.too-many-contributions', 'A plugin may declare at most 100 settings', '$.contributes.settings')
  const settingKeys = new Set<string>()
  for (const [index, setting] of settings.entries()) {
    validateSetting(setting, pluginId, index, settingKeys, localizedTexts)
  }

  const statusItems = Object.hasOwn(contributes, 'statusBar')
    ? arrayValue(contributes.statusBar, '$.contributes.statusBar')
    : []
  if (statusItems.length > 30) fail('manifest.too-many-contributions', 'A plugin may declare at most 30 status bar items', '$.contributes.statusBar')
  const statusIds = new Set<string>()
  for (const [index, rawStatus] of statusItems.entries()) {
    const path = `$.contributes.statusBar[${index}]`
    const status = objectValue(rawStatus, path)
    assertAllowedKeys(status, ['id', 'alignment', 'priority', 'command'], path)
    const id = validateNamespacedId(required(status, 'id', path), pluginId, `${path}.id`)
    if (statusIds.has(id)) fail('manifest.duplicate-status', `Status item ${id} is declared more than once`, `${path}.id`)
    statusIds.add(id)
    const alignment = stringValue(required(status, 'alignment', path), `${path}.alignment`)
    if (alignment !== 'left' && alignment !== 'right') {
      fail('manifest.invalid-status', `${path}.alignment must be left or right`, `${path}.alignment`)
    }
    if (Object.hasOwn(status, 'priority')) {
      const priority = integerValue(status.priority, `${path}.priority`)
      assertJsonIntegerToken(status, 'priority', `${path}.priority`, { signed: true })
      if (priority < -10_000 || priority > 10_000) {
        fail('manifest.invalid-status', `${path}.priority is outside the supported range`, `${path}.priority`)
      }
    }
    if (Object.hasOwn(status, 'command')) {
      const command = stringValue(status.command, `${path}.command`)
      if (!commandIds.has(command)) fail('manifest.unknown-command', `${path}.command is not declared`, `${path}.command`)
    }
  }

  for (const raw of (contributes.commands ?? []) as unknown[]) {
    const command = objectValue(raw, '$.contributes.commands')
    if (command.keywords !== undefined && (!Array.isArray(command.keywords) || command.keywords.length > 20 || command.keywords.some(word => typeof word !== 'string' || word.length < 1 || word.length > 80))) fail('manifest.invalid-keywords', 'Invalid command keywords', '$.contributes.commands')
  }

  const menus = Object.hasOwn(contributes, 'menus')
    ? arrayValue(contributes.menus, '$.contributes.menus')
    : []
  if (menus.length > 100) fail('manifest.too-many-contributions', 'A plugin may declare at most 100 menu items', '$.contributes.menus')
  const menuLocations = new Set(['editor/slash', 'editor/context', 'editor/selection', 'editor/toolbar', 'tab/context', 'file/context', 'mobile/writing/overflow'])
  for (const [index, rawMenu] of menus.entries()) {
    const path = `$.contributes.menus[${index}]`
    const menu = objectValue(rawMenu, path)
    assertAllowedKeys(menu, ['location', 'command', 'when', 'group', 'order', 'icon', 'enableWhen'], path)
    const location = stringValue(required(menu, 'location', path), `${path}.location`)
    const command = stringValue(required(menu, 'command', path), `${path}.command`)
    if (!menuLocations.has(location) || !commandIds.has(command)) {
      fail('manifest.invalid-menu', `${path} must use a supported location and declared command`, path)
    }
    for (const key of ['when', 'enableWhen']) {
      if (Object.hasOwn(menu, key) && !isValidPluginMenuCondition(stringValue(menu[key], `${path}.${key}`))) fail('manifest.invalid-menu-condition', `${path}.${key} is unsupported`, `${path}.${key}`)
    }
    if (menu.order !== undefined && (typeof menu.order !== 'number' || !Number.isInteger(menu.order) || Math.abs(menu.order) > 10000)) fail('manifest.invalid-menu-order', 'Invalid menu order', path)
    if (menu.icon !== undefined && (typeof menu.icon !== 'string' || !ICON_PATTERN.test(menu.icon) || menu.icon.length > 80)) fail('manifest.invalid-menu-icon', 'Invalid menu icon', path)
    if (Object.hasOwn(menu, 'group')) {
      const group = stringValue(menu.group, `${path}.group`)
      if (group.length === 0 || utf8ByteLength(group) > 80 || hasControlCharacter(group)) {
        fail('manifest.invalid-menu-group', `${path}.group is invalid`, `${path}.group`)
      }
    }
  }

  const views = Object.hasOwn(contributes, 'views')
    ? arrayValue(contributes.views, '$.contributes.views')
    : []
  if (views.length > 30) fail('manifest.too-many-contributions', 'A plugin may declare at most 30 views', '$.contributes.views')
  const viewIds = new Set<string>()
  for (const [index, rawView] of views.entries()) {
    const path = `$.contributes.views[${index}]`
    const view = objectValue(rawView, path)
    assertAllowedKeys(view, ['id', 'title', 'location', 'icon'], path)
    const id = validateNamespacedId(required(view, 'id', path), pluginId, `${path}.id`)
    if (viewIds.has(id)) fail('manifest.duplicate-view', `View ${id} is declared more than once`, `${path}.id`)
    viewIds.add(id)
    localizedTexts.push(validateLocalizedText(required(view, 'title', path), `${path}.title`))
    const location = stringValue(required(view, 'location', path), `${path}.location`)
    if (location !== 'left-sidebar' && location !== 'right-sidebar' && location !== 'editor-tab') {
      fail('manifest.invalid-view', `${path}.location must be left-sidebar, right-sidebar or editor-tab`, `${path}.location`)
    }
    if (Object.hasOwn(view, 'icon')) {
      const icon = stringValue(view.icon, `${path}.icon`)
      if (utf8ByteLength(icon) === 0 || utf8ByteLength(icon) > 80 || !ICON_PATTERN.test(icon)) {
        fail('manifest.invalid-icon', `${path}.icon must be a symbolic ASCII icon name`, `${path}.icon`)
      }
    }
  }

  return { commandIds, localizedTexts }
}

function validateActivationEvents(value: unknown, commandIds: ReadonlySet<string>): void {
  const events = arrayValue(value, '$.activationEvents')
  if (events.length > 100) fail('manifest.too-many-activation-events', 'A plugin may declare at most 100 activation events', '$.activationEvents')
  const seen = new Set<string>()
  for (const [index, rawEvent] of events.entries()) {
    const path = `$.activationEvents[${index}]`
    const event = stringValue(rawEvent, path)
    const command = event.startsWith('onCommand:') ? event.slice('onCommand:'.length) : undefined
    if (
      (!['onEditor:markdown', 'onWorkspace:open', 'onNotes:change'].includes(event)
        && (command === undefined || !commandIds.has(command)))
      || seen.has(event)
    ) {
      fail('manifest.invalid-activation-event', `${path} is unsupported, duplicated, or references an unknown command`, path)
    }
    seen.add(event)
  }
}

function isValidLocaleTag(value: string): boolean {
  if (utf8ByteLength(value) < 2 || utf8ByteLength(value) > 35 || !/^[\x00-\x7F]+$(?![\s\S])/u.test(value)) return false
  const [language, ...segments] = value.split('-')
  return language !== undefined
    && language.length >= 2
    && language.length <= 8
    && /^[A-Za-z]+$(?![\s\S])/u.test(language)
    && segments.every((segment) => segment.length > 0 && segment.length <= 8 && /^[A-Za-z0-9]+$(?![\s\S])/u.test(segment))
}

export function validateLocaleMessages(value: unknown, path = 'locale'): Readonly<Record<string, string>> {
  const messages = objectValue(value, path)
  if (Object.keys(messages).length > 2_000) {
    fail('manifest.too-many-locale-messages', `${path} contains more than 2000 messages`, path)
  }
  for (const [key, rawMessage] of Object.entries(messages)) {
    if (key.length === 0 || utf8ByteLength(key) > 160 || hasControlCharacter(key) || typeof rawMessage !== 'string') {
      fail('manifest.invalid-locale-message', `${path} contains an invalid key or non-string value`, `${path}.${key}`)
    }
    if (utf8ByteLength(rawMessage) > 4_096 || rawMessage.includes('\0')) {
      fail('manifest.invalid-locale-message', `${path}.${key} exceeds its message limit`, `${path}.${key}`)
    }
  }
  return messages as Readonly<Record<string, string>>
}

function validateLocalization(
  manifest: Record<string, unknown>,
  localizedTexts: readonly string[],
  files?: ReadonlyMap<string, Uint8Array>,
): void {
  const defaultLocale = Object.hasOwn(manifest, 'defaultLocale')
    ? stringValue(manifest.defaultLocale, '$.defaultLocale')
    : undefined
  const locales = Object.hasOwn(manifest, 'locales')
    ? objectValue(manifest.locales, '$.locales')
    : {}
  const localeEntries = Object.entries(locales)
  if (localeEntries.length > 50) fail('manifest.too-many-locales', 'A plugin may declare at most 50 locale resources', '$.locales')
  if ((localeEntries.length === 0) !== (defaultLocale === undefined)) {
    fail('manifest.invalid-locales', 'defaultLocale and non-empty locales must be declared together', '$.locales')
  }

  const references = new Set(localizedTexts.map(localizationKey).filter((key): key is string => key !== undefined))
  if (localeEntries.length === 0) {
    if (references.size > 0) fail('manifest.missing-locales', 'Localized contribution text requires locale resources', '$.locales')
    return
  }
  if (defaultLocale === undefined || !Object.hasOwn(locales, defaultLocale)) {
    fail('manifest.invalid-locales', 'defaultLocale must reference an entry in locales', '$.defaultLocale')
  }

  const tags = new Set<string>()
  const paths = new Set<string>()
  let defaultMessages: Readonly<Record<string, string>> | undefined
  for (const [locale, rawPath] of localeEntries) {
    if (!isValidLocaleTag(locale) || tags.has(locale.toLowerCase())) {
      fail('manifest.invalid-locale-tag', `Invalid or duplicated locale tag: ${locale}`, `$.locales.${locale}`)
    }
    tags.add(locale.toLowerCase())
    const path = validatePackagePath(stringValue(rawPath, `$.locales.${locale}`), { label: `$.locales.${locale}` })
    const collisionKey = packagePathCollisionKey(path)
    if (utf8ByteLength(path) > 240 || !path.toLowerCase().endsWith('.json') || paths.has(collisionKey)) {
      fail('manifest.invalid-locale-path', `Invalid or duplicated locale resource: ${path}`, `$.locales.${locale}`)
    }
    paths.add(collisionKey)
    if (files) {
      const bytes = files.get(path)
      if (!bytes) fail('manifest.missing-locale-file', `Package is missing locale resource ${path}`, path)
      const messages = validateLocaleMessages(parseStrictJson(bytes, path), path)
      if (locale === defaultLocale) defaultMessages = messages
    }
  }

  if (files) {
    if (!defaultMessages) fail('manifest.missing-default-locale', 'The default locale could not be loaded', '$.defaultLocale')
    const missing = [...references].find((key) => !Object.hasOwn(defaultMessages, key))
    if (missing !== undefined) {
      fail('manifest.missing-translation', `Default locale is missing contribution key ${missing}`, `$.locales.${defaultLocale}`)
    }
  }
}

function validateEntry(entry: string, files?: ReadonlyMap<string, Uint8Array>): void {
  if (utf8ByteLength(entry) > 240 || !entry.endsWith('.js')) {
    fail('manifest.invalid-entry', 'Plugin entry must be a JavaScript .js file of at most 240 UTF-8 bytes', '$.entry')
  }
  if (!files) return
  const bytes = files.get(entry)
  if (!bytes) fail('manifest.missing-entry', `Package is missing plugin entry ${entry}`, entry)
  if (bytes.byteLength > 5 * 1_048_576) fail('manifest.entry-too-large', 'Plugin entry exceeds 5 MiB', entry)
  let source: string
  try {
    source = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail('manifest.invalid-entry-encoding', 'Plugin entry must contain valid UTF-8 JavaScript', entry)
  }
  if (source.includes('\0')) fail('manifest.invalid-entry', 'Plugin entry contains a null character', entry)
}

function validatePublicUrl(value: unknown, path: string): void {
  const raw = stringValue(value, path)
  if (utf8ByteLength(raw) > 500) fail('manifest.invalid-url', `${path} is too long`, path)
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    fail('manifest.invalid-url', `${path} must be a valid HTTP(S) URL`, path)
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username.length > 0
    || url.password.length > 0
    || url.hostname.length === 0
  ) {
    fail('manifest.invalid-url', `${path} must be an HTTP(S) URL without credentials`, path)
  }
}

export function validatePluginManifest(
  value: unknown,
  options: ManifestValidationOptions = {},
): PluginManifestV1 {
  const manifest = objectValue(value, '$')
  assertAllowedKeys(manifest, [
    'manifestVersion', 'id', 'name', 'description', 'version', 'apiVersion',
    'minAppVersion', 'platforms', 'entry', 'activationEvents', 'permissions',
    'contributes', 'resources', 'defaultLocale', 'locales', 'author', 'repository', 'license',
  ], '$')

  const manifestVersion = integerValue(required(manifest, 'manifestVersion', '$'), '$.manifestVersion')
  assertJsonIntegerToken(manifest, 'manifestVersion', '$.manifestVersion')
  if (manifestVersion !== 1) fail('manifest.unsupported-version', 'Only manifestVersion 1 is supported', '$.manifestVersion')
  const pluginId = validatePluginId(required(manifest, 'id', '$'))
  validateText(required(manifest, 'name', '$'), '$.name', 100)
  if (Object.hasOwn(manifest, 'description')) validateText(manifest.description, '$.description', 500)
  validateSemver(required(manifest, 'version', '$'), '$.version', true)
  const apiRequirement = stringValue(required(manifest, 'apiVersion', '$'), '$.apiVersion')
  parseApiRequirement(apiRequirement, '$.apiVersion')
  const minimumAppVersion = validateSemver(required(manifest, 'minAppVersion', '$'), '$.minAppVersion', true)

  const platforms = arrayValue(required(manifest, 'platforms', '$'), '$.platforms')
  if (platforms.length === 0) fail('manifest.missing-platform', 'Plugin platforms must not be empty', '$.platforms')
  const platformNames = platforms.map((platform, index) => stringValue(platform, `$.platforms[${index}]`))
  if (platformNames.some((platform) => !['desktop', 'ios', 'android'].includes(platform))) {
    fail('manifest.invalid-platform', 'Plugin platforms contains an unsupported value', '$.platforms')
  }
  if (new Set(platformNames).size !== platformNames.length) {
    fail('manifest.duplicate-platform', 'Plugin platforms contains duplicate entries', '$.platforms')
  }
  if (!platformNames.includes('desktop')) {
    fail('manifest.desktop-required', 'Community plugin packages must include desktop', '$.platforms')
  }

  if (manifest.entry !== undefined) {
    const entry = validatePackagePath(stringValue(manifest.entry, '$.entry'), { label: '$.entry' })
    validateEntry(entry, options.files)
  }
  if (manifest.resources !== undefined) {
    try {
      validatePluginResources(manifest.resources)
      if (manifest.resources.documentPreviews?.length && !objectValue(manifest.permissions, '$.permissions')['attachments.read']) throw new Error('Previews require attachments.read')
      for (const path of pluginResourcePaths(manifest.resources)) {
        const bytes = options.files?.get(path)
        if (options.files && !bytes) throw new Error(`Missing resource: ${path}`)
        if (bytes && bytes.length > 5 * 1_048_576) throw new Error(`Resource exceeds 5 MiB: ${path}`)
      }
      for (const language of manifest.resources.languages ?? []) {
        const bytes = options.files?.get(language.messages)
        if (bytes) validatePluginLanguageMessages(parseStrictJson(bytes, language.messages))
      }
    } catch (error) { fail('manifest.invalid-resources', String(error), '$.resources') }
  }
  for (const path of options.files?.keys() ?? []) {
    if (path.toLowerCase().endsWith('.wasm') && !(manifest.resources as import('@notegen/plugin-api').PluginResources | undefined)?.documentPreviews?.some(preview => preview.assets?.includes(path))) fail('manifest.undeclared-wasm', 'WASM must be a declared preview asset', path)
  }
  if (manifest.entry === undefined) {
    if (!manifest.resources || Object.values(objectValue(manifest.resources, '$.resources')).every(x => !Array.isArray(x) || x.length === 0)) fail('manifest.missing-resources', 'A resource package needs resources')
    if (arrayValue(manifest.activationEvents, '$.activationEvents').length || Object.values(objectValue(manifest.contributes, '$.contributes')).some(items => Array.isArray(items) && items.length)) fail('manifest.resource-execution', 'A resource package cannot declare runtime contributions or activation events')
    if (Object.keys(objectValue(manifest.permissions, '$.permissions')).some(x => x !== 'attachments.read') || (!(objectValue(manifest.resources, '$.resources').documentPreviews as unknown[] | undefined)?.length && Object.keys(objectValue(manifest.permissions, '$.permissions')).length)) fail('manifest.resource-permissions', 'Only previews may request attachments.read')
  }
  validatePermissionDeclarations(required(manifest, 'permissions', '$'))
  const contributions = validateContributions(required(manifest, 'contributes', '$'), pluginId)
  validateActivationEvents(required(manifest, 'activationEvents', '$'), contributions.commandIds)
  validateLocalization(manifest, contributions.localizedTexts, options.files)

  if (!satisfiesPluginApiRequirement(options.apiVersion ?? PLUGIN_API_VERSION, apiRequirement)) {
    fail('manifest.incompatible-api', `Plugin requires API ${apiRequirement}`, '$.apiVersion')
  }
  if (options.appVersion !== undefined) {
    const appVersion = validateSemver(options.appVersion, 'appVersion', true)
    if (compareSemver(minimumAppVersion, appVersion) > 0) {
      fail('manifest.incompatible-app', `Plugin requires NoteGen ${minimumAppVersion} or newer`, '$.minAppVersion')
    }
  }

  if (Object.hasOwn(manifest, 'author')) {
    const author = objectValue(manifest.author, '$.author')
    assertAllowedKeys(author, ['name', 'url'], '$.author')
    validateText(required(author, 'name', '$.author'), '$.author.name', 120)
    if (Object.hasOwn(author, 'url')) validatePublicUrl(author.url, '$.author.url')
  }
  if (Object.hasOwn(manifest, 'repository')) validatePublicUrl(manifest.repository, '$.repository')
  if (Object.hasOwn(manifest, 'license')) validateText(manifest.license, '$.license', 80)

  const typed = manifest as unknown as PluginManifestV1
  let folderBindingSeen = false
  for (const setting of typed.contributes.settings ?? []) {
    if (setting.type !== 'string' || setting.permissionPaths === undefined) continue
    const paths = setting.permissionPaths
    if (folderBindingSeen || setting.scope !== 'workspace' || !Array.isArray(paths) || !paths.length || paths.length > 20
      || new Set(paths).size !== paths.length || paths.some(name => {
        if (typeof name !== 'string' || !Object.hasOwn(typed.permissions, name)) return true
        const declaration = typed.permissions[name as keyof typeof typed.permissions]
        return !declaration || declaration.scope !== 'workspace-folder' || declaration.optional
      })) fail('manifest.invalid-setting', 'Invalid workspace folder permission binding', '$.contributes.settings')
    folderBindingSeen = true
  }
  return typed
}

export function parsePluginManifest(
  input: string | Uint8Array,
  options: ManifestValidationOptions = {},
): PluginManifestV1 {
  return validatePluginManifest(parseStrictJson(input, 'plugin.json'), options)
}
