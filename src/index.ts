/** The public API version implemented by this release of NoteGen. */
export const PLUGIN_API_VERSION = '1.0.0' as const

export type PluginPlatform = 'desktop' | 'ios' | 'android'

export type PluginActivationEvent =
  | `onCommand:${string}`
  | 'onEditor:markdown'

export type PluginPermissionScope =
  | 'active-editor'
  | 'workspace-file'
  | 'workspace-files'
  | 'workspace-folder'

export interface PluginPermissionDeclaration<
  Scope extends PluginPermissionScope = PluginPermissionScope,
> {
  scope: Scope
  optional?: boolean
  description?: string
}

export interface PluginPermissionDeclarations {
  'editor.read'?: PluginPermissionDeclaration<'active-editor'>
  'notes.read'?: PluginPermissionDeclaration<
    'workspace-file' | 'workspace-files' | 'workspace-folder'
  >
  'notes.create'?: PluginPermissionDeclaration<'workspace-folder'>
  'notes.open'?: PluginPermissionDeclaration<'workspace-folder'>
}

export type PluginPermissionName = keyof PluginPermissionDeclarations

export interface PluginCommandContribution {
  id: string
  title: string
  description?: string
  icon?: string
  suggestedShortcut?: string
}

export interface PluginSettingOption {
  readonly label: string
  readonly value: string
}

export type PluginSettingContribution =
  | {
      key: string
      type: 'boolean'
      scope: 'device' | 'workspace'
      title: string
      description?: string
      default: boolean
    }
  | {
      key: string
      type: 'string'
      scope: 'device' | 'workspace'
      title: string
      description?: string
      default: string
      placeholder?: string
      maxLength?: number
    }
  | {
      key: string
      type: 'number'
      scope: 'device' | 'workspace'
      title: string
      description?: string
      default: number
      min?: number
      max?: number
      step?: number
    }
  | {
      key: string
      type: 'select'
      scope: 'device' | 'workspace'
      title: string
      description?: string
      default: string
      options: readonly PluginSettingOption[]
    }
  | {
      key: string
      type: 'workspace-file' | 'workspace-folder'
      scope: 'workspace'
      title: string
      description?: string
      default: string
    }

export interface PluginStatusBarContribution {
  id: string
  alignment: 'left' | 'right'
  priority?: number
  command?: string
}

export type PluginMenuLocation =
  | 'editor/slash'
  | 'editor/context'
  | 'file/context'
  | 'mobile/writing/overflow'

export interface PluginMenuContribution {
  location: PluginMenuLocation
  command: string
  when?: string
  group?: string
}

export interface PluginContributions {
  commands?: readonly PluginCommandContribution[]
  settings?: readonly PluginSettingContribution[]
  statusBar?: readonly PluginStatusBarContribution[]
  menus?: readonly PluginMenuContribution[]
}

export interface PluginAuthor {
  name: string
  url?: string
}

export interface PluginManifestV1 {
  manifestVersion: 1
  id: string
  name: string
  description?: string
  version: string
  apiVersion: string
  minAppVersion: string
  platforms: readonly PluginPlatform[]
  entry: string
  activationEvents: readonly PluginActivationEvent[]
  permissions: Readonly<PluginPermissionDeclarations>
  contributes: PluginContributions
  defaultLocale?: string
  locales?: Readonly<Record<string, string>>
  author?: PluginAuthor
  repository?: string
  license?: string
}

export type PluginSettingValue = string | number | boolean

export interface WorkspaceInfo {
  id: string
  name: string
}

export interface ResolveDayOptions {
  timeZone: 'system' | string
  dayStartsAt: string
}

export interface ResolvedDay {
  instant: string
  logicalDate: string
  timeZone: string
  localDateTime: string
}

export interface NoteSnapshot {
  id: string
  path: string
  revision: number
  content: string
}

export interface ReadNoteOptions {
  path: string
}

export interface OpenOrCreateNoteOptions {
  workspaceId: string
  path: string
  initialContent: string
  conflict: 'open-existing'
  open: boolean
  idempotencyKey: string
}

export interface OpenOrCreateResult {
  status: 'created' | 'opened-existing'
  workspaceId: string
  path: string
  opened: boolean
}

export interface ActiveEditorContext {
  windowId: string
  editorId: string
  documentId: string
  kind: 'markdown'
  mode: 'visual' | 'source' | 'sectioned'
  revision: number
  composing: boolean
  size: {
    utf16Length: number
    bytes: number
    lines: number
  }
}

export interface EditorSelection {
  editorId: string
  revision: number
  from?: number
  to?: number
  offsetsAvailable: boolean
  empty: boolean
  text: string
}

export interface EditorTextSnapshot {
  editorId: string
  documentId: string
  revision: number
  format: 'markdown'
  text: string
}

export interface GetEditorTextSnapshotOptions {
  editorId: string
  expectedRevision: number
  format: 'markdown'
}

export interface EditorActiveChangeEvent {
  previous: ActiveEditorContext | null
  current: ActiveEditorContext | null
}

