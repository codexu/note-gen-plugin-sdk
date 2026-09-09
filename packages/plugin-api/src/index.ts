/** The public API version implemented by this release of NoteGen. */
export const PLUGIN_API_VERSION = '0.1.0' as const

export type PluginPlatform = 'desktop' | 'ios' | 'android'

export type PluginActivationEvent =
  | `onCommand:${string}`
  | 'onEditor:markdown'
  | 'onWorkspace:open'
  | 'onNotes:change'

export type PluginPermissionScope =
  | 'active-editor'
  | 'workspace-file'
  | 'workspace-files'
  | 'workspace-folder'
  | 'network-origins'

export interface PluginPermissionDeclaration<
  Scope extends PluginPermissionScope = PluginPermissionScope,
> {
  scope: Scope
  optional?: boolean
  description?: string
}

export interface PluginPermissionDeclarations {
  'editor.read'?: PluginPermissionDeclaration<'active-editor'>
  'editor.write'?: PluginPermissionDeclaration<'active-editor'>
  'notes.read'?: PluginPermissionDeclaration<
    'workspace-file' | 'workspace-files' | 'workspace-folder'
  >
  'notes.create'?: PluginPermissionDeclaration<'workspace-folder'>
  'notes.open'?: PluginPermissionDeclaration<'workspace-folder'>
  'notes.list'?: PluginPermissionDeclaration<'workspace-folder'>
  'notes.write'?: PluginPermissionDeclaration<'workspace-file' | 'workspace-files' | 'workspace-folder'>
  'notes.delete'?: PluginPermissionDeclaration<'workspace-file' | 'workspace-files' | 'workspace-folder'>
  'notes.move'?: PluginPermissionDeclaration<'workspace-folder'>
  'network.fetch'?: PluginPermissionDeclaration<'network-origins'>
  'attachments.read'?: PluginPermissionDeclaration<'workspace-file' | 'workspace-files' | 'workspace-folder'>
  'attachments.create'?: PluginPermissionDeclaration<'workspace-folder'>
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
      /** One workspace folder template may bind required workspace-folder grants. */
      permissionPaths?: readonly PluginPermissionName[]
      scope: 'device' | 'workspace'
      title: string
      description?: string
      default: string
      placeholder?: string
      /** Maximum UTF-8 byte length accepted by the host. */
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

export interface PluginViewContribution {
  id: string
  title: string
  location: 'left-sidebar' | 'right-sidebar' | 'editor-tab'
  icon?: string
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
  views?: readonly PluginViewContribution[]
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

/**
 * Values that can cross the NoteGen plugin boundary without losing meaning.
 *
 * Plugin commands, storage, and declarative UI are transported as JSON. Class
 * instances, functions, symbols, bigint values, `undefined` inside containers,
 * and cyclic objects are therefore intentionally excluded from this type.
 */
export type PluginJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly PluginJsonValue[]
  | { readonly [key: string]: PluginJsonValue }

export type PluginCommandArgument = PluginJsonValue | undefined
export type PluginCommandResult = PluginJsonValue | void

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

export interface NoteEntry {
  path: string
  name: string
  size: number
}

export interface ListNotesOptions {
  folder?: string
  recursive?: boolean
  limit?: number
  /** Opaque continuation returned by notes.list; keep folder/recursive unchanged. */
  cursor?: string
}

export interface ListNotesResult {
  entries: readonly NoteEntry[]
  truncated: boolean
  nextCursor?: string
}

export interface SearchNotesOptions {
  query: string
  folder?: string
  caseSensitive?: boolean
  limit?: number
}

export interface SearchNotesResult {
  matches: readonly { path: string; revision: number; line: number; preview: string }[]
  /** True when the scan or result quota was reached. Searches saved Markdown only. */
  truncated: boolean
}

export interface WriteNoteOptions {
  path: string
  content: string
  /** Required when the target exists, including with create: true. Read before writing. */
  expectedRevision?: number
  create?: boolean
}

export interface WriteNoteResult {
  path: string
  revision: number
  created: boolean
}

export interface MoveNoteOptions {
  from: string
  to: string
  overwrite?: false
}

export interface DeleteNoteOptions {
  path: string
  /** Desktop moves to system trash; mobile deletion is unavailable. */
  expectedRevision: number
}

export interface NoteChangeEvent {
  type: 'created' | 'changed' | 'deleted' | 'moved'
  path: string
  previousPath?: string
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
  composing: boolean
  size: ActiveEditorContext['size']
}

export interface ApplyEditorEditOptions {
  editorId: string
  expectedRevision: number
  text: string
  target: 'cursor' | 'selection'
}

export interface ApplyEditorEditResult {
  applied: true
  insertedLength: number
}

/** All ranges use UTF-16 offsets into the Markdown snapshot at expectedRevision. */
export interface EditorRangeEdit { from: number; to: number; text: string }
export interface ApplyEditorEditsOptions {
  editorId: string
  expectedRevision: number
  edits: readonly EditorRangeEdit[]
}
export interface SetEditorSelectionOptions {
  editorId: string
  expectedRevision: number
  from: number
  to: number
}

export type PluginFormValue = string | number | boolean
export interface PluginFormCondition { field: string; equals: PluginFormValue }
export type PluginFormField = {
  id: string
  label: string
  description?: string
  required?: boolean
  disabled?: boolean
  visibleWhen?: PluginFormCondition
} & (
  | { type: 'text' | 'textarea'; value?: string; placeholder?: string; maxLength?: number }
  | { type: 'number'; value?: number; min?: number; max?: number }
  | { type: 'select'; value?: string; options: readonly { label: string; value: string }[] }
  | { type: 'checkbox'; value?: boolean }
)

export interface PluginFormBlock {
  type: 'form'
  id: string
  /** Change this token to explicitly reset values and feedback. */
  resetKey?: string
  /** Debounced user changes; receives { formId, fieldId, values, revision, generation, dialogId? }. Return value is ignored. */
  changeCommand?: string
  submitDisabled?: boolean
  fields: readonly PluginFormField[]
  submitLabel: string
  /** Receives { formId, values, dialogId? }. Hidden/disabled fields are omitted. May return { fieldErrors, message }. */
  command: string
}

export interface PluginViewState {
  id: string
  location: PluginViewContribution['location']
  visible: boolean
}

export interface WorkspaceChangeEvent {
  previous: WorkspaceInfo | null
  current: WorkspaceInfo
}

export interface PluginNetworkRequest {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Readonly<Record<string, string>>
  body?: string
  timeoutMs?: number
}

export interface PluginNetworkResponse {
  url: string
  status: number
  headers: Readonly<Record<string, string>>
  body: string
}

export type PluginTableCell = string | {
  text: string
  command: string
  argument?: PluginCommandArgument
  disabled?: boolean
}

export type PluginUiBlock =
  | PluginFormBlock
  | { type: 'separator' }
  | { type: 'callout'; title: string; text: string; tone?: 'default' | 'destructive' }
  | { type: 'progress'; label: string; value: number }
  | { type: 'table'; id?: string; rowIds?: readonly string[]; columns: readonly string[]; rows: readonly (readonly PluginTableCell[])[] }
  | { type: 'tree'; items: readonly { id: string; parentId?: string; label: string; command?: string; argument?: PluginCommandArgument }[] }
  | { type: 'heading'; text: string }
  | { type: 'text'; text: string; tone?: 'default' | 'muted' | 'warning' }
  | { type: 'list'; items: readonly string[] }
  | { type: 'key-value'; items: readonly { label: string; value: string }[] }
  | {
      type: 'actions'
      actions: readonly {
        id: string
        label: string
        command: string
        argument?: PluginCommandArgument
        variant?: 'default' | 'secondary' | 'destructive'
        disabled?: boolean
      }[]
    }

export interface PluginUiDocument {
  blocks: readonly PluginUiBlock[]
  /** Apply only while this form input snapshot is current in the target surface. */
  expectedForm?: { formId: string; generation: string; revision: number }
}

export interface PluginDialogOptions {
  /** Replace only this still-open dialog owned by this plugin. Otherwise a busy dialog returns Conflict. */
  replaceId?: string
  title: string
  description?: string
  content: PluginUiDocument
  closeLabel?: string
}

export interface PluginDisposable {
  readonly dispose: () => void
}

export interface PluginStorageArea {
  readonly get: (key: string) => Promise<PluginJsonValue | undefined>
  readonly set: (key: string, value: PluginJsonValue) => Promise<void>
  readonly delete: (key: string) => Promise<void>
}

export type PluginAbortListener = () => void

/** The AbortSignal subset implemented by NoteGen marketplace and development runtimes. */
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

export interface PluginDialogHandle { id: string }
export type PluginDialogUpdate = Omit<PluginDialogOptions, 'replaceId'>
/** Non-destructive main-window navigation only; no arbitrary command execution. */
export type PluginHostCommand = 'app.openSearch' | 'app.openSettings' | 'app.openPluginSettings'
export interface PluginDialogCloseEvent {
  id: string
  reason: 'user' | 'programmatic' | 'replaced' | 'disposed'
}

export interface PluginAttachment {
  /** Workspace-relative path; never an absolute filesystem path or file URL. */
  path: string
  size: number
  /** Standard padded Base64, limited to 1 MiB of decoded bytes. */
  base64: string
}

export interface PluginContext {
  readonly plugin: {
    readonly id: string
    readonly version: string
    /** The concrete host API version, which may be newer than this SDK release. */
    readonly apiVersion: string
  }
  /** Local diagnostics only. Messages are truncated to 1,000 characters and rate limited. Never log secrets. */
  readonly log: {
    readonly info: (message: string) => void
    readonly warning: (message: string) => void
    readonly error: (message: string) => void
  }
  readonly signal: PluginAbortSignal
  readonly commands: {
    readonly executeHost: (command: PluginHostCommand) => Promise<void>
    readonly handle: (
      commandId: string,
      handler: (
        argument?: PluginCommandArgument,
      ) => PluginCommandResult | Promise<PluginCommandResult>,
    ) => PluginDisposable
  }
  readonly workspace: {
    readonly getCurrent: () => Promise<WorkspaceInfo>
    readonly onDidChange: (
      listener: (event: WorkspaceChangeEvent) => void | Promise<void>,
    ) => PluginDisposable
  }
  readonly calendar: {
    readonly resolveDay: (options: ResolveDayOptions) => Promise<ResolvedDay>
  }
  readonly attachments: {
    readonly read: (options: { path: string }) => Promise<PluginAttachment>
    /** Creates a new file only. Existing files are never overwritten. */
    readonly create: (options: { path: string; base64: string }) => Promise<{ path: string; size: number }>
  }
  readonly notes: {
    readonly read: (options: ReadNoteOptions) => Promise<NoteSnapshot>
    readonly openOrCreate: (options: OpenOrCreateNoteOptions) => Promise<OpenOrCreateResult>
    readonly list: (options?: ListNotesOptions) => Promise<ListNotesResult>
    /** Requires both notes.list and notes.read within the granted folder. */
    readonly search: (options: SearchNotesOptions) => Promise<SearchNotesResult>
    /** Main window only. Close every tab, pane, and separate window for the target first; otherwise EditorBusy. */
    readonly write: (options: WriteNoteOptions) => Promise<WriteNoteResult>
    /** Main window only. Source and destination must be closed in every editor; otherwise EditorBusy. */
    readonly move: (options: MoveNoteOptions) => Promise<void>
    /** Main window only. Close every tab, pane, and separate window for the target first; otherwise EditorBusy. */
    readonly delete: (options: DeleteNoteOptions) => Promise<void>
    readonly onDidChange: (
      listener: (event: NoteChangeEvent) => void | Promise<void>,
    ) => PluginDisposable
  }
  readonly editor: {
    readonly getActiveEditor: () => Promise<ActiveEditorContext | null>
    readonly getSelection: () => Promise<EditorSelection | null>
    readonly getTextSnapshot: (options: GetEditorTextSnapshotOptions) => Promise<EditorTextSnapshot>
    readonly applyEdit: (options: ApplyEditorEditOptions) => Promise<ApplyEditorEditResult>
    /** Atomic, non-overlapping Markdown edits. Currently available in source mode. */
    readonly applyEdits: (options: ApplyEditorEditsOptions) => Promise<ApplyEditorEditResult>
    /** Canonical Markdown offsets; currently available in source mode. */
    readonly setSelection: (options: SetEditorSelectionOptions) => Promise<void>
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
    readonly views: {
      readonly update: (id: string, content: PluginUiDocument) => Promise<void>
      readonly open: (id: string) => Promise<void>
      readonly close: (id: string) => Promise<void>
      readonly focus: (id: string) => Promise<void>
      readonly getState: (id: string) => Promise<PluginViewState>
      readonly onDidChange: (listener: (state: PluginViewState) => void | Promise<void>) => PluginDisposable
    }
    readonly openDialog: (options: PluginDialogOptions) => Promise<PluginDialogHandle>
    readonly updateDialog: (id: string, options: PluginDialogUpdate) => Promise<void>
    /** Closes only the calling plugin's dialog. */
    readonly closeDialog: (id: string) => Promise<void>
    readonly onDidCloseDialog: (listener: (event: PluginDialogCloseEvent) => void | Promise<void>) => PluginDisposable
  }
  readonly network: {
    readonly fetch: (request: PluginNetworkRequest) => Promise<PluginNetworkResponse>
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
  readonly details?: Readonly<Record<string, PluginJsonValue>>

  constructor(
    code: PluginErrorCode,
    message: string,
    details?: Readonly<Record<string, PluginJsonValue>>,
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
