/** The public API version implemented by this release of NoteGen. */
export const PLUGIN_API_VERSION = '0.1.3' as const

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
  keywords?: readonly string[]
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

/** Desktop title bar slots. Left appends after built-ins; right precedes built-ins.
 * Views use ui.views.update/open/close/focus. Compact blocks render inline;
 * larger documents open in a popover. Ordering follows plugin ID then manifest order. */
export type PluginTitleBarLocation = 'title-bar-left' | 'title-bar-center' | 'title-bar-right'

export interface PluginViewContribution {
  id: string
  title: string
  location: 'left-sidebar' | 'right-sidebar' | 'editor-tab' | PluginTitleBarLocation
  icon?: string
}

export type PluginMenuLocation =
  | 'editor/slash'
  | 'editor/context'
  | 'editor/selection'
  | 'editor/toolbar'
  | 'tab/context'
  | 'file/context'
  | 'mobile/writing/overflow'

export interface PluginMenuContribution {
  location: PluginMenuLocation
  command: string
  when?: string
  group?: string
  order?: number
  icon?: string
  enableWhen?: string
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
  /** Omit for a declarative resource package. */
  entry?: string
  resources?: PluginResources
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
  /** Saved file modification time in Unix milliseconds, when supported by the host/filesystem. */
  modifiedAt?: number
  id: string
  path: string
  revision: number
  content: string
}

export interface ReadNoteOptions {
  path: string
}