export interface EditorContentChangeEvent {
  editorId: string
  documentId: string
  revision: number
  size: ActiveEditorContext['size']
}

export interface PluginDisposable {
  readonly dispose: () => void
}

export interface PluginStorageArea {
  readonly get: (key: string) => Promise<unknown>
  readonly set: (key: string, value: unknown) => Promise<void>
  readonly delete: (key: string) => Promise<void>
}

export type PluginAbortListener = () => void

/** The AbortSignal subset implemented by both built-in and community runtimes. */
export interface PluginAbortSignal {
  readonly aborted: boolean
  readonly reason: unknown
  readonly throwIfAborted: () => void
  readonly addEventListener: (
    type: 'abort',
    listener: PluginAbortListener,
    options?: { once?: boolean },
  ) => void
  readonly removeEventListener: (
    type: 'abort',
    listener: PluginAbortListener,
  ) => void
}

export interface PluginStatusBarUpdate {
  visible: boolean
  text?: string
  compactText?: string
  tooltip?: string
  accessibleLabel?: string
  busy?: boolean
}

export interface PluginContext {
  readonly plugin: {
    readonly id: string
    readonly version: string
    /** The concrete host API version, which may be newer than this SDK release. */
    readonly apiVersion: string
  }
  readonly signal: PluginAbortSignal
  readonly commands: {
    readonly handle: (
      commandId: string,
      handler: (argument?: unknown) => unknown | Promise<unknown>,
    ) => PluginDisposable
  }
  readonly workspace: {
    readonly getCurrent: () => Promise<WorkspaceInfo>
  }
  readonly calendar: {
    readonly resolveDay: (options: ResolveDayOptions) => Promise<ResolvedDay>
  }
  readonly notes: {
    readonly read: (options: ReadNoteOptions) => Promise<NoteSnapshot>
    readonly openOrCreate: (options: OpenOrCreateNoteOptions) => Promise<OpenOrCreateResult>
  }
  readonly editor: {
    readonly getActiveEditor: () => Promise<ActiveEditorContext | null>
    readonly getSelection: () => Promise<EditorSelection | null>
    readonly getTextSnapshot: (options: GetEditorTextSnapshotOptions) => Promise<EditorTextSnapshot>
    readonly onDidChangeActiveEditor: (
      listener: (event: EditorActiveChangeEvent) => void | Promise<void>,
    ) => PluginDisposable
    readonly onDidChangeContent: (
      listener: (event: EditorContentChangeEvent) => void | Promise<void>,
    ) => PluginDisposable
  }
  readonly storage: {
    readonly device: PluginStorageArea
    readonly workspace: PluginStorageArea
  }
  readonly ui: {
    readonly showNotice: (message: string) => Promise<void>
    readonly statusBar: {
      readonly update: (id: string, state: PluginStatusBarUpdate) => Promise<void>
    }
  }
  readonly i18n: {
    readonly t: (key: string, values?: Record<string, string | number>) => string
  }
  readonly settings: {
    readonly get: (key: string) => PluginSettingValue | undefined
    readonly onDidChange: (
      listener: (key: string, value: PluginSettingValue) => void | Promise<void>,
    ) => PluginDisposable
  }
}

export interface PluginModule {
  activate: (context: PluginContext) => void | Promise<void>
  deactivate?: () => void | Promise<void>
}

export type PluginActivate = PluginModule['activate']
export type PluginDeactivate = NonNullable<PluginModule['deactivate']>

export const PLUGIN_ERROR_CODES = Object.freeze([
  'PermissionDenied',
  'AlreadyRegistered',
  'UnavailableOnPlatform',
  'QuotaExceeded',
  'StaleRevision',
  'Conflict',
  'NotFound',
  'InvalidTimeZone',
  'InvalidPath',
  'EditorBusy',
  'WorkspaceChanged',
  'CreatedNotOpened',
  'ReadOnly',
  'NoSpace',
  'Timeout',
  'Cancelled',
  'InvalidManifest',
  'Incompatible',
  'RuntimeFailure',
  'SignatureInvalid',
  'IntegrityMismatch',
] as const)

export type PluginErrorCode = typeof PLUGIN_ERROR_CODES[number]

/** Errors crossing the plugin boundary expose a stable code and message. */
export class PluginError extends Error {
  readonly code: PluginErrorCode
  readonly details?: Record<string, unknown>

  constructor(
    code: PluginErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'PluginError'
    this.code = code
    this.details = details
  }
}

/** Works for both local errors and errors received across the Worker boundary. */
export function isPluginError(value: unknown): value is PluginError {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as { code?: unknown; message?: unknown }
  return typeof candidate.message === 'string'
    && typeof candidate.code === 'string'
    && (PLUGIN_ERROR_CODES as readonly string[]).includes(candidate.code)
}

/** Preserve literal manifest values while checking the v1 shape at compile time. */
export function definePluginManifest<const Manifest extends PluginManifestV1>(
  manifest: Manifest,
): Manifest {
  return manifest
}