export interface OpenOrCreateNoteOptions {
  /** Defaults to true. Set false with open: true to open an existing file using only notes.open. Missing files fail. */
  create?: boolean
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
  /** Workspace-relative Markdown path, when available. Never an absolute path. Requires editor.read. */
  path?: string
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
  | { type: 'text' | 'textarea' | 'search' | 'date'; value?: string; placeholder?: string; maxLength?: number }
  | { type: 'number'; value?: number; min?: number; max?: number }
  | { type: 'select' | 'note-picker'; value?: string; options: readonly { label: string; value: string }[] }
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

/** Host-rendered navigation list. Commands receive { generation, itemId? };
 * reorder receives { generation, itemIds } containing the complete new order. */
export interface PluginNavigationListBlock {
  type: 'navigation-list'
  id: string
  generation: string
  label: string
  emptyText: string
  addLabel: string
  removeLabel: string
  reorderLabel: string
  items: readonly { id: string; label: string }[]
  openCommand: string
  addCommand: string
  removeCommand: string
  reorderCommand: string
}

export type PluginUiBlock =
  | PluginExtendedUiBlock
  | PluginNavigationListBlock
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
  readonly fileIcons: {
    /** Replace this plugin's rules atomically. Rules are cleared when its runtime stops. */
    readonly setRules: (rules: readonly PluginFileIconRule[]) => Promise<void>
    readonly clear: () => Promise<void>
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

/** Menu conditions are data, never JavaScript. && binds more tightly than ||.
 * Supported atoms: boolean keys / !key, or key == value / key != value.
 * No parentheses, property access, or executable expressions are accepted. */
export interface PluginMenuContext {
  editor?: 'markdown'
  selection?: boolean
  readOnly?: boolean
  codeBlock?: boolean
  resourceKind?: 'file' | 'folder' | 'root'
  resourceExt?: string
}
const menuBooleanKeys = new Set(['selection', 'readOnly', 'codeBlock'])
const menuStringKeys = new Set(['editor', 'resourceKind', 'resourceExt'])
function parseMenuAtom(atom: string): { key: keyof PluginMenuContext; operator: string; value: string | boolean } | null {
  const boolean = /^(!)?(selection|readOnly|codeBlock)$/.exec(atom.trim())
  if (boolean) return { key: boolean[2] as keyof PluginMenuContext, operator: '==', value: !boolean[1] }
  const comparison = /^(\w+)\s*(==|!=)\s*([\w.-]+)$/.exec(atom.trim())
  if (!comparison) return null
  const [, key, operator, value] = comparison
  if (menuBooleanKeys.has(key) && (value === 'true' || value === 'false')) return { key: key as keyof PluginMenuContext, operator, value: value === 'true' }
  if (menuStringKeys.has(key)) return { key: key as keyof PluginMenuContext, operator, value }
  return null
}
export function isValidPluginMenuCondition(condition: string): boolean {
  return condition.length > 0 && condition.length <= 240
    && condition.split('||').every(group => group.split('&&').every(atom => parseMenuAtom(atom) !== null))
}
export function matchesPluginMenuCondition(condition: string | undefined, context: PluginMenuContext): boolean {
  if (condition === undefined) return true
  if (!isValidPluginMenuCondition(condition)) return false
  return condition.split('||').some(group => group.split('&&').every(atom => {
    const parsed = parseMenuAtom(atom)!
    const actual = context[parsed.key]
    if (actual === undefined) return false
    return parsed.operator === '==' ? actual === parsed.value : actual !== parsed.value
  }))
}

export interface PluginActionConfirmation {
  title: string
  description?: string
  confirmLabel: string
  cancelLabel: string
}
export interface PluginUiAction {
  id: string
  label: string
  command: string
  argument?: PluginCommandArgument
  icon?: string
  iconOnly?: boolean
  confirmation?: PluginActionConfirmation
  disabled?: boolean
  variant?: 'default' | 'secondary' | 'destructive' | 'ghost' | 'outline'
}
export interface PluginItemListBlock {
  type: 'item-list'
  id: string
  generation: string
  label: string
  emptyText: string
  items: readonly { id: string; label: string; description?: string; metadata?: string; icon?: string; checked?: boolean; disabled?: boolean }[]
  openCommand?: string
  toggleCommand?: string
  reorderCommand?: string
  reorderLabel?: string
  actions?: readonly PluginUiAction[]
}
export type PluginExtendedUiBlock =
  | PluginItemListBlock
  | { type: 'layout'; id: string; direction?: 'row' | 'column'; gap?: 'small' | 'medium' | 'large'; blocks: readonly PluginUiBlock[] }
  | { type: 'section'; id: string; title: string; collapsible?: boolean; defaultOpen?: boolean; blocks: readonly PluginUiBlock[] }
  | { type: 'tabs'; id: string; label: string; tabs: readonly { id: string; label: string; blocks: readonly PluginUiBlock[] }[] }
  | { type: 'toolbar'; id: string; label: string; actions: readonly PluginUiAction[] }
  | { type: 'markdown'; text: string }
  | { type: 'badge'; text: string; tone?: 'default' | 'secondary' | 'outline' | 'destructive' }
  | { type: 'empty'; title: string; description?: string; icon?: string }
  | { type: 'loading'; label: string }

/** Walk a UI document with shared depth/count limits, including nested forms. */
export function flattenPluginUiBlocks(blocks: readonly PluginUiBlock[]): PluginUiBlock[] {
  const result: PluginUiBlock[] = []
  function visit(items: readonly PluginUiBlock[], depth: number) {
    if (depth > 6) throw new PluginError('QuotaExceeded', 'Plugin UI nesting exceeds 6 levels')
    for (const block of items) {
      result.push(block)
      if (result.length > 200) throw new PluginError('QuotaExceeded', 'Plugin UI exceeds 200 blocks')
      if (block.type === 'layout' || block.type === 'section') visit(block.blocks, depth + 1)
      if (block.type === 'tabs') for (const tab of block.tabs) visit(tab.blocks, depth + 1)
    }
  }
  visit(blocks, 0)
  const ids = new Set<string>()
  for (const block of result) {
    if ('id' in block && block.id !== undefined) {
      const key = `${block.type}:${block.id}`
      if (ids.has(key)) throw new PluginError('InvalidPath', 'Duplicate UI block ID')
      ids.add(key)
    }
  }
  return result
}

/** Shared validation used by NoteGen and the SDK's in-memory host. */
export function parsePluginUiExtension(value: unknown, parseChildren: (value: unknown) => readonly PluginUiBlock[]): PluginExtendedUiBlock | undefined {
  const parsed = parsePluginUiExtensionValue(value, parseChildren)
  // Validation constructs optional fields explicitly. Omit absent fields from
  // the normalized result so snapshots remain valid JSON on both host paths.
  // Raw input and command arguments are validated before this normalization.
  return parsed === undefined ? undefined : JSON.parse(JSON.stringify(parsed)) as PluginExtendedUiBlock
}

function parsePluginUiExtensionValue(value: unknown, parseChildren: (value: unknown) => readonly PluginUiBlock[]): PluginExtendedUiBlock | undefined {
  const fail = (): never => { throw new PluginError('InvalidPath', 'Malformed extended plugin UI block') }
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail()
  const text = (value: unknown, max = 500, min = 1): string => typeof value === 'string' && value.length >= min && value.length <= max ? value : fail()
  const boolean = (value: unknown): boolean | undefined => value === undefined || typeof value === 'boolean' ? value : fail()
  const choice = <T extends string>(value: unknown, options: readonly T[]): T | undefined => value === undefined ? undefined : options.includes(value as T) ? value as T : fail()
  const keys = (value: Record<string, unknown>, allowed: string[]) => { if (Object.keys(value).some(key => !allowed.includes(key))) fail() }
  const array = (value: unknown, max: number): unknown[] => Array.isArray(value) && value.length <= max ? value : fail()
  const unique = (items: readonly { id: string }[]) => { if (new Set(items.map(item => item.id)).size !== items.length) fail() }
  const optionalText = (value: unknown, max = 500) => value === undefined ? undefined : text(value, max)
  const action = (value: unknown): PluginUiAction => {
    const v = record(value)
    keys(v, ['id', 'label', 'command', 'argument', 'icon', 'iconOnly', 'confirmation', 'disabled', 'variant'])
    // Arguments cross the existing JSON-only RPC boundary; reject non-JSON values here too.
    const json = (value: unknown, depth = 0): boolean => depth <= 12 && (value === null || typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number' && Number.isFinite(value) || Array.isArray(value) && value.every(item => json(item, depth + 1)) || typeof value === 'object' && value !== null && Object.values(value).every(item => json(item, depth + 1)))
    if (v.argument !== undefined && !json(v.argument)) fail()
    let confirmation: PluginActionConfirmation | undefined
    if (v.confirmation !== undefined) {
      const c = record(v.confirmation); keys(c, ['title', 'description', 'confirmLabel', 'cancelLabel'])
      confirmation = { title: text(c.title, 240), description: optionalText(c.description, 2000), confirmLabel: text(c.confirmLabel, 160), cancelLabel: text(c.cancelLabel, 160) }
    }
    if (v.iconOnly === true && !v.icon) fail()
    return { iconOnly: boolean(v.iconOnly), confirmation, id: text(v.id, 160), label: text(v.label, 160), command: text(v.command, 220), argument: v.argument as PluginCommandArgument | undefined, icon: optionalText(v.icon, 80), disabled: boolean(v.disabled), variant: choice(v.variant, ['default', 'secondary', 'destructive', 'ghost', 'outline']) }
  }
  const v = record(value)
  switch (v.type) {
    case 'layout':
      keys(v, ['type', 'id', 'direction', 'gap', 'blocks'])
      return { type: 'layout', id: text(v.id, 160), direction: choice(v.direction, ['row', 'column']), gap: choice(v.gap, ['small', 'medium', 'large']), blocks: parseChildren(v.blocks) }
    case 'section':
      keys(v, ['type', 'id', 'title', 'collapsible', 'defaultOpen', 'blocks'])
      return { type: 'section', id: text(v.id, 160), title: text(v.title, 240), collapsible: boolean(v.collapsible), defaultOpen: boolean(v.defaultOpen), blocks: parseChildren(v.blocks) }
    case 'tabs': {
      keys(v, ['type', 'id', 'label', 'tabs'])
      const tabs = array(v.tabs, 12).map(value => { const tab = record(value); keys(tab, ['id', 'label', 'blocks']); return { id: text(tab.id, 160), label: text(tab.label, 160), blocks: parseChildren(tab.blocks) } })
      if (!tabs.length) fail()
      unique(tabs)
      return { type: 'tabs', id: text(v.id, 160), label: text(v.label, 160), tabs }
    }
    case 'toolbar': {
      keys(v, ['type', 'id', 'label', 'actions'])
      const actions = array(v.actions, 20).map(action); unique(actions)
      return { type: 'toolbar', id: text(v.id, 160), label: text(v.label, 160), actions }
    }
    case 'item-list': {
      keys(v, ['type', 'id', 'generation', 'label', 'emptyText', 'items', 'openCommand', 'toggleCommand', 'reorderCommand', 'reorderLabel', 'actions'])
      const items = array(v.items, 100).map(value => { const item = record(value); keys(item, ['id', 'label', 'description', 'metadata', 'icon', 'checked', 'disabled']); return { id: text(item.id, 1024), label: text(item.label), description: optionalText(item.description, 2000), metadata: optionalText(item.metadata, 1024), icon: optionalText(item.icon, 80), checked: boolean(item.checked), disabled: boolean(item.disabled) } })
      unique(items)
      const actions = v.actions === undefined ? undefined : array(v.actions, 20).map(action)
      if (actions) unique(actions)
      if (v.reorderCommand !== undefined && v.reorderLabel === undefined) fail()
      return { type: 'item-list', id: text(v.id, 160), generation: text(v.generation, 160), label: text(v.label, 160), emptyText: text(v.emptyText, 500, 0), items, actions, openCommand: optionalText(v.openCommand, 220), toggleCommand: optionalText(v.toggleCommand, 220), reorderCommand: optionalText(v.reorderCommand, 220), reorderLabel: optionalText(v.reorderLabel, 160) }
    }
    case 'markdown': keys(v, ['type', 'text']); return { type: 'markdown', text: text(v.text, 20000, 0) }
    case 'badge': keys(v, ['type', 'text', 'tone']); return { type: 'badge', text: text(v.text, 160), tone: choice(v.tone, ['default', 'secondary', 'outline', 'destructive']) }
    case 'empty': keys(v, ['type', 'title', 'description', 'icon']); return { type: 'empty', title: text(v.title, 240), description: optionalText(v.description, 2000), icon: optionalText(v.icon, 80) }
    case 'loading': keys(v, ['type', 'label']); return { type: 'loading', label: text(v.label, 160) }
    default: return undefined
  }
}

/** Declarative extensions. All paths are verified package-relative paths. */
export const PLUGIN_THEME_TOKENS = ['background', 'foreground', 'card', 'cardForeground', 'primary', 'primaryForeground', 'secondary', 'secondaryForeground', 'third', 'thirdForeground', 'muted', 'mutedForeground', 'accent', 'accentForeground', 'border', 'shadow'] as const
export type PluginThemeToken = typeof PLUGIN_THEME_TOKENS[number]
export type PluginThemePalette = Partial<Record<PluginThemeToken, [number, number, number]>>
export interface PluginThemeResource { id: string; name: string; light: PluginThemePalette; dark: PluginThemePalette }
export interface PluginLanguageResource { locale: string; name: string; messages: string }
export interface PluginFileIconRule {
  /** First matching rule wins; providers are ordered by plugin id. */
  kind: 'file' | 'folder'
  path?: string
  extension?: string
  icon: { name: string } | { emoji: string }
}
export interface PluginDocumentPreviewResource {
  id: string
  name: string
  extensions: string[]
  /** Self-contained classic JavaScript bundle; runs in a sandboxed iframe. */
  script: string
  /** Extra package files available through preview.readAsset(). */
  assets?: string[]
}
export interface PluginResources {
  themes?: PluginThemeResource[]
  languages?: PluginLanguageResource[]
  fileIcons?: PluginFileIconRule[]
  documentPreviews?: PluginDocumentPreviewResource[]
}
/** The preview receives a MessagePort via notegen:preview-init, protocol 1.
 * Requests: { id, method: 'readDocument', offset, length } or
 * { id, method: 'readAsset', path }. Responses: { id, result } / { id, error }.
 * Binary results are Uint8Array; reads are limited to 1 MiB per request.
 * No arbitrary paths, network access or parent-window access are granted.
 */
export interface PluginPreviewInit { type: 'notegen:preview-init'; protocol: 1; name: string; sizeLimit: number }

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected resource object')
  return value as Record<string, unknown>
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('Unknown resource field')
}
function text(value: unknown, max = 160): asserts value is string {
  if (typeof value !== 'string' || !value.trim() || [...value].reduce((size, char) => { const point = char.codePointAt(0)!; return size + (point < 128 ? 1 : point < 2048 ? 2 : point < 65536 ? 3 : 4) }, 0) > max || /\p{Cc}/u.test(value)) throw new Error('Invalid resource text')
}
export function validatePluginResourcePath(value: unknown): asserts value is string {
  text(value, 240)
  const parts = value.split('/')
  const forbidden = ['.exe', '.dll', '.dylib', '.so', '.node', '.msi', '.dmg', '.pkg', '.deb', '.rpm', '.apk', '.ipa', '.app', '.jar', '.class', '.bat', '.cmd', '.ps1', '.sh', '.map', '.pem', '.p12', '.pfx']
  if (value.includes('\\') || parts.length > 12 || forbidden.some(suffix => value.toLowerCase().endsWith(suffix)) || parts.some(part => {
    const lower = part.toLowerCase()
    const stem = part.split('.')[0].toUpperCase()
    return !part || part === '.' || part === '..' || part !== part.normalize('NFC') || /[<>:"|?*]/.test(part) || /[. ]$/.test(part)
      || ['.notegen', 'node_modules', '.git', '.hg', '.svn', '.cache', '.env'].includes(lower) || lower.startsWith('.env.')
      || ['CON', 'PRN', 'AUX', 'NUL', 'CLOCK$', 'CONIN$', 'CONOUT$'].includes(stem) || /^(COM|LPT)[1-9¹²³]$/.test(stem)
  })) throw new Error('Invalid resource path')
}
export function pluginResourcePaths(resources?: PluginResources): string[] {
  return [...new Set([...(resources?.languages ?? []).map(x => x.messages), ...(resources?.documentPreviews ?? []).flatMap(x => [x.script, ...(x.assets ?? [])])])]
}
export function validatePluginResources(value: unknown): asserts value is PluginResources {
  const r = object(value)
  keys(r, ['themes', 'languages', 'fileIcons', 'documentPreviews'])
  for (const [kind, raw] of Object.entries(r)) {
    if (!Array.isArray(raw) || raw.length > (kind === 'fileIcons' ? 500 : 30)) throw new Error('Resource limit exceeded')
    const ids = new Set<string>()
    for (const item of raw) {
      const v = object(item)
      if (kind !== 'fileIcons') {
        text(v.name)
        const id = kind === 'languages' ? v.locale : v.id
        text(id)
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id) || ids.has(id)) throw new Error('Invalid or duplicate resource id')
        ids.add(id)
      }
      if (kind === 'themes') {
        keys(v, ['id', 'name', 'light', 'dark'])
        for (const mode of ['light', 'dark']) {
          const palette = object(v[mode])
          keys(palette, [...PLUGIN_THEME_TOKENS])
          for (const hsl of Object.values(palette)) {
            if (!Array.isArray(hsl) || hsl.length !== 3 || hsl.some((n, i) => typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > (i === 0 ? 360 : 100))) throw new Error('Invalid HSL color')
          }
        }
      } else if (kind === 'languages') {
        keys(v, ['locale', 'name', 'messages'])
        if (!/^[a-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(v.locale as string)) throw new Error('Invalid locale')
        validatePluginResourcePath(v.messages)
        if (!v.messages.endsWith('.json')) throw new Error('Language messages must be JSON')
      } else if (kind === 'fileIcons') {
        keys(v, ['kind', 'path', 'extension', 'icon'])
        if (!['file', 'folder'].includes(v.kind as string)) throw new Error('Invalid icon kind')
        if (v.path !== undefined) validatePluginResourcePath(v.path)
        if (v.extension !== undefined && (v.kind !== 'file' || typeof v.extension !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$(?![\s\S])/.test(v.extension))) throw new Error('Invalid icon extension')
        const icon = object(v.icon)
        if (Object.keys(icon).length !== 1) throw new Error('Specify one icon')
        keys(icon, ['name', 'emoji'])
        if (icon.name !== undefined) { text(icon.name, 80); if (!/^[a-z0-9-]+$/.test(icon.name)) throw new Error('Invalid icon name') }
        else { text(icon.emoji, 64); if (icon.emoji.length > 16 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}/u.test(icon.emoji)) throw new Error('Invalid emoji') }
      } else {
        keys(v, ['id', 'name', 'extensions', 'script', 'assets'])
        if (!Array.isArray(v.extensions) || !v.extensions.length || v.extensions.length > 30 || v.extensions.some(x => typeof x !== 'string' || !/^[a-z0-9][a-z0-9-]{0,31}$(?![\s\S])/.test(x))) throw new Error('Invalid preview extensions')
        validatePluginResourcePath(v.script)
        if (!v.script.endsWith('.js')) throw new Error('Preview script must be JavaScript')
        if (v.assets !== undefined) {
          if (!Array.isArray(v.assets) || v.assets.length > 100) throw new Error('Too many preview assets')
          v.assets.forEach(validatePluginResourcePath)
        }
      }
    }
  }
}
/** Structural check; the host additionally validates ICU syntax against its built-in messages. */
export function validatePluginLanguageMessages(value: unknown, depth = 0): void {
  if (depth > 20) throw new Error('Language messages are too deeply nested')
  const messages = object(value)
  for (const [key, child] of Object.entries(messages)) {
    if (!key || key.includes('.') || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('Invalid message key')
    if (typeof child === 'string') { if (child.length > 16384) throw new Error('Message is too long') }
    else validatePluginLanguageMessages(child, depth + 1)
  }
}

export type PluginPreviewRequest =
  | { id: number; method: 'readDocument'; offset: number; length: number }
  | { id: number; method: 'readAsset'; path: string }
export type PluginPreviewResponse = { id: number; result: Uint8Array } | { id: number; error: string }
