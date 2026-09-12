import { createMemoryRecords } from './records.js'
import { validatePluginResources } from '@notegen/plugin-api'
import { parsePluginUiExtension, flattenPluginUiBlocks } from '@notegen/plugin-api'
import {
  PLUGIN_API_VERSION,
  PluginError,
} from '@notegen/plugin-api'
import { createHash } from 'node:crypto'
import type {
  ActiveEditorContext,
  ApplyEditorEditOptions,
  ApplyEditorEditsOptions,
  SetEditorSelectionOptions,
  SearchNotesOptions,
  PluginViewState,
  PluginRecord,
  PluginAiRequest,
  PluginAiStreamEvent,
  PluginPromptOptions,
  PluginPromptResult,
  DeleteNoteOptions,
  EditorActiveChangeEvent,
  EditorContentChangeEvent,
  EditorSelection,
  EditorTextSnapshot,
  GetEditorTextSnapshotOptions,
  ListNotesOptions,
  ListNotesResult,
  MoveNoteOptions,
  NoteChangeEvent,
  NoteSnapshot,
  OpenOrCreateNoteOptions,
  OpenOrCreateResult,
  PluginAbortListener,
  PluginAbortSignal,
  PluginContext,
  PluginDialogOptions,
  PluginDisposable,
  PluginCommandArgument,
  PluginCommandResult,
  PluginJsonValue,
  PluginManifestV1,
  PluginModule,
  PluginPermissionName,
  PluginPermissionScope,
  PluginNetworkRequest,
  PluginNetworkResponse,
  PluginSettingContribution,
  PluginSettingValue,
  PluginStatusBarUpdate,
  PluginUiDocument,
  PluginFormField,
  PluginDialogCloseEvent,
  ReadNoteOptions,
  ResolveDayOptions,
  ResolvedDay,
  WorkspaceInfo,
  WorkspaceChangeEvent,
  WriteNoteOptions,
  WriteNoteResult,
} from '@notegen/plugin-api'

const EMBEDDED_LOCATIONS = new Set(['new-tab', 'document-top', 'document-bottom', 'file-panel', 'editor-toolbar', 'chat-input', 'record-list', 'status-bar-panel'])

const STORAGE_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$(?![\s\S])/
const DAY_START_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$(?![\s\S])/
const CONTROL_CHARACTER = /\p{Cc}/u
const INVALID_PORTABLE_PATH_CHARACTER = /[<>:"|?*]/u
const MAX_NOTE_BYTES = 2 * 1_048_576
const MAX_STORAGE_BYTES = 1_048_576
const MAX_STORAGE_KEYS = 256
const MAX_WORKSPACE_PATH_BYTES = 1_024
const MAX_WORKSPACE_PATH_SEGMENT_BYTES = 240
const MAX_WORKSPACE_PATH_DEPTH = 12
const MAX_NOTICE_LENGTH = 500
const MAX_STATUS_TEXT_LENGTH = 160
const MAX_EDITOR_EDIT_BYTES = 1_048_576
const MAX_NETWORK_BODY_BYTES = 2 * 1_048_576
const MAX_UI_BYTES = 128 * 1_024
const MAX_UI_BLOCKS = 50
const MIN_STATUS_UPDATE_INTERVAL_MS = 100
const MAX_JAVASCRIPT_INTEGER = (1n << 53n) - 1n
const NETWORK_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE'])
const FORBIDDEN_NETWORK_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'expect',
  'host',
  'keep-alive',
  'origin',
  'referer',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
])
const RESERVED_WORKSPACE_PATH_SEGMENTS = new Set([
  '.notegen',
  'node_modules',
  '.git',
  '.hg',
  '.svn',
  '.cache',
])

type StorageAreaName = 'device' | 'workspace'
type LifecycleState = 'idle' | 'activating' | 'active' | 'stopped'

export type PluginTestCallName =
  | 'chat.setDraft'
  | 'log.info'
  | 'log.warning'
  | 'log.error'
  | 'commands.handle'
  | 'commands.execute'
  | 'workspace.getCurrent'
  | 'workspace.onDidChange'
  | 'calendar.resolveDay'
  | 'notes.read'
  | 'fileIcons.setRules'
  | 'fileIcons.clear'
  | 'attachments.read'
  | 'attachments.create'
  | 'notes.openOrCreate'
  | 'notes.list'
  | 'notes.search'
  | 'notes.prepareForWrite'
  | 'notes.write'
  | 'notes.move'
  | 'notes.delete'
  | 'notes.onDidChange'
  | 'editor.getActiveEditor'
  | 'editor.getSelection'
  | 'editor.getTextSnapshot'
  | 'editor.applyEdit'
  | 'editor.applyEdits'
  | 'editor.setSelection'
  | 'editor.onDidChangeActiveEditor'
  | 'editor.onDidChangeContent'
  | 'storage.device.get'
  | 'storage.device.set'
  | 'storage.device.delete'
  | 'storage.workspace.get'
  | 'storage.workspace.set'
  | 'storage.workspace.delete'
  | 'ui.showNotice'
  | 'ui.statusBar.update'
  | 'ui.views.update'
  | 'ui.views.open'
  | 'ui.views.close'
  | 'ui.views.focus'
  | 'ui.views.getState'
  | 'ui.views.onDidChange'
  | 'ui.closeDialog'
  | 'ui.onDidCloseDialog'
  | 'ui.openDialog'
  | 'ui.updateDialog'
  | 'commands.executeHost'
  | 'network.fetch'
  | 'i18n.t'
  | 'settings.get'
  | 'settings.onDidChange'

export interface PluginTestCall {
  readonly sequence: number
  readonly name: PluginTestCallName
  readonly arguments: readonly unknown[]
}

export interface PluginTestNote {
  readonly path: string
  readonly content: string
  readonly id?: string
  readonly revision?: number
}

export interface PluginTestEditorState {
  readonly active?: ActiveEditorContext | null
  readonly selection?: EditorSelection | null
  readonly text?: string
}

export interface PluginTestStorageSeed {
  readonly device?: Readonly<Record<string, PluginJsonValue>>
  readonly workspace?: Readonly<Record<string, PluginJsonValue>>
}

export interface PluginTestScopedPermissionGrant {
  readonly granted: boolean
  readonly paths: readonly string[]
}

export type PluginTestPermissionGrant = boolean | PluginTestScopedPermissionGrant

export interface PluginTestHostOptions {
  readonly manifest: PluginManifestV1
  /** Declared permissions default to unrestricted grants; these values override them. */
  readonly permissions?: Readonly<Partial<Record<PluginPermissionName, PluginTestPermissionGrant>>>
  readonly workspace?: WorkspaceInfo
  /** Existing empty folders that cannot be inferred from seeded notes. */
  readonly folders?: readonly string[]
  readonly notes?: readonly PluginTestNote[]
  readonly records?: readonly PluginRecord[]
  readonly recordTags?: readonly { id: number; name: string }[]
  /** Notes open in any tab, pane, or separate editor window. */
  readonly openNotePaths?: readonly string[]
  readonly surface?: 'main' | 'editor-window'
  readonly storage?: PluginTestStorageSeed
  readonly settings?: Readonly<Record<string, PluginSettingValue>>
  readonly editor?: PluginTestEditorState
  readonly messages?: Readonly<Record<string, string>>
  readonly now?: () => Date
  readonly prompt?: (options: PluginPromptOptions) => Promise<PluginPromptResult>
  readonly aiGenerate?: (request: PluginAiRequest, signal: PluginAbortSignal, update: (text: string) => void) => Promise<string>
  readonly networkFetch?: (request: PluginNetworkRequest) => PluginNetworkResponse | Promise<PluginNetworkResponse>
}

export interface PluginTestStorageSnapshot {
  readonly device: Readonly<Record<string, PluginJsonValue>>
  readonly workspace: Readonly<Record<string, PluginJsonValue>>
}

export interface SetActiveEditorOptions {
  readonly selection?: EditorSelection | null
  /** When supplied, the active editor size is derived from this text. */
  readonly text?: string
}

export interface PluginTestHost {
  readonly manifest: PluginManifestV1
  readonly context: PluginContext
  readonly active: boolean
  readonly callHistory: readonly PluginTestCall[]
  readonly notices: readonly string[]
  readonly statusBar: Readonly<Record<string, PluginStatusBarUpdate>>
  readonly notes: readonly NoteSnapshot[]
  readonly settings: Readonly<Record<string, PluginSettingValue>>
  readonly storage: PluginTestStorageSnapshot
  readonly permissions: Readonly<Partial<Record<PluginPermissionName, PluginTestPermissionGrant>>>
  readonly views: Readonly<Record<string, PluginUiDocument>>
  readonly dialog: (PluginDialogOptions & { id: string }) | null
  setEmbeddedViewContext(id: string, contextId: string | null): Promise<void>
  simulateFormChange(surfaceId: string, formId: string): NonNullable<PluginUiDocument['expectedForm']>

  activate(module: PluginModule): Promise<void>
  deactivate(): Promise<void>
  executeCommand(
    commandId: string,
    argument?: PluginCommandArgument,
  ): Promise<PluginCommandResult>
  setPermission(permission: PluginPermissionName, grant: PluginTestPermissionGrant): void
  setSetting(key: string, value: PluginSettingValue): Promise<void>
  setActiveEditor(
    editor: ActiveEditorContext | null,
    options?: SetActiveEditorOptions,
  ): Promise<void>
  setEditorSelection(selection: EditorSelection | null): void
  setOpenNotePaths(paths: readonly string[]): void
  emitEditorContentChange(
    event: EditorContentChangeEvent,
    text?: string,
  ): Promise<void>
  emitWorkspaceChange(event: WorkspaceChangeEvent): Promise<void>
  emitNoteChange(event: NoteChangeEvent): Promise<void>
  clearCallHistory(): void
}

type CommandHandler = (
  argument?: PluginCommandArgument,
) => PluginCommandResult | Promise<PluginCommandResult>
type ActiveEditorListener = (
  event: EditorActiveChangeEvent,
) => void | Promise<void>
type ContentListener = (
  event: EditorContentChangeEvent,
) => void | Promise<void>
type SettingListener = (
  key: string,
  value: PluginSettingValue,
) => void | Promise<void>
type WorkspaceListener = (event: WorkspaceChangeEvent) => void | Promise<void>
type NoteListener = (event: NoteChangeEvent) => void | Promise<void>

interface AbortListenerRegistration {
  readonly listener: PluginAbortListener
  readonly once: boolean
}

interface NormalizedPermissionGrant {
  readonly granted: boolean
  /** `null` is the backwards-compatible unrestricted test grant. */
  readonly paths: readonly string[] | null
}

class TestAbortSignal implements PluginAbortSignal {
  aborted = false
  reason: unknown = undefined

  private readonly listeners = new Map<PluginAbortListener, AbortListenerRegistration>()

  throwIfAborted = (): void => {
    if (!this.aborted) return
    if (this.reason instanceof Error) throw this.reason
    throw new PluginError('Cancelled', 'The plugin test host has been stopped')
  }

  addEventListener = (
    type: 'abort',
    listener: PluginAbortListener,
    options?: { once?: boolean },
  ): void => {
    if (type !== 'abort') return
    this.listeners.set(listener, {
      listener,
      once: options?.once === true,
    })
  }

  removeEventListener = (
    type: 'abort',
    listener: PluginAbortListener,
  ): void => {
    if (type !== 'abort') return
    this.listeners.delete(listener)
  }

  abort(reason: unknown): void {
    if (this.aborted) return
    this.aborted = true
    this.reason = reason

    for (const registration of [...this.listeners.values()]) {
      try {
        registration.listener()
      } catch {
        // Abort notification must not prevent the host from finishing cleanup.
      }
      if (registration.once) this.listeners.delete(registration.listener)
    }
  }
}

class MemoryPluginTestHost implements PluginTestHost {
  readonly manifest: PluginManifestV1
  readonly context: PluginContext

  private lifecycle: LifecycleState = 'idle'
  private module: PluginModule | undefined
  private readonly abortSignal = new TestAbortSignal()
  private readonly workspaceInfo: WorkspaceInfo
  private readonly now: () => Date
  private readonly messages: Readonly<Record<string, string>>

  private readonly commandIds: ReadonlySet<string>
  private readonly statusBarIds: ReadonlySet<string>
  private readonly settingDeclarations = new Map<string, PluginSettingContribution>()
  private readonly permissionGrants = new Map<PluginPermissionName, NormalizedPermissionGrant>()

  private readonly commandHandlers = new Map<string, CommandHandler>()
  private readonly activeEditorListeners = new Set<ActiveEditorListener>()
  private readonly contentListeners = new Set<ContentListener>()
  private readonly settingListeners = new Set<SettingListener>()
  private readonly workspaceListeners = new Set<WorkspaceListener>()
  private readonly noteListeners = new Set<NoteListener>()

  private readonly noteStore = new Map<string, NoteSnapshot>()
  private readonly attachmentStore = new Map<string, string>()
  private readonly knownFolders = new Set<string>([''])
  private readonly deviceStorage = new Map<string, PluginJsonValue>()
  private readonly workspaceStorage = new Map<string, PluginJsonValue>()
  private readonly settingValues = new Map<string, PluginSettingValue>()
  private readonly noticeMessages: string[] = []
  private readonly statusBarStates = new Map<string, PluginStatusBarUpdate>()
  private readonly statusUpdateTimes = new Map<string, number>()
  private readonly pendingStatusUpdates = new Map<string, {
    state: PluginStatusBarUpdate
    timer: ReturnType<typeof setTimeout> | null
  }>()
  private readonly calls: PluginTestCall[] = []
  private readonly recordApi: PluginContext['records']
  private chatDraft = ''
  private promptPending = false
  private readonly promptHandler?: PluginTestHostOptions['prompt']
  private readonly aiRequests = new Map<string, TestAbortSignal>()
  private readonly aiListeners = new Set<(event: PluginAiStreamEvent) => void | Promise<void>>()
  private readonly aiGenerate?: PluginTestHostOptions['aiGenerate']
  private readonly embeddedContexts = new Map<string, string>()
  private readonly viewStates = new Map<string, PluginUiDocument>()
  private readonly hiddenTitleBarViews = new Set<string>()
  private readonly visibleViews = new Map<PluginViewState['location'], string>()
  private readonly viewListeners = new Set<(state: PluginViewState) => void | Promise<void>>()
  private dialogState: (PluginDialogOptions & { id: string }) | null = null
  private dialogSequence = 0
  private formSequence = 0
  private formSnapshots = new Map<string, { surface: string; resetKey?: string; formId: string; generation: string; revision: number }>()
  private readonly dialogCloseListeners = new Set<(event: PluginDialogCloseEvent) => void | Promise<void>>()
  private readonly networkFetch?: PluginTestHostOptions['networkFetch']
  private readonly surface: 'main' | 'editor-window'
  private openNotePaths = new Set<string>()

  private editor: ActiveEditorContext | null
  private editorSelection: EditorSelection | null
  private editorSnapshot: EditorTextSnapshot | null
  private nextSequence = 1

  constructor(options: PluginTestHostOptions) {
    this.manifest = options.manifest
    this.workspaceInfo = cloneWorkspace(options.workspace ?? {
      id: 'test-workspace',
      name: 'Test Workspace',
    })
    this.now = options.now ?? (() => new Date(0))
    this.messages = options.messages ?? {}
    this.networkFetch = options.networkFetch
    this.surface = options.surface ?? 'main'
    this.setOpenNotePaths(options.openNotePaths ?? [])

    this.commandIds = new Set(
      (this.manifest.contributes.commands ?? []).map((command) => command.id),
    )
    this.statusBarIds = new Set(
      (this.manifest.contributes.statusBar ?? []).map((item) => item.id),
    )

    for (const declaration of this.manifest.contributes.settings ?? []) {
      this.settingDeclarations.set(declaration.key, declaration)
      this.settingValues.set(declaration.key, declaration.default)
    }

    for (const permission of Object.keys(this.manifest.permissions) as PluginPermissionName[]) {
      this.permissionGrants.set(permission, normalizePermissionGrant(true, permission))
    }
    for (const permission of Object.keys(options.permissions ?? {}) as PluginPermissionName[]) {
      if (!hasOwn(this.manifest.permissions, permission)) {
        throw new PluginError(
          'InvalidManifest',
          `Permission override "${permission}" is not declared by the plugin`,
          { permission },
        )
      }
      const grant = options.permissions?.[permission]
      if (grant !== undefined) {
        this.permissionGrants.set(permission, normalizePermissionGrant(grant, permission))
      }
    }

    for (const note of options.notes ?? []) {
      const path = assertNotePath(note.path)
      this.noteStore.set(path, {
        id: note.id ?? `${this.workspaceInfo.id}:${path}`,
        path,
        revision: note.revision ?? contentRevision(note.content),
        content: note.content,
      })
      this.rememberParentFolders(path)
    }
    for (const folder of options.folders ?? []) {
      this.rememberFolder(folder)
    }

    this.seedStorage(this.deviceStorage, options.storage?.device)
    this.seedStorage(this.workspaceStorage, options.storage?.workspace)
    this.assertSeededStorageQuota()

    for (const [key, value] of Object.entries(options.settings ?? {})) {
      this.assertSettingValue(key, value)
      this.settingValues.set(key, value)
    }

    this.editor = cloneActiveEditor(options.editor?.active ?? null)
    if (this.editor && options.editor?.text !== undefined) {
      this.editor.size = measureText(options.editor.text)
    }
    this.editorSelection = null
    this.setEditorSelection(options.editor?.selection ?? null)
    this.editorSnapshot = this.createInitialEditorSnapshot(
      this.editor,
      options.editor?.text ?? '',
    )

    this.promptHandler = options.prompt
    this.aiGenerate = options.aiGenerate
    this.recordApi = createMemoryRecords({
      ...(options.records ? { records: options.records } : {}),
      ...(options.recordTags ? { tags: options.recordTags } : {}),
      guard: permission => { this.assertUsable(); this.assertPermission(permission); if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Records require the main window') },
      now: () => (options.now?.() ?? new Date()).getTime(),
    })
    this.context = this.createContext()
  }

  get active(): boolean {
    return this.lifecycle === 'active'
  }

  get callHistory(): readonly PluginTestCall[] {
    return Object.freeze([...this.calls])
  }

  get notices(): readonly string[] {
    return Object.freeze([...this.noticeMessages])
  }

  get statusBar(): Readonly<Record<string, PluginStatusBarUpdate>> {
    const result = emptyRecord<PluginStatusBarUpdate>()
    for (const [id, state] of this.statusBarStates) {
      result[id] = Object.freeze({ ...state })
    }
    return Object.freeze(result)
  }

  get views(): Readonly<Record<string, PluginUiDocument>> {
    const result = emptyRecord<PluginUiDocument>()
    for (const [id, document] of this.viewStates) {
      result[id] = cloneFrozenUiDocument(document)
    }
    return Object.freeze(result)
  }

  get dialog(): (PluginDialogOptions & { id: string }) | null {
    return this.dialogState === null ? null : cloneJsonValue(this.dialogState) as unknown as PluginDialogOptions & { id: string }
  }

  get notes(): readonly NoteSnapshot[] {
    return Object.freeze(
      [...this.noteStore.values()]
        .sort((left, right) => compareStrings(left.path, right.path))
        .map(cloneNote),
    )
  }

  get settings(): Readonly<Record<string, PluginSettingValue>> {
    const result = emptyRecord<PluginSettingValue>()
    for (const [key, value] of this.settingValues) result[key] = value
    return Object.freeze(result)
  }

  get storage(): PluginTestStorageSnapshot {
    return Object.freeze({
      device: storageRecord(this.deviceStorage),
      workspace: storageRecord(this.workspaceStorage),
    })
  }

  get permissions(): Readonly<Partial<Record<PluginPermissionName, PluginTestPermissionGrant>>> {
    const result: Partial<Record<PluginPermissionName, PluginTestPermissionGrant>> = emptyRecord<PluginTestPermissionGrant>()
    for (const [permission, grant] of this.permissionGrants) {
      result[permission] = grant.paths === null
        ? grant.granted
        : Object.freeze({
            granted: grant.granted,
            paths: Object.freeze([...grant.paths]),
          })
    }
    return Object.freeze(result)
  }

  async activate(module: PluginModule): Promise<void> {
    if (this.lifecycle !== 'idle') {
      throw new PluginError(
        'AlreadyRegistered',
        'This plugin test host can activate exactly one plugin instance',
      )
    }

    this.lifecycle = 'activating'
    this.module = module

    try {
      await this.awaitWhileActive(() => module.activate(this.context))
      if (this.lifecycle === 'activating') {
        this.lifecycle = 'active'
        await this.awaitWhileActive(() => (
          this.emitWorkspaceChange({ previous: null, current: cloneWorkspace(this.workspaceInfo) })
        ))
      }
    } catch (error: unknown) {
      this.stop(new PluginError('Cancelled', 'Plugin activation failed'))
      throw error
    }
  }

  async deactivate(): Promise<void> {
    if (this.lifecycle === 'idle' || this.lifecycle === 'stopped') return

    const module = this.module
    this.stop(new PluginError('Cancelled', 'Plugin deactivated'))
    try {
      await module?.deactivate?.()
    } finally {
      this.clearRegistrations()
      this.module = undefined
    }
  }

  async executeCommand(
    commandId: string,
    argument?: PluginCommandArgument,
  ): Promise<PluginCommandResult> {
    this.record('commands.execute', [commandId, argument])
    this.assertUsable()

    if (!this.commandIds.has(commandId)) {
      throw new PluginError(
        'NotFound',
        `Unknown command "${commandId}"`,
        { commandId },
      )
    }
    const handler = this.commandHandlers.get(commandId)
    if (!handler) {
      throw new PluginError(
        'RuntimeFailure',
        `No active handler is registered for command "${commandId}"`,
        { commandId },
      )
    }
    const safeArgument = argument === undefined
      ? undefined
      : cloneJsonValue(argument, nonJsonCommandArgument)
    const result = await this.awaitWhileActive(() => handler(safeArgument))
    return result === undefined
      ? undefined
      : cloneJsonValue(result, nonJsonCommandResult)
  }

  setPermission(
    permission: PluginPermissionName,
    grant: PluginTestPermissionGrant,
  ): void {
    if (!hasOwn(this.manifest.permissions, permission)) {
      throw new PluginError(
        'InvalidManifest',
        `Permission "${permission}" is not declared by the plugin`,
        { permission },
      )
    }
    this.permissionGrants.set(permission, normalizePermissionGrant(grant, permission))
  }

  async setSetting(key: string, value: PluginSettingValue): Promise<void> {
    this.assertSettingValue(key, value)
    const previous = this.settingValues.get(key)
    this.settingValues.set(key, value)
    if (previous === value || !this.active) return

    await Promise.allSettled(
      [...this.settingListeners].map((listener) => (
        Promise.resolve().then(() => listener(key, value))
      )),
    )
  }

  setOpenNotePaths(paths: readonly string[]): void {
    this.openNotePaths = new Set(paths.map(assertNotePath))
  }

  async setActiveEditor(
    editor: ActiveEditorContext | null,
    options: SetActiveEditorOptions = {},
  ): Promise<void> {
    const previous = cloneActiveEditor(this.editor)
    const next = cloneActiveEditor(editor)
    const nextSelection = cloneSelection(options.selection ?? null)
    assertSelectionMatchesEditor(nextSelection, next)
    const nextText = options.text
      ?? (next !== null
        && this.editorSnapshot !== null
        && next.editorId === this.editorSnapshot.editorId
        && next.documentId === this.editorSnapshot.documentId
        ? this.editorSnapshot.text
        : '')

    if (next && options.text !== undefined) {
      next.size = measureText(options.text)
    }

    this.editor = next
    this.editorSelection = nextSelection
    this.editorSnapshot = this.createInitialEditorSnapshot(
      this.editor,
      nextText,
    )

    if (!this.active || !this.hasPermission('editor.read')) return

    const event: EditorActiveChangeEvent = {
      previous,
      current: cloneActiveEditor(this.editor),
    }
    await Promise.allSettled(
      [...this.activeEditorListeners].map((listener) => (
        Promise.resolve().then(() => listener(event))
      )),
    )
  }

  setEditorSelection(selection: EditorSelection | null): void {
    const nextSelection = cloneSelection(selection)
    assertSelectionMatchesEditor(nextSelection, this.editor)
    this.editorSelection = nextSelection
  }

  async emitEditorContentChange(
    event: EditorContentChangeEvent,
    text?: string,
  ): Promise<void> {
    if (!this.editor
      || this.editor.editorId !== event.editorId
      || this.editor.documentId !== event.documentId) {
      throw new PluginError(
        'NotFound',
        `Editor "${event.editorId}" is not active`,
        { editorId: event.editorId },
      )
    }
    if (event.revision < this.editor.revision) {
      throw new PluginError(
        'StaleRevision',
        'Content event revision is older than the active editor',
        {
          expectedAtLeast: this.editor.revision,
          actualRevision: event.revision,
        },
      )
    }

    this.editor = {
      ...this.editor,
      revision: event.revision,
      composing: event.composing,
      size: { ...event.size },
    }
    this.editorSnapshot = {
      editorId: event.editorId,
      documentId: event.documentId,
      revision: event.revision,
      format: 'markdown',
      text: text ?? this.editorSnapshot?.text ?? '',
    }
    if (this.editorSelection?.editorId === event.editorId) {
      this.editorSelection = null
    }

    if (!this.active || !this.hasPermission('editor.read')) return
    const clonedEvent = cloneContentEvent(event)
    await Promise.allSettled(
      [...this.contentListeners].map((listener) => (
        Promise.resolve().then(() => listener(clonedEvent))
      )),
    )
  }

  async emitWorkspaceChange(event: WorkspaceChangeEvent): Promise<void> {
    if (!this.active) return
    await Promise.allSettled([...this.workspaceListeners].map((listener) => (
      Promise.resolve().then(() => listener({ previous: event.previous && { ...event.previous }, current: { ...event.current } }))
    )))
  }

  async emitNoteChange(event: NoteChangeEvent): Promise<void> {
    if (!this.active) return
    await this.dispatchNoteChange(event)
  }

  clearCallHistory(): void {
    this.calls.length = 0
    this.nextSequence = 1
  }

  private createContext(): PluginContext {
    const context: PluginContext = {
      plugin: Object.freeze({
        id: this.manifest.id,
        version: this.manifest.version,
        apiVersion: PLUGIN_API_VERSION,
        capabilities: this.surface === 'main' ? ['embedded-views', 'records', 'chat-draft', 'ai-generation', 'ui-prompts'] as const : [],
      }),
      log: Object.freeze({
        info: (message: string) => this.record('log.info', [String(message).slice(0, 1000)]),
        warning: (message: string) => this.record('log.warning', [String(message).slice(0, 1000)]),
        error: (message: string) => this.record('log.error', [String(message).slice(0, 1000)]),
      }),
      signal: this.abortSignal,
      records: this.recordApi,
      ai: {
        generate: async request => {
          this.assertUsable(); this.assertPermission('ai.generate')
          if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'AI requires the main window')
          if (!/^[A-Za-z0-9._-]{1,64}$/.test(request.requestId) || typeof request.prompt !== 'string' || !request.prompt || request.prompt.length > 20_000 || (request.system !== undefined && (typeof request.system !== 'string' || request.system.length > 10_000)) || (request.maxOutputTokens !== undefined && (!Number.isInteger(request.maxOutputTokens) || request.maxOutputTokens < 1 || request.maxOutputTokens > 4096))) throw new PluginError('InvalidPath', 'Invalid AI request')
          if (this.aiRequests.size) throw new PluginError('QuotaExceeded', 'Only one AI request per plugin may run at once')
          if (!this.aiGenerate) throw new PluginError('NotFound', 'Provide aiGenerate in the test host options')
          const signal = new TestAbortSignal()
          this.aiRequests.set(request.requestId, signal)
          try {
            const text = await this.aiGenerate(request, signal, text => {
              this.assertUsable(); this.assertPermission('ai.generate'); signal.throwIfAborted()
              if (text.length > 128 * 1024) throw new PluginError('QuotaExceeded', 'AI response exceeds its limit')
              for (const listener of this.aiListeners) void Promise.resolve().then(() => listener({ requestId: request.requestId, text })).catch(() => undefined)
            })
            this.assertUsable(); this.assertPermission('ai.generate'); signal.throwIfAborted()
            if (text.length > 128 * 1024) throw new PluginError('QuotaExceeded', 'AI response exceeds its limit')
            return { text }
          } finally { this.aiRequests.delete(request.requestId) }
        },
        cancel: async id => { this.assertUsable(); this.assertPermission('ai.generate'); this.aiRequests.get(id)?.abort(new PluginError('Cancelled', 'AI request cancelled')) },
        onDidStream: listener => { this.assertUsable(); this.assertPermission('ai.generate'); return addDisposableListener(this.aiListeners, listener) },
      },
      chat: {
        setDraft: async options => {
          this.assertUsable(); this.assertPermission('chat.write')
          if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Chat requires the main window')
          if (typeof options.text !== 'string' || options.text.length > 20_000 || (options.mode !== undefined && !['append', 'replace'].includes(options.mode)) || (options.overwrite !== undefined && typeof options.overwrite !== 'boolean')) throw new PluginError('InvalidPath', 'Invalid chat draft')
          if (options.mode === 'replace' && this.chatDraft && !options.overwrite) throw new PluginError('Conflict', 'Chat draft is not empty')
          const next = options.mode === 'replace' ? options.text : this.chatDraft + options.text
          if (next.length > 20_000) throw new PluginError('QuotaExceeded', 'Chat draft exceeds its limit')
          this.chatDraft = next
          this.record('chat.setDraft', [options])
        },
      },
      commands: Object.freeze({
        executeHost: async command => {
          this.record('commands.executeHost', [command])
          this.assertUsable()
          if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Host navigation requires the main window')
          if (!['app.openSearch', 'app.openSettings', 'app.openPluginSettings'].includes(command)) throw new PluginError('PermissionDenied', 'Host command is not allowlisted')
        },
        handle: (commandId, handler) => this.handleCommand(commandId, handler),
      }),
      workspace: Object.freeze({
        getCurrent: async () => {
          this.record('workspace.getCurrent')
          this.assertUsable()
          return cloneWorkspace(this.workspaceInfo)
        },
        onDidChange: (listener) => {
          this.record('workspace.onDidChange')
          this.assertUsable()
          return addDisposableListener(this.workspaceListeners, listener)
        },
      }),
      calendar: Object.freeze({
        resolveDay: async (options) => {
          this.record('calendar.resolveDay', [options])
          this.assertUsable()
          return this.resolveDay(options)
        },
      }),
      fileIcons: Object.freeze({
        setRules: async rules => { this.assertUsable(); validatePluginResources({ fileIcons: rules }); this.record('fileIcons.setRules', [rules]) },
        clear: async () => { this.assertUsable(); this.record('fileIcons.clear') },
      }),
      attachments: Object.freeze({
        read: async ({ path }) => {
          this.record('attachments.read', [{ path }])
          this.assertUsable()
          path = assertAttachmentPath(path)
          this.assertPermission('attachments.read', path)
          const base64 = this.attachmentStore.get(path)
          if (base64 === undefined) throw new PluginError('NotFound', 'Attachment does not exist')
          return { path, base64, size: Buffer.from(base64, 'base64').length }
        },
        create: async ({ path, base64 }) => {
          this.record('attachments.create', [{ path, base64 }])
          this.assertUsable()
          path = assertAttachmentPath(path)
          this.assertPermission('attachments.create', path)
          if (typeof base64 !== 'string' || base64.length > 1_398_104) throw new PluginError('QuotaExceeded', 'Attachment exceeds 1 MiB')
          const bytes = Buffer.from(base64, 'base64')
          if (bytes.toString('base64') !== base64) throw new PluginError('InvalidPath', 'Invalid standard Base64')
          if (bytes.length > 1_048_576) throw new PluginError('QuotaExceeded', 'Attachment exceeds 1 MiB')
          if (this.attachmentStore.has(path)) throw new PluginError('InvalidPath', 'Attachment already exists; choose another path')
          this.attachmentStore.set(path, base64)
          this.rememberParentFolders(path)
          return { path, size: bytes.length }
        },
      }),
      notes: Object.freeze({
        read: async (options) => this.readNote(options),
        openOrCreate: async (options) => this.openOrCreateNote(options),
        list: async (options) => this.listNotes(options),
        search: async (options) => this.searchNotes(options),
        prepareForWrite: async (options) => {
          this.record('notes.prepareForWrite', [options])
          this.assertUsable()
          const path = assertNotePath(options.path)
          for (const permission of ['notes.read', 'notes.write', 'notes.open'] as const) this.assertPermission(permission, path)
          if (this.surface === 'editor-window') throw new PluginError('EditorBusy', 'Use the main window')
          const note = await this.readNote({ path })
          if (this.editor?.path?.toLowerCase() === path.toLowerCase()) {
            if (this.editor.composing) throw new PluginError('EditorBusy', 'Finish composing before switching views')
            this.editor = null; this.editorSelection = null; this.editorSnapshot = null
          }
          for (const open of this.openNotePaths) if (open.toLowerCase() === path.toLowerCase()) this.openNotePaths.delete(open)
          return note
        },
        write: async (options) => this.writeNote(options),
        move: async (options) => this.moveNote(options),
        delete: async (options) => this.deleteNote(options),
        onDidChange: (listener) => {
          this.record('notes.onDidChange')
          this.assertUsable()
          if (!this.hasPermission('notes.read') && !this.hasPermission('notes.list')) {
            throw new PluginError('PermissionDenied', 'Note events require notes.read or notes.list')
          }
          return addDisposableListener(this.noteListeners, listener)
        },
      }),
      editor: Object.freeze({
        getActiveEditor: async () => {
          this.record('editor.getActiveEditor')
          this.assertUsable()
          this.assertPermission('editor.read')
          return cloneActiveEditor(this.editor)
        },
        getSelection: async () => {
          this.record('editor.getSelection')
          this.assertUsable()
          this.assertPermission('editor.read')
          return cloneSelection(this.editorSelection)
        },
        getTextSnapshot: async (options) => this.getTextSnapshot(options),
        applyEdit: async (options) => this.applyEditorEdit(options),
        applyEdits: async (options) => this.applyEditorEdits(options),
        setSelection: async (options) => this.applyEditorSelection(options),
        onDidChangeActiveEditor: (listener) => {
          this.record('editor.onDidChangeActiveEditor')
          this.assertUsable()
          this.assertPermission('editor.read')
          return addDisposableListener(this.activeEditorListeners, listener)
        },
        onDidChangeContent: (listener) => {
          this.record('editor.onDidChangeContent')
          this.assertUsable()
          this.assertPermission('editor.read')
          return addDisposableListener(this.contentListeners, listener)
        },
      }),
      storage: Object.freeze({
        device: this.createStorageArea('device'),
        workspace: this.createStorageArea('workspace'),
      }),
      ui: Object.freeze({
        prompt: async options => {
          this.assertUsable()
          if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Prompts require the main window')
          if (this.promptPending || this.dialogState) throw new PluginError('Conflict', 'A plugin dialog is already open')
          if (!options || !['confirm', 'select'].includes(options.type) || typeof options.title !== 'string' || !options.title || options.title.length > 240 || (options.description !== undefined && (typeof options.description !== 'string' || options.description.length > 2000)) || (options.confirmLabel !== undefined && (typeof options.confirmLabel !== 'string' || !options.confirmLabel || options.confirmLabel.length > 80))) throw new PluginError('InvalidPath', 'Invalid prompt options')
          if (options.type === 'select' && (!Array.isArray(options.options) || !options.options.length || options.options.length > 100 || new Set(options.options.map(item => item.value)).size !== options.options.length || options.options.some(item => typeof item.value !== 'string' || !item.value || item.value.length > 160 || typeof item.label !== 'string' || !item.label || item.label.length > 240))) throw new PluginError('InvalidPath', 'Invalid prompt choices')
          this.promptPending = true
          try {
            const result = await (this.promptHandler?.(options) ?? Promise.resolve(null))
            this.assertUsable()
            if (result !== null) {
              if (options.type === 'confirm') {
                if (typeof result !== 'boolean') throw new PluginError('InvalidPath', 'Invalid confirmation result')
              } else {
                const choices = options.options
                if (!Array.isArray(result) || (!options.multiple && result.length !== 1) || new Set(result).size !== result.length || result.some(value => !choices.some(item => item.value === value))) throw new PluginError('InvalidPath', 'Invalid selection result')
              }
            }
            return result
          }
          finally { this.promptPending = false }
        },
        showNotice: async (message) => {
          this.record('ui.showNotice', [message])
          this.assertUsable()
          this.noticeMessages.push(message.slice(0, MAX_NOTICE_LENGTH))
        },
        statusBar: Object.freeze<PluginContext['ui']['statusBar']>({
          update: async (id, state) => {
            this.record('ui.statusBar.update', [id, state])
            this.assertUsable()
            if (!this.statusBarIds.has(id)) {
              throw new PluginError(
                'PermissionDenied',
                `Status-bar item "${id}" is not declared by the plugin`,
                { id },
              )
            }
            const timestamp = this.now().getTime()
            const previous = this.statusUpdateTimes.get(id)
            const normalizedState: PluginStatusBarUpdate = {
              visible: state.visible,
              ...(state.text === undefined
                ? {}
                : { text: state.text.slice(0, MAX_STATUS_TEXT_LENGTH) }),
              ...(state.compactText === undefined
                ? {}
                : { compactText: state.compactText.slice(0, MAX_STATUS_TEXT_LENGTH) }),
              ...(state.tooltip === undefined
                ? {}
                : { tooltip: state.tooltip.slice(0, MAX_STATUS_TEXT_LENGTH) }),
              ...(state.accessibleLabel === undefined
                ? {}
                : { accessibleLabel: state.accessibleLabel.slice(0, MAX_STATUS_TEXT_LENGTH) }),
              ...(state.busy === undefined ? {} : { busy: state.busy }),
            }
            const pending = this.pendingStatusUpdates.get(id)
            if (pending) {
              pending.state = normalizedState
              return
            }
            const elapsed = previous === undefined
              ? MIN_STATUS_UPDATE_INTERVAL_MS
              : timestamp - previous
            if (elapsed >= MIN_STATUS_UPDATE_INTERVAL_MS) {
              this.statusUpdateTimes.set(id, timestamp)
              this.statusBarStates.set(id, normalizedState)
              return
            }
            const scheduled: {
              state: PluginStatusBarUpdate
              timer: ReturnType<typeof setTimeout> | null
            } = {
              state: normalizedState,
              timer: null,
            }
            scheduled.timer = setTimeout(() => {
              this.pendingStatusUpdates.delete(id)
              if (!this.active) return
              this.statusUpdateTimes.set(id, this.now().getTime())
              this.statusBarStates.set(id, scheduled.state)
            }, Math.max(0, MIN_STATUS_UPDATE_INTERVAL_MS - elapsed))
            this.pendingStatusUpdates.set(id, scheduled)
          },
        }),
        views: Object.freeze<PluginContext['ui']['views']>({
          update: async (id, content) => {
            this.record('ui.views.update', [id, content])
            this.assertUsable()
            const state = this.getViewState(id)
            if (EMBEDDED_LOCATIONS.has(state.location) && (!state.visible || !state.contextId || content.expectedContextId !== state.contextId)) {
              throw new PluginError('StaleRevision', 'Embedded view context changed')
            }
            if (!(this.manifest.contributes.views ?? []).some((view) => view.id === id)) {
              throw new PluginError('PermissionDenied', `View "${id}" is not declared by the plugin`)
            }
            const parsed = this.validateUiDocument(content)
            this.syncFormSnapshots(id, parsed)
            this.viewStates.set(id, { blocks: parsed.blocks })
          },
          open: async (id) => {
            this.record('ui.views.open', [id])
            this.assertUsable()
            if (!(this.manifest.contributes.views ?? []).some((view) => view.id === id)) {
              throw new PluginError('PermissionDenied', `View "${id}" is not declared by the plugin`)
            }
            await this.changeViewVisibility(id, true)
          },
          close: async (id) => { this.record('ui.views.close', [id]); await this.changeViewVisibility(id, false) },
          focus: async (id) => { this.record('ui.views.focus', [id]); await this.changeViewVisibility(id, true) },
          getState: async (id) => { this.record('ui.views.getState', [id]); return this.getViewState(id) },
          onDidChange: (listener) => {
            this.record('ui.views.onDidChange')
            this.assertUsable()
            if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Views require the main window')
            return addDisposableListener(this.viewListeners, listener)
          },
        }),
        openDialog: async (options) => {
          this.record('ui.openDialog', [options])
          this.assertUsable()
          if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Dialogs require the main window')
          const parsed = this.validateDialog(options)
          if (this.promptPending) throw new PluginError('Conflict', 'A prompt is already open')
          if (parsed.content.expectedForm) throw new PluginError('StaleRevision', 'A new dialog has no form snapshot')
          if (this.dialogState && parsed.replaceId !== this.dialogState.id) throw new PluginError('Conflict', 'A dialog is already open')
          if (!this.dialogState && parsed.replaceId !== undefined) throw new PluginError('NotFound', 'The dialog to replace is no longer open')
          if (this.dialogState) this.dismissDialog(this.dialogState.id, 'replaced')
          const id = `dialog:${++this.dialogSequence}`
          this.syncFormSnapshots(id, parsed.content)
          this.dialogState = { ...parsed, content: { blocks: parsed.content.blocks }, id }
          return { id }
        },
        closeDialog: async id => {
          this.record('ui.closeDialog', [id])
          this.assertUsable()
          if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Dialogs require the main window')
          this.dismissDialog(id, 'programmatic')
        },
        updateDialog: async (id, options) => {
          this.record('ui.updateDialog', [id, options])
          this.assertUsable()
          if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Dialogs require the main window')
          if (!this.dialogState || this.dialogState.id !== id) throw new PluginError('NotFound', 'Dialog is no longer open')
          if (!isPlainRecord(options) || !hasOnlyKeys(options, new Set(['title', 'description', 'content', 'closeLabel']))) throw new PluginError('InvalidPath', 'Invalid dialog update')
          const parsed = this.validateDialog(options)
          this.syncFormSnapshots(id, parsed.content)
          this.dialogState = { ...parsed, content: { blocks: parsed.content.blocks }, id }
        },
        onDidCloseDialog: listener => {
          this.record('ui.onDidCloseDialog')
          this.assertUsable()
          if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Dialogs require the main window')
          return addDisposableListener(this.dialogCloseListeners, listener)
        },
      }),
      network: Object.freeze({
        fetch: async (request) => {
          this.record('network.fetch', [request])
          this.assertUsable()
          const normalizedRequest = normalizeNetworkRequest(request)
          const origin = new URL(normalizedRequest.url).origin.toLowerCase()
          this.assertPermission('network.fetch', origin)
          const networkFetch = this.networkFetch
          if (!networkFetch) throw new PluginError('UnavailableOnPlatform', 'No test network handler is configured')
          const response = await this.awaitWhileActive(() => networkFetch(normalizedRequest))
          this.assertPermission('network.fetch', origin)
          return normalizeNetworkResponse(response)
        },
      }),
      i18n: Object.freeze({
        t: (key, values) => {
          this.record('i18n.t', [key, values])
          this.assertUsable()
          return interpolate(this.messages[key] ?? key, values)
        },
      }),
      settings: Object.freeze({
        get: (key) => {
          this.record('settings.get', [key])
          this.assertUsable()
          return this.settingValues.get(key)
        },
        onDidChange: (listener) => {
          this.record('settings.onDidChange')
          this.assertUsable()
          return addDisposableListener(this.settingListeners, listener)
        },
      }),
    }
    return Object.freeze(context)
  }

  private handleCommand(
    commandId: string,
    handler: CommandHandler,
  ): PluginDisposable {
    this.record('commands.handle', [commandId])
    this.assertUsable()
    if (!this.commandIds.has(commandId)) {
      throw new PluginError(
        'PermissionDenied',
        `Command "${commandId}" is not declared by the plugin`,
        { commandId },
      )
    }
    if (this.commandHandlers.has(commandId)) {
      throw new PluginError(
        'AlreadyRegistered',
        `Command "${commandId}" already has a handler`,
        { commandId },
      )
    }

    this.commandHandlers.set(commandId, handler)
    let disposed = false
    return Object.freeze({
      dispose: () => {
        if (disposed) return
        disposed = true
        if (this.commandHandlers.get(commandId) === handler) {
          this.commandHandlers.delete(commandId)
        }
      },
    })
  }

  private async readNote(options: ReadNoteOptions): Promise<NoteSnapshot> {
    this.record('notes.read', [options])
    this.assertUsable()
    const path = assertNotePath(options.path)
    this.assertPermission('notes.read', path)
    const note = this.noteStore.get(path)
    if (!note) {
      throw new PluginError('NotFound', `Note "${path}" does not exist`, { path })
    }
    if (utf8Length(note.content) > MAX_NOTE_BYTES) {
      throw new PluginError(
        'QuotaExceeded',
        'The note is too large for the plugin API',
        { path },
      )
    }
    return cloneNote(note)
  }

  private async openOrCreateNote(
    options: OpenOrCreateNoteOptions,
  ): Promise<OpenOrCreateResult> {
    this.record('notes.openOrCreate', [options])
    this.assertUsable()
    if (options.open && this.surface === 'editor-window') {
      throw new PluginError('EditorBusy', 'Separate editor windows cannot open another note')
    }
    if (options.create === false && !options.open) throw new PluginError('InvalidPath', 'Open-only mode requires open: true')
    if (options.create !== false) this.assertPermission('notes.create', options.path)
    if (options.open) this.assertPermission('notes.open', options.path)
    if (options.workspaceId !== this.workspaceInfo.id) {
      throw new PluginError(
        'WorkspaceChanged',
        'The requested workspace is not the current test workspace',
        {
          expectedWorkspaceId: this.workspaceInfo.id,
          actualWorkspaceId: options.workspaceId,
        },
      )
    }
    if (options.conflict !== 'open-existing') {
      throw new PluginError(
        'Conflict',
        'The test host only supports the open-existing conflict policy',
      )
    }

    const path = assertNotePath(options.path)
    const parent = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''
    if (options.create !== false) this.assertPermission('notes.create', parent || path)
    if (options.open) this.assertPermission('notes.open', parent || path)
    if (utf8Length(options.initialContent) > MAX_NOTE_BYTES) {
      throw new PluginError(
        'QuotaExceeded',
        'The initial note content is too large',
        { path },
      )
    }
    assertNoteIdempotencyKey(options.idempotencyKey)
    const existing = this.noteStore.get(path)
    if (existing) {
      if (options.open) this.openNotePaths.add(path)
      return {
        status: 'opened-existing',
        workspaceId: this.workspaceInfo.id,
        path,
        opened: options.open,
      }
    }

    if (options.create === false) throw new PluginError('NotFound', 'The note does not exist', { path })
    this.noteStore.set(path, {
      id: `${this.workspaceInfo.id}:${path}`,
      path,
      revision: contentRevision(options.initialContent),
      content: options.initialContent,
    })
    this.rememberParentFolders(path)
    if (options.open) this.openNotePaths.add(path)
    await this.dispatchNoteChange({ type: 'created', path })
    return {
      status: 'created',
      workspaceId: this.workspaceInfo.id,
      path,
      opened: options.open,
    }
  }

  private async getTextSnapshot(
    options: GetEditorTextSnapshotOptions,
  ): Promise<EditorTextSnapshot> {
    this.record('editor.getTextSnapshot', [options])
    this.assertUsable()
    this.assertPermission('editor.read')

    if (!this.editor || !this.editorSnapshot
      || this.editor.editorId !== options.editorId) {
      throw new PluginError(
        'NotFound',
        `Editor "${options.editorId}" is not active`,
        { editorId: options.editorId },
      )
    }
    if (this.editor.revision !== options.expectedRevision) {
      throw new PluginError(
        'StaleRevision',
        'The expected editor revision is stale',
        {
          expectedRevision: options.expectedRevision,
          actualRevision: this.editor.revision,
        },
      )
    }
    return { ...this.editorSnapshot }
  }

  private async listNotes(options: ListNotesOptions = {}): Promise<ListNotesResult> {
    this.record('notes.list', [options])
    this.assertUsable()
    const folder = options.folder ? normalizeGrantPath(options.folder) : ''
    this.assertPermission('notes.list', folder)
    if (!this.knownFolders.has(folder)) {
      throw new PluginError('NotFound', `Workspace folder "${folder}" does not exist`, { folder })
    }
    const limit = options.limit ?? 200
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw new PluginError('InvalidPath', 'List limit must be between 1 and 1000')
    const prefix = folder ? `${folder}/` : ''
    const matching = [...this.noteStore.values()]
      .filter((note) => note.path.startsWith(prefix))
      .filter((note) => options.recursive === true || !note.path.slice(prefix.length).includes('/'))
      .sort((left, right) => {
        const a = left.path.split('/'), b = right.path.split('/')
        for (let i = 0; i < Math.min(a.length, b.length); i++) {
          const compared = compareStrings(a[i], b[i])
          if (compared) return compared
        }
        return a.length - b.length
      })
    let start = 0
    if (options.cursor !== undefined) {
      let cursor: unknown
      try {
        if (typeof options.cursor !== 'string' || options.cursor.length > 8192) throw new Error()
        cursor = JSON.parse(options.cursor)
      } catch { throw new PluginError('InvalidPath', 'Invalid note cursor') }
      if (!isPlainRecord(cursor) || !hasOnlyKeys(cursor, new Set(['workspace', 'folder', 'recursive', 'after'])) || cursor.workspace !== this.workspaceInfo.id || cursor.folder !== folder || cursor.recursive !== (options.recursive === true) || typeof cursor.after !== 'string') throw new PluginError('InvalidPath', 'Note cursor does not match this query')
      const after = assertNotePath(cursor.after)
      const index = matching.findIndex(note => note.path === after)
      if (index < 0) throw new PluginError('StaleRevision', 'Note cursor is stale; restart the scan')
      start = index + 1
    }
    const page = matching.slice(start, start + limit)
    const truncated = matching.length > start + limit
    return {
      entries: page.map((note) => ({
        path: note.path,
        name: note.path.slice(note.path.lastIndexOf('/') + 1),
        size: utf8Length(note.content),
      })),
      truncated,
      ...(truncated ? { nextCursor: JSON.stringify({ workspace: this.workspaceInfo.id, folder, recursive: options.recursive === true, after: page[page.length - 1].path }) } : {}),
    }
  }

  private async writeNote(options: WriteNoteOptions): Promise<WriteNoteResult> {
    this.record('notes.write', [options])
    this.assertUsable()
    const path = assertNotePath(options.path)
    this.assertPermission('notes.write', path)
    if (utf8Length(options.content) > MAX_NOTE_BYTES) throw new PluginError('QuotaExceeded', 'The note is too large')
    this.assertClosedNoteMutation([path])
    const existing = this.noteStore.get(path)
    if (existing && utf8Length(existing.content) > MAX_NOTE_BYTES) {
      throw new PluginError('QuotaExceeded', 'Workspace note exceeds the 2 MiB mutation limit')
    }
    if (!existing && options.create !== true) throw new PluginError('NotFound', `Note "${path}" does not exist`)
    if (existing && options.expectedRevision === undefined) {
      throw new PluginError('StaleRevision', 'Read the existing note and provide expectedRevision before writing')
    }
    if (options.expectedRevision !== undefined && existing?.revision !== options.expectedRevision) {
      throw new PluginError('StaleRevision', 'The expected note revision is stale')
    }
    const revision = contentRevision(options.content)
    this.noteStore.set(path, { id: existing?.id ?? `${this.workspaceInfo.id}:${path}`, path, revision, content: options.content })
    this.rememberParentFolders(path)
    await this.dispatchNoteChange({ type: existing ? 'changed' : 'created', path })
    return { path, revision, created: !existing }
  }

  private async moveNote(options: MoveNoteOptions): Promise<void> {
    this.record('notes.move', [options])
    this.assertUsable()
    const from = assertNotePath(options.from)
    const to = assertNotePath(options.to)
    this.assertPermission('notes.move', from)
    this.assertPermission('notes.move', to)
    if (from === to) return
    this.assertClosedNoteMutation([from, to])
    const note = this.noteStore.get(from)
    if (!note) throw new PluginError('NotFound', `Note "${from}" does not exist`)
    if (this.noteStore.has(to)) throw new PluginError('Conflict', `Note "${to}" already exists`)
    this.noteStore.delete(from)
    this.noteStore.set(to, { ...note, path: to })
    this.rememberParentFolders(to)
    await this.dispatchNoteChange({ type: 'moved', path: to, previousPath: from })
  }

  private async deleteNote(options: DeleteNoteOptions): Promise<void> {
    this.record('notes.delete', [options])
    this.assertUsable()
    const path = assertNotePath(options.path)
    this.assertPermission('notes.delete', path)
    this.assertClosedNoteMutation([path])
    const note = this.noteStore.get(path)
    if (!note) throw new PluginError('NotFound', `Note "${path}" does not exist`)
    if (utf8Length(note.content) > MAX_NOTE_BYTES) {
      throw new PluginError('QuotaExceeded', 'Workspace note exceeds the 2 MiB mutation limit')
    }
    if (note.revision !== options.expectedRevision) {
      throw new PluginError('StaleRevision', 'The expected note revision is stale')
    }
    this.noteStore.delete(path)
    await this.dispatchNoteChange({ type: 'deleted', path })
  }

  private assertClosedNoteMutation(paths: readonly string[]): void {
    if (this.surface === 'editor-window') {
      throw new PluginError('EditorBusy', 'File mutations must run in the main window; use the editor API for the open note')
    }
    if (paths.some(path => [...this.openNotePaths].some(openPath => openPath.toLowerCase() === path.toLowerCase()))) {
      throw new PluginError('EditorBusy', 'Close every tab, pane, and separate editor window for these notes before changing their files')
    }
  }

  private async dispatchNoteChange(event: NoteChangeEvent): Promise<void> {
    const canObserve = (path: string) => (
      this.hasPermission('notes.list', path) || this.hasPermission('notes.read', path)
    )
    let projected: NoteChangeEvent | null
    if (event.type !== 'moved') {
      projected = canObserve(event.path) ? { type: event.type, path: event.path } : null
    } else {
      const sourceVisible = event.previousPath ? canObserve(event.previousPath) : false
      const targetVisible = canObserve(event.path)
      if (sourceVisible && targetVisible && event.previousPath) {
        projected = { type: 'moved', path: event.path, previousPath: event.previousPath }
      } else if (targetVisible) {
        projected = { type: 'created', path: event.path }
      } else if (sourceVisible && event.previousPath) {
        projected = { type: 'deleted', path: event.previousPath }
      } else {
        projected = null
      }
    }
    if (!projected) return
    const visibleEvent = projected
    await Promise.allSettled([...this.noteListeners].map(
      (listener) => Promise.resolve().then(() => listener({ ...visibleEvent })),
    ))
  }

  private dismissDialog(id: string, reason: PluginDialogCloseEvent['reason']): void {
    if (this.dialogState?.id !== id) return
    this.syncFormSnapshots(id, { blocks: [] })
    this.dialogState = null
    for (const listener of this.dialogCloseListeners) void Promise.resolve().then(() => listener({ id, reason })).catch(() => undefined)
  }

  /** Simulate mounting, switching or unmounting an embedded host surface. */
  async setEmbeddedViewContext(id: string, contextId: string | null): Promise<void> {
    const previous = this.getViewState(id)
    if (!EMBEDDED_LOCATIONS.has(previous.location)) throw new PluginError('InvalidPath', 'Not an embedded view')
    if (contextId !== null && (!contextId || contextId.length > 160)) throw new PluginError('InvalidPath', 'Invalid context ID')
    if (contextId === null) this.embeddedContexts.delete(id)
    else this.embeddedContexts.set(id, contextId)
    this.viewStates.delete(id)
    this.syncFormSnapshots(id, { blocks: [] })
    const state = this.getViewState(id)
    if (JSON.stringify(previous) !== JSON.stringify(state)) {
      await Promise.allSettled([...this.viewListeners].map(listener => Promise.resolve().then(() => listener(state))))
    }
  }

  private getViewState(id: string): PluginViewState {
    this.assertUsable()
    if (this.surface !== 'main') throw new PluginError('UnavailableOnPlatform', 'Views require the main window')
    const view = this.manifest.contributes.views?.find((entry) => entry.id === id)
    if (!view) throw new PluginError('PermissionDenied', 'View is not declared')
    if (EMBEDDED_LOCATIONS.has(view.location)) return { id, location: view.location, visible: this.embeddedContexts.has(id) && !this.hiddenTitleBarViews.has(id), ...(this.embeddedContexts.has(id) ? { contextId: this.embeddedContexts.get(id)! } : {}) }
    return { id, location: view.location, visible: view.location === 'settings' ? this.visibleViews.has('settings') : view.location.startsWith('title-bar-') ? !this.hiddenTitleBarViews.has(id) : this.visibleViews.get(view.location) === id }
  }

  private async changeViewVisibility(id: string, visible: boolean): Promise<void> {
    const state = this.getViewState(id)
    if (state.location === 'settings') {
      if (visible) this.visibleViews.set('settings', id)
      else this.visibleViews.delete('settings')
      for (const view of this.manifest.contributes.views ?? []) {
        if (view.location !== 'settings') continue
        if (!visible) this.syncFormSnapshots(view.id, { blocks: [] })
        if (state.visible !== visible) {
          const next = this.getViewState(view.id)
          await Promise.allSettled([...this.viewListeners].map(listener => Promise.resolve().then(() => listener(next))))
        }
      }
      return
    }
    if (!visible) this.syncFormSnapshots(id, { blocks: [] })
    if (state.location.startsWith('title-bar-') || EMBEDDED_LOCATIONS.has(state.location)) {
      if (visible) this.hiddenTitleBarViews.delete(id)
      else this.hiddenTitleBarViews.add(id)
      const next = this.getViewState(id)
      if (state.visible !== next.visible) {
        await Promise.allSettled([...this.viewListeners].map(listener => Promise.resolve().then(() => listener(next))))
      }
      return
    }
    const previous = this.visibleViews.get(state.location)
    if (visible) this.visibleViews.set(state.location, id)
    else if (previous === id) this.visibleViews.delete(state.location)
    const changed = new Set([id, ...(previous ? [previous] : [])])
    for (const viewId of changed) {
      const next = this.getViewState(viewId)
      if (next.visible === (previous === viewId)) continue
      await Promise.allSettled([...this.viewListeners].map((listener) => Promise.resolve().then(() => listener(next))))
    }
  }

  private async searchNotes(options: SearchNotesOptions) {
    this.record('notes.search', [options])
    this.assertUsable()
    this.assertPermission('notes.read')
    const query = options.query
    const limit = options.limit ?? 50
    if (typeof query !== 'string' || !query.trim() || query.length > 500 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new PluginError('InvalidPath', 'Invalid search options')
    }
    const listed = await this.listNotes({ folder: options.folder ?? '', recursive: true, limit: 200 })
    const matches: { path: string; revision: number; line: number; preview: string }[] = []
    let truncated = listed.truncated
    let scanned = 0
    for (const entry of listed.entries) {
      try { this.assertPermission('notes.read', entry.path) } catch (error) {
        if (error instanceof PluginError && error.code === 'PermissionDenied') continue
        throw error
      }
      const note = this.noteStore.get(entry.path)
      if (!note) continue
      const bytes = utf8Length(note.content)
      if (bytes > MAX_NOTE_BYTES || scanned + bytes > 16 * 1_048_576) { truncated = true; continue }
      scanned += bytes
      const lines = note.content.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        const text = lines[index]
        const position = (options.caseSensitive ? text : text.toLowerCase()).indexOf(options.caseSensitive ? query : query.toLowerCase())
        if (position < 0) continue
        matches.push({ path: note.path, revision: note.revision, line: index + 1, preview: text.slice(Math.max(0, position - 80), Math.max(0, position - 80) + 500) })
        if (matches.length >= limit) return { matches, truncated: true }
      }
    }
    return { matches, truncated }
  }

  private sourceSnapshot(options: { editorId: string; expectedRevision: number }) {
    this.assertUsable()
    this.assertPermission('editor.write')
    if (!this.editor || !this.editorSnapshot || this.editor.editorId !== options.editorId) throw new PluginError('NotFound', 'Editor is not active')
    if (this.editor.revision !== options.expectedRevision) throw new PluginError('StaleRevision', 'Editor revision changed')
    if (this.editor.mode !== 'source' || this.editor.composing) throw new PluginError('EditorBusy', 'Range operations require an idle source editor')
    return { editor: this.editor, snapshot: this.editorSnapshot }
  }

  private async applyEditorEdits(options: ApplyEditorEditsOptions) {
    this.record('editor.applyEdits', [options])
    const { editor, snapshot } = this.sourceSnapshot(options)
    if (!Array.isArray(options.edits) || options.edits.length < 1 || options.edits.length > 100) throw new PluginError('QuotaExceeded', 'Expected 1–100 edits')
    const edits = [...options.edits].sort((a, b) => a.from - b.from || a.to - b.to)
    let insertedLength = 0
    let bytes = 0
    edits.forEach((edit, index) => {
      assertSourceRange(snapshot.text, edit.from, edit.to)
      if (typeof edit.text !== 'string') throw new PluginError('InvalidPath', 'Invalid edit text')
      if (index > 0 && (edit.from < edits[index - 1].to || edit.from === edits[index - 1].from)) throw new PluginError('Conflict', 'Overlapping edits')
      insertedLength += edit.text.length
      bytes += utf8Length(edit.text)
    })
    if (bytes > MAX_EDITOR_EDIT_BYTES) throw new PluginError('QuotaExceeded', 'Edits exceed 1 MiB')
    let text = snapshot.text
    for (const edit of [...edits].reverse()) text = text.slice(0, edit.from) + edit.text + text.slice(edit.to)
    const revision = editor.revision + 1
    this.editor = { ...editor, revision, size: measureText(text) }
    this.editorSnapshot = { ...snapshot, revision, text }
    const mapOffset = (offset: number) => {
      let delta = 0
      for (const edit of edits) {
        if (offset < edit.from) break
        if (offset <= edit.to) return edit.from + delta + edit.text.length
        delta += edit.text.length - (edit.to - edit.from)
      }
      return offset + delta
    }
    const from = mapOffset(this.editorSelection?.from ?? 0)
    const to = mapOffset(this.editorSelection?.to ?? 0)
    this.editorSelection = { editorId: editor.editorId, revision, from, to, offsetsAvailable: true, empty: from === to, text: text.slice(from, to) }
    await Promise.allSettled([...this.contentListeners].map((listener) => Promise.resolve().then(() => listener({ editorId: editor.editorId, documentId: editor.documentId, revision, composing: false, size: measureText(text) }))))
    return { applied: true as const, insertedLength }
  }

  private applyEditorSelection(options: SetEditorSelectionOptions): void {
    this.record('editor.setSelection', [options])
    const { editor, snapshot } = this.sourceSnapshot(options)
    assertSourceRange(snapshot.text, options.from, options.to)
    this.editorSelection = { editorId: editor.editorId, revision: editor.revision, from: options.from, to: options.to, offsetsAvailable: true, empty: options.from === options.to, text: snapshot.text.slice(options.from, options.to) }
  }

  private async applyEditorEdit(options: ApplyEditorEditOptions) {
    this.record('editor.applyEdit', [options])
    this.assertUsable()
    this.assertPermission('editor.write')
    if (!this.editor || !this.editorSnapshot || this.editor.editorId !== options.editorId) {
      throw new PluginError('NotFound', `Editor "${options.editorId}" is not active`)
    }
    if (this.editor.revision !== options.expectedRevision) throw new PluginError('StaleRevision', 'The expected editor revision is stale')
    if (this.editor.composing) {
      throw new PluginError('EditorBusy', 'The editor is handling text composition')
    }
    if (utf8Length(options.text) > MAX_EDITOR_EDIT_BYTES) {
      throw new PluginError('QuotaExceeded', 'Editor edits are limited to 1 MiB')
    }
    assertSelectionMatchesEditor(this.editorSelection, this.editor)
    const revision = this.editor.revision + 1
    const currentText = this.editorSnapshot.text
    const selection = this.editorSelection
    const hasOffsets = selection?.offsetsAvailable === true
      && selection.from !== undefined
      && selection.to !== undefined
    const selectionStart = hasOffsets
      ? Math.max(0, Math.min(selection.from ?? currentText.length, currentText.length))
      : currentText.length
    const selectionEnd = hasOffsets
      ? Math.max(selectionStart, Math.min(selection.to ?? selectionStart, currentText.length))
      : selectionStart
    const replaceStart = options.target === 'selection' ? selectionStart : selectionEnd
    const replaceEnd = options.target === 'selection' ? selectionEnd : selectionEnd
    const text = `${currentText.slice(0, replaceStart)}${options.text}${currentText.slice(replaceEnd)}`
    this.editor = { ...this.editor, revision, size: measureText(text) }
    this.editorSnapshot = { ...this.editorSnapshot, revision, text }
    const cursor = replaceStart + options.text.length
    this.editorSelection = {
      editorId: this.editor.editorId,
      revision,
      from: cursor,
      to: cursor,
      offsetsAvailable: true,
      empty: true,
      text: '',
    }
    await Promise.allSettled([...this.contentListeners].map((listener) => Promise.resolve().then(() => listener({
      editorId: this.editor?.editorId ?? options.editorId,
      documentId: this.editor?.documentId ?? this.editorSnapshot?.documentId ?? '',
      revision,
      composing: false,
      size: measureText(text),
    }))))
    return { applied: true as const, insertedLength: options.text.length }
  }

  private createStorageArea(area: StorageAreaName): PluginContext['storage']['device'] {
    const prefix = `storage.${area}` as const
    const store = area === 'device' ? this.deviceStorage : this.workspaceStorage
    return Object.freeze({
      get: async (key: string) => {
        this.record(`${prefix}.get`, [key])
        this.assertUsable()
        assertStorageKey(key)
        const value = store.get(key)
        return value === undefined ? undefined : cloneJsonValue(value)
      },
      set: async (key: string, value: PluginJsonValue) => {
        this.record(`${prefix}.set`, [key, value])
        this.assertUsable()
        assertStorageKey(key)
        const cloned = cloneJsonValue(value)
        this.assertStorageQuota(area, key, cloned)
        store.set(key, cloned)
      },
      delete: async (key: string) => {
        this.record(`${prefix}.delete`, [key])
        this.assertUsable()
        assertStorageKey(key)
        store.delete(key)
      },
    })
  }

  private rememberParentFolders(path: string): void {
    const segments = path.split('/')
    segments.pop()
    while (segments.length > 0) {
      this.knownFolders.add(segments.join('/'))
      segments.pop()
    }
  }

  private rememberFolder(folder: string): void {
    const normalized = normalizeGrantPath(folder)
    if (!normalized) return
    // Reuse the production-compatible note path checks for every folder
    // segment without exposing a separate, weaker path grammar in tests.
    assertNotePath(`${normalized}/__notegen_folder_probe__.md`)
    const segments = normalized.split('/')
    while (segments.length > 0) {
      this.knownFolders.add(segments.join('/'))
      segments.pop()
    }
  }

  private validateUiDocument(content: PluginUiDocument): PluginUiDocument {
    return validateUiDocument(content, this.commandIds)
  }

  simulateFormChange(surfaceId: string, formId: string): NonNullable<PluginUiDocument['expectedForm']> {
    this.assertUsable()
    const document = this.dialogState?.id === surfaceId ? this.dialogState.content : this.viewStates.get(surfaceId)
    if (!document || !flattenPluginUiBlocks(document.blocks).some(block => block.type === 'form' && block.id === formId)) throw new PluginError('NotFound', 'Form does not exist')
    // Seed a newly reopened form without reusing a request precondition.
    this.syncFormSnapshots(surfaceId, { blocks: document.blocks })
    const state = this.formSnapshots.get(JSON.stringify([surfaceId, formId]))!
    state.revision += 1
    return { formId, generation: state.generation, revision: state.revision }
  }

  private syncFormSnapshots(surface: string, document: PluginUiDocument): void {
    const expected = document.expectedForm
    if (expected) {
      const state = this.formSnapshots.get(JSON.stringify([surface, expected.formId]))
      if (!state || state.generation !== expected.generation || state.revision !== expected.revision) throw new PluginError('StaleRevision', 'Form input changed; discard this UI result')
    }
    const forms = flattenPluginUiBlocks(document.blocks).filter(block => block.type === 'form')
    for (const [key, state] of this.formSnapshots) {
      if (state.surface === surface && !forms.some(form => form.id === state.formId)) this.formSnapshots.delete(key)
    }
    for (const form of forms) {
      const key = JSON.stringify([surface, form.id])
      const previous = this.formSnapshots.get(key)
      if (!previous || previous.resetKey !== form.resetKey) this.formSnapshots.set(key, {
        surface, formId: form.id, resetKey: form.resetKey, generation: `form:${++this.formSequence}`, revision: 0,
      })
    }
  }

  private validateDialog(options: PluginDialogOptions): PluginDialogOptions {
    return validateDialogOptions(options, this.commandIds)
  }

  private resolveDay(options: ResolveDayOptions): ResolvedDay {
    if (!DAY_START_PATTERN.test(options.dayStartsAt)) {
      throw new PluginError(
        'InvalidTimeZone',
        `Invalid dayStartsAt value "${options.dayStartsAt}"`,
      )
    }

    const instant = this.now()
    if (Number.isNaN(instant.getTime())) {
      throw new PluginError('RuntimeFailure', 'The test clock returned an invalid date')
    }
    const timeZone = options.timeZone === 'system'
      ? Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      : options.timeZone

    let parts: Intl.DateTimeFormatPart[]
    try {
      parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(instant)
    } catch (error: unknown) {
      throw new PluginError(
        'InvalidTimeZone',
        `Invalid time zone "${timeZone}"`,
        { cause: error instanceof Error ? error.message : String(error) },
      )
    }

    const values = datePartRecord(parts)
    const year = requiredDatePart(values, 'year')
    const month = requiredDatePart(values, 'month')
    const day = requiredDatePart(values, 'day')
    const hour = requiredDatePart(values, 'hour')
    const minute = requiredDatePart(values, 'minute')
    const second = requiredDatePart(values, 'second')
    const localDate = `${year}-${month}-${day}`
    const localMinutes = Number(hour) * 60 + Number(minute)
    const [startHour = '00', startMinute = '00'] = options.dayStartsAt.split(':')
    const startMinutes = Number(startHour) * 60 + Number(startMinute)

    return {
      instant: instant.toISOString(),
      logicalDate: localMinutes < startMinutes
        ? previousDate(year, month, day)
        : localDate,
      timeZone,
      localDateTime: `${localDate}T${hour}:${minute}:${second}`,
    }
  }

  private assertPermission(
    permission: PluginPermissionName,
    path?: string,
  ): void {
    if (this.hasPermission(permission, path)) return
    throw new PluginError(
      'PermissionDenied',
      path === undefined
        ? `Permission "${permission}" is not granted`
        : `Path "${path}" is outside the granted "${permission}" scope`,
      path === undefined ? { permission } : { permission, path },
    )
  }

  private hasPermission(
    permission: PluginPermissionName,
    path?: string,
  ): boolean {
    const declaration = this.manifest.permissions[permission]
    const grant = this.permissionGrants.get(permission)
    if (!declaration || !grant?.granted) return false
    if (path === undefined || grant.paths === null) return true
    return grant.paths.some((grantedPath) => (
      pathIsWithin(path, grantedPath, declaration.scope)
    ))
  }

  private assertUsable(): void {
    if (this.lifecycle === 'activating' || this.lifecycle === 'active') {
      this.abortSignal.throwIfAborted()
      return
    }
    throw new PluginError('Cancelled', 'The plugin test host is not active')
  }

  private awaitWhileActive<Value>(operation: () => Value | Promise<Value>): Promise<Value> {
    this.assertUsable()
    return new Promise<Value>((resolve, reject) => {
      const cancel = (): void => {
        reject(new PluginError('Cancelled', 'The plugin test host was stopped during an operation'))
      }
      this.abortSignal.addEventListener('abort', cancel, { once: true })
      let pending: Value | Promise<Value>
      try {
        pending = operation()
      } catch (error: unknown) {
        this.abortSignal.removeEventListener('abort', cancel)
        reject(error)
        return
      }
      // Keep handlers on the original promise after cancellation as well: a
      // late rejection must not become an unhandled rejection in the test run.
      Promise.resolve(pending).then((value) => {
        this.abortSignal.removeEventListener('abort', cancel)
        try {
          this.assertUsable()
          resolve(value)
        } catch (error: unknown) {
          reject(error)
        }
      }, (error: unknown) => {
        this.abortSignal.removeEventListener('abort', cancel)
        reject(error)
      })
    })
  }

  private assertSettingValue(key: string, value: PluginSettingValue): void {
    const declaration = this.settingDeclarations.get(key)
    if (!declaration) {
      throw new PluginError(
        'InvalidManifest',
        `Setting "${key}" is not declared by the plugin`,
        { key },
      )
    }

    if (!settingValueMatches(declaration, value)) {
      throw new PluginError(
        'InvalidManifest',
        `Value for setting "${key}" does not match its declaration`,
        { key, value },
      )
    }
  }

  private seedStorage(
    target: Map<string, PluginJsonValue>,
    values: Readonly<Record<string, PluginJsonValue>> | undefined,
  ): void {
    for (const [key, value] of Object.entries(values ?? {})) {
      assertStorageKey(key)
      target.set(key, cloneJsonValue(value))
    }
  }

  private assertStorageQuota(
    area: StorageAreaName,
    key: string,
    value: PluginJsonValue,
  ): void {
    const entries = emptyRecord<PluginJsonValue>()
    for (const [storedKey, storedValue] of this.deviceStorage) {
      entries[`device:${this.manifest.id}:${storedKey}`] = storedValue
    }
    for (const [storedKey, storedValue] of this.workspaceStorage) {
      entries[`workspace:${this.workspaceInfo.id}:${this.manifest.id}:${storedKey}`] = storedValue
    }
    const targetKey = area === 'device'
      ? `device:${this.manifest.id}:${key}`
      : `workspace:${this.workspaceInfo.id}:${this.manifest.id}:${key}`
    entries[targetKey] = value

    if (Object.keys(entries).length > MAX_STORAGE_KEYS) {
      throw new PluginError('QuotaExceeded', 'Plugin storage key quota exceeded')
    }
    const serialized = JSON.stringify(entries)
    if (serialized === undefined || utf8Length(serialized) > MAX_STORAGE_BYTES) {
      throw new PluginError('QuotaExceeded', 'Plugin storage quota exceeded')
    }
  }

  private assertSeededStorageQuota(): void {
    const entries = emptyRecord<PluginJsonValue>()
    for (const [storedKey, storedValue] of this.deviceStorage) {
      entries[`device:${this.manifest.id}:${storedKey}`] = storedValue
    }
    for (const [storedKey, storedValue] of this.workspaceStorage) {
      entries[`workspace:${this.workspaceInfo.id}:${this.manifest.id}:${storedKey}`] = storedValue
    }
    if (Object.keys(entries).length > MAX_STORAGE_KEYS) {
      throw new PluginError('QuotaExceeded', 'Seeded plugin storage exceeds the key quota')
    }
    const serialized = JSON.stringify(entries)
    if (serialized === undefined || utf8Length(serialized) > MAX_STORAGE_BYTES) {
      throw new PluginError('QuotaExceeded', 'Seeded plugin storage exceeds the byte quota')
    }
  }

  private createInitialEditorSnapshot(
    editor: ActiveEditorContext | null,
    text: string,
  ): EditorTextSnapshot | null {
    if (!editor) return null
    return {
      editorId: editor.editorId,
      documentId: editor.documentId,
      revision: editor.revision,
      format: 'markdown',
      text,
    }
  }

  private record(
    name: PluginTestCallName,
    arguments_: readonly unknown[] = [],
  ): void {
    const call: PluginTestCall = Object.freeze({
      sequence: this.nextSequence,
      name,
      arguments: Object.freeze(arguments_.map(snapshotForHistory)),
    })
    this.nextSequence += 1
    this.calls.push(call)
  }

  private stop(reason: PluginError): void {
    this.lifecycle = 'stopped'
    this.abortSignal.abort(reason)
    for (const signal of this.aiRequests.values()) signal.abort(reason)
    this.aiRequests.clear()
    this.aiListeners.clear()
    this.clearRegistrations()
  }

  private clearRegistrations(): void {
    this.formSnapshots.clear()
    this.commandHandlers.clear()
    this.activeEditorListeners.clear()
    this.contentListeners.clear()
    this.settingListeners.clear()
    this.workspaceListeners.clear()
    this.noteListeners.clear()
    this.viewListeners.clear()
    this.dialogCloseListeners.clear()
    this.visibleViews.clear()
    this.hiddenTitleBarViews.clear()
    this.viewStates.clear()
    this.embeddedContexts.clear()
    this.dialogState = null
    for (const pending of this.pendingStatusUpdates.values()) {
      if (pending.timer !== null) clearTimeout(pending.timer)
    }
    this.pendingStatusUpdates.clear()
    this.statusUpdateTimes.clear()
  }
}

/** Create a deterministic in-process implementation of the public plugin host. */
export function createPluginTestHost(
  options: PluginTestHostOptions,
): PluginTestHost {
  return new MemoryPluginTestHost(options)
}

function addDisposableListener<Listener>(
  listeners: Set<Listener>,
  listener: Listener,
): PluginDisposable {
  listeners.add(listener)
  let disposed = false
  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      listeners.delete(listener)
    },
  })
}

function cloneWorkspace(workspace: WorkspaceInfo): WorkspaceInfo {
  return { ...workspace }
}

function cloneNote(note: NoteSnapshot): NoteSnapshot {
  return { ...note }
}

function cloneActiveEditor(
  editor: ActiveEditorContext | null,
): ActiveEditorContext | null {
  if (!editor) return null
  return {
    ...editor,
    size: { ...editor.size },
  }
}

function cloneSelection(selection: EditorSelection | null): EditorSelection | null {
  return selection ? { ...selection } : null
}

function cloneContentEvent(event: EditorContentChangeEvent): EditorContentChangeEvent {
  return {
    ...event,
    size: { ...event.size },
  }
}

function normalizePermissionGrant(
  grant: PluginTestPermissionGrant,
  permission: PluginPermissionName,
): NormalizedPermissionGrant {
  const candidate = grant as unknown
  if (typeof candidate === 'boolean') {
    return Object.freeze({ granted: candidate, paths: null })
  }
  if (candidate === null || typeof candidate !== 'object') {
    throw invalidPermissionGrant(permission)
  }

  const record = candidate as Readonly<Record<string, unknown>>
  if (typeof record.granted !== 'boolean' || !Array.isArray(record.paths)) {
    throw invalidPermissionGrant(permission)
  }
  const paths: string[] = []
  for (const path of record.paths) {
    if (typeof path !== 'string') throw invalidPermissionGrant(permission)
    paths.push(normalizeGrantPath(path))
  }
  return Object.freeze({
    granted: record.granted,
    paths: Object.freeze(paths),
  })
}

function invalidPermissionGrant(permission: PluginPermissionName): PluginError {
  return new PluginError(
    'InvalidManifest',
    `Permission override "${permission}" must be a boolean or a scoped grant with string paths`,
    { permission },
  )
}

function normalizeGrantPath(path: string): string {
  const normalized = path.normalize('NFC').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  return normalized === '.' ? '' : normalized
}

function pathIsWithin(
  path: string,
  grantedPath: string,
  scope: PluginPermissionScope,
): boolean {
  const target = normalizeGrantPath(path)
  const grant = normalizeGrantPath(grantedPath)
  if (scope === 'network-origins') return Boolean(grant) && target === grant
  if (scope === 'workspace-file' || scope === 'workspace-files') {
    return Boolean(grant) && target === grant
  }
  if (!grant) return true
  return target === grant || target.startsWith(`${grant}/`)
}

function assertNotePath(path: string): string {
  const normalized = path
    .normalize('NFC')
    .trim()
    .replace(/\\/g, '/')
    .replace(/\/+/g, '/')
  const segments = normalized.split('/')
  if (!normalized
    || normalized.startsWith('/')
    || /^[A-Za-z]:\//.test(normalized)
    || normalized.endsWith('/')
    || utf8Length(normalized) > MAX_WORKSPACE_PATH_BYTES
    || CONTROL_CHARACTER.test(normalized)
    || hasLoneSurrogate(normalized)
    || segments.length > MAX_WORKSPACE_PATH_DEPTH
    || segments.some((segment) => !segment || segment === '.' || segment === '..')
    || segments.some((segment) => (
      utf8Length(segment) > MAX_WORKSPACE_PATH_SEGMENT_BYTES
      || segment.normalize('NFC') !== segment
      || segment.endsWith('.')
      || segment.endsWith(' ')
      || INVALID_PORTABLE_PATH_CHARACTER.test(segment)
      || isWindowsReservedName(segment)
      || isReservedWorkspacePathSegment(segment)
    ))
    || !normalized.toLowerCase().endsWith('.md')) {
    throw new PluginError('InvalidPath', `Invalid workspace note path "${path}"`, {
      path,
    })
  }
  return normalized
}

function assertNoteIdempotencyKey(key: string): void {
  if (
    key.length === 0
    || utf8Length(key) > 256
    || CONTROL_CHARACTER.test(key)
    || hasLoneSurrogate(key)
  ) {
    throw new PluginError('InvalidPath', 'Note idempotency key is invalid')
  }
}

function isReservedWorkspacePathSegment(segment: string): boolean {
  const lower = segment.toLowerCase()
  return RESERVED_WORKSPACE_PATH_SEGMENTS.has(lower)
    || lower === '.env'
    || lower.startsWith('.env.')
}

function isWindowsReservedName(segment: string): boolean {
  const stem = segment
    .replace(/[. ]+$/u, '')
    .split('.')[0]
    ?.replace(/[a-z]/g, (character) => character.toUpperCase()) ?? ''
  return stem === 'CON'
    || stem === 'PRN'
    || stem === 'AUX'
    || stem === 'NUL'
    || stem === 'CLOCK$'
    || stem === 'CONIN$'
    || stem === 'CONOUT$'
    || /^(?:COM|LPT)(?:[1-9¹²³])$(?![\s\S])/u.test(stem)
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true
    }
  }
  return false
}

function assertStorageKey(key: string): void {
  if (STORAGE_KEY_PATTERN.test(key)) return
  throw new PluginError(
    'InvalidManifest',
    `Invalid plugin storage key "${key}"`,
    { key },
  )
}

function settingValueMatches(
  declaration: PluginSettingContribution,
  value: PluginSettingValue,
): boolean {
  if (declaration.type === 'boolean') return typeof value === 'boolean'
  if (declaration.type === 'number') {
    return typeof value === 'number'
      && Number.isFinite(value)
      && (declaration.min === undefined || value >= declaration.min)
      && (declaration.max === undefined || value <= declaration.max)
  }
  if (typeof value !== 'string') return false
  if (declaration.type === 'select') {
    return declaration.options.some((option) => option.value === value)
  }
  if (declaration.type === 'string' && declaration.maxLength !== undefined) {
    return utf8Length(value) <= declaration.maxLength
  }
  return true
}

function measureText(text: string): ActiveEditorContext['size'] {
  return {
    utf16Length: text.length,
    bytes: utf8Length(text),
    lines: text.length === 0 ? 1 : text.split('\n').length,
  }
}

function utf8Length(value: string): number {
  let bytes = 0
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code <= 0x7f) {
      bytes += 1
    } else if (code <= 0x7ff) {
      bytes += 2
    } else if (code >= 0xd800 && code <= 0xdbff
      && index + 1 < value.length
      && value.charCodeAt(index + 1) >= 0xdc00
      && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4
      index += 1
    } else {
      bytes += 3
    }
  }
  return bytes
}

function contentRevision(value: string): number {
  const digest = createHash('sha256').update(value, 'utf8').digest()
  return Number(digest.readBigUInt64BE(0) & MAX_JAVASCRIPT_INTEGER)
}

function cloneJsonValue(
  value: unknown,
  invalidValue: () => PluginError = nonJsonStorageValue,
  ancestors = new Set<object>(),
): PluginJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value
    throw invalidValue()
  }
  if (typeof value !== 'object') throw invalidValue()
  if (ancestors.has(value)) throw invalidValue()

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      const result: PluginJsonValue[] = []
      for (let index = 0; index < value.length; index += 1) {
        // Indexed access deliberately turns sparse-array holes into undefined,
        // which the public JSON contract rejects instead of silently preserving.
        result.push(cloneJsonValue(value[index], invalidValue, ancestors))
      }
      return result
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw invalidValue()
    }
    // JSON.parse produces ordinary objects while preserving "__proto__" as an
    // own data property. Mirror that boundary shape without invoking the legacy
    // Object.prototype setter.
    const result: Record<string, PluginJsonValue> = {}
    const descriptors = Object.getOwnPropertyDescriptors(value)
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!('value' in descriptor) || !descriptor.enumerable) throw invalidValue()
      Object.defineProperty(result, key, {
        value: cloneJsonValue(descriptor.value, invalidValue, ancestors),
        enumerable: true,
        configurable: true,
        writable: true,
      })
    }
    return result
  } finally {
    ancestors.delete(value)
  }
}

function nonJsonCommandArgument(): PluginError {
  return new PluginError(
    'RuntimeFailure',
    'Plugin command argument must be a finite JSON value',
  )
}

function nonJsonCommandResult(): PluginError {
  return new PluginError(
    'RuntimeFailure',
    'Plugin command result must be a finite JSON value',
  )
}

function nonJsonStorageValue(): PluginError {
  return new PluginError(
    'QuotaExceeded',
    'Plugin storage accepts finite JSON-compatible values only',
  )
}

function freezeJsonValue(value: PluginJsonValue): PluginJsonValue {
  if (Array.isArray(value)) {
    for (const entry of value) freezeJsonValue(entry)
    return Object.freeze(value)
  }
  if (value !== null && typeof value === 'object') {
    for (const entry of Object.values(value)) freezeJsonValue(entry)
    return Object.freeze(value)
  }
  return value
}

function cloneFrozenUiDocument(document: PluginUiDocument): PluginUiDocument {
  return freezeJsonValue(cloneJsonValue(document)) as unknown as PluginUiDocument
}

function storageRecord(
  storage: ReadonlyMap<string, PluginJsonValue>,
): Readonly<Record<string, PluginJsonValue>> {
  const result = emptyRecord<PluginJsonValue>()
  for (const [key, value] of storage) result[key] = cloneJsonValue(value)
  return Object.freeze(result)
}

function snapshotForHistory(value: unknown): unknown {
  try {
    return cloneJsonValue(value)
  } catch {
    return value
  }
}

function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(
  value: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function assertAttachmentPath(path: string): string {
  const normalized = assertNotePath(`${path}.md`).slice(0, -3)
  if (!/\.(png|jpe?g|gif|webp|pdf|txt|csv)$/i.test(normalized)) throw new PluginError('InvalidPath', 'Unsupported attachment extension')
  return normalized
}

function assertSourceRange(text: string, from: number, to: number): void {
  const split = (offset: number) => offset > 0 && offset < text.length
    && /[\uD800-\uDBFF]/.test(text[offset - 1]) && /[\uDC00-\uDFFF]/.test(text[offset])
  if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > text.length || split(from) || split(to)) {
    throw new PluginError('InvalidPath', 'Invalid Markdown range')
  }
}

function uiString(
  value: unknown,
  label: string,
  maximum: number,
  minimum = 0,
): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new PluginError('InvalidPath', `${label} is malformed`)
  }
  return value
}

function validateFormField(value: unknown): PluginFormField {
  if (!isPlainRecord(value)) throw new PluginError('InvalidPath', 'Invalid field')
  const id = uiString(value.id, 'Field ID', 64, 1)
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id) || (value.required !== undefined && typeof value.required !== 'boolean')) throw new PluginError('InvalidPath', 'Invalid field ID or required flag')
  let visibleWhen: PluginFormField['visibleWhen']
  if (value.visibleWhen !== undefined) {
    const condition = value.visibleWhen
    if (!isPlainRecord(condition) || !hasOnlyKeys(condition, new Set(['field', 'equals']))
      || typeof condition.field !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(condition.field)
      || !(typeof condition.equals === 'boolean' || (typeof condition.equals === 'number' && Number.isFinite(condition.equals)) || (typeof condition.equals === 'string' && condition.equals.length <= 10_000))) {
      throw new PluginError('InvalidPath', 'Invalid visibility condition')
    }
    visibleWhen = { field: condition.field, equals: condition.equals as string | number | boolean }
  }
  if (value.disabled !== undefined && typeof value.disabled !== 'boolean') throw new PluginError('InvalidPath', 'Invalid disabled flag')
  const base = { id, label: uiString(value.label, 'Field label', 160, 1), ...(value.description === undefined ? {} : { description: uiString(value.description, 'Field description', 2_000) }), ...(value.required === undefined ? {} : { required: value.required }), ...(value.disabled === undefined ? {} : { disabled: value.disabled }), ...(visibleWhen ? { visibleWhen } : {}) }
  const keys = ['id', 'label', 'description', 'required', 'type', 'value', 'disabled', 'visibleWhen']
  if (value.type === 'text' || value.type === 'textarea' || value.type === 'search' || value.type === 'date') {
    if (!hasOnlyKeys(value, new Set([...keys, 'placeholder', 'maxLength'])) || (value.maxLength !== undefined && (typeof value.maxLength !== 'number' || !Number.isInteger(value.maxLength) || value.maxLength < 1 || value.maxLength > 10_000))) throw new PluginError('InvalidPath', 'Invalid text field')
    return { ...base, type: value.type, ...(value.value === undefined ? {} : { value: uiString(value.value, 'Field value', typeof value.maxLength === 'number' ? value.maxLength : 10_000) }), ...(value.placeholder === undefined ? {} : { placeholder: uiString(value.placeholder, 'Placeholder', 500) }), ...(value.maxLength === undefined ? {} : { maxLength: value.maxLength as number }) }
  }
  if (value.type === 'checkbox') {
    if (!hasOnlyKeys(value, new Set(keys)) || (value.value !== undefined && typeof value.value !== 'boolean')) throw new PluginError('InvalidPath', 'Invalid checkbox')
    return { ...base, type: 'checkbox', ...(value.value === undefined ? {} : { value: value.value }) }
  }
  if (value.type === 'number') {
    if (!hasOnlyKeys(value, new Set([...keys, 'min', 'max']))) throw new PluginError('InvalidPath', 'Invalid number field')
    const numeric = (key: string): number | undefined => {
      const number = value[key]
      if (number !== undefined && (typeof number !== 'number' || !Number.isFinite(number))) throw new PluginError('InvalidPath', 'Expected finite number')
      return number as number | undefined
    }
    const initial = numeric('value'), min = numeric('min'), max = numeric('max')
    if ((min !== undefined && max !== undefined && min > max) || (initial !== undefined && ((min !== undefined && initial < min) || (max !== undefined && initial > max)))) throw new PluginError('InvalidPath', 'Invalid numeric bounds')
    return { ...base, type: 'number', ...(initial === undefined ? {} : { value: initial }), ...(min === undefined ? {} : { min }), ...(max === undefined ? {} : { max }) }
  }
  if (value.type === 'select' || value.type === 'note-picker') {
    if (!hasOnlyKeys(value, new Set([...keys, 'options'])) || !Array.isArray(value.options) || (value.type === 'select' && value.options.length < 1) || value.options.length > 100) throw new PluginError('InvalidPath', 'Invalid select')
    const options = value.options.map(option => {
      if (!isPlainRecord(option) || !hasOnlyKeys(option, new Set(['label', 'value']))) throw new PluginError('InvalidPath', 'Invalid select option')
      return { label: uiString(option.label, 'Option label', 160, 1), value: uiString(option.value, 'Option value', value.type === 'note-picker' ? 1024 : 160, 1) }
    })
    const initial = value.value === undefined ? undefined : uiString(value.value, 'Select value', value.type === 'note-picker' ? 1024 : 160)
    if (new Set(options.map(option => option.value)).size !== options.length || (initial !== undefined && !options.some(option => option.value === initial))) throw new PluginError('InvalidPath', 'Duplicate options or invalid initial value')
    return { ...base, type: value.type, options, ...(initial === undefined ? {} : { value: initial }) }
  }
  throw new PluginError('InvalidPath', 'Unknown field type')
}

function validateUiDocument(
  value: unknown,
  commandIds: ReadonlySet<string>,
  depth = 0,
): PluginUiDocument {
  if (depth > 6 || !isPlainRecord(value)
    || !hasOnlyKeys(value, new Set(['blocks', 'expectedForm', 'expectedContextId']))
    || !Array.isArray(value.blocks)
    || value.blocks.length > MAX_UI_BLOCKS) {
    throw new PluginError('InvalidPath', 'Plugin UI content is malformed')
  }

  const blocks: PluginUiDocument['blocks'][number][] = []
  const formIds = new Set<string>()
  const tableIds = new Set<string>()
  for (const candidate of value.blocks) {
    if (!isPlainRecord(candidate) || typeof candidate.type !== 'string') {
      throw new PluginError('InvalidPath', 'Plugin UI block is malformed')
    }
    const extension = parsePluginUiExtension(candidate, children => validateUiDocument({ blocks: children }, commandIds, depth + 1).blocks)
    if (extension) {
      const referenced = extension.type === 'toolbar' ? extension.actions.map(action => action.command)
        : extension.type === 'kanban' ? [extension.openCardCommand, extension.addCardCommand, extension.editColumnCommand, extension.moveCardCommand, extension.reorderColumnsCommand, ...(extension.openNoteCommand ? [extension.openNoteCommand] : [])]
        : extension.type === 'item-list' ? [extension.openCommand, extension.toggleCommand, extension.reorderCommand, ...(extension.actions ?? []).map(action => action.command)] : []
      for (const command of referenced) if (command && !commandIds.has(command)) throw new PluginError('PermissionDenied', 'Undeclared UI command')
      blocks.push(extension)
      flattenPluginUiBlocks(blocks)
      continue
    }
    if (candidate.type === 'form') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'id', 'resetKey', 'fields', 'submitLabel', 'command', 'changeCommand', 'submitDisabled'])) || !Array.isArray(candidate.fields) || candidate.fields.length < 1 || candidate.fields.length > 30) throw new PluginError('InvalidPath', 'Invalid form')
      const id = uiString(candidate.id, 'Form ID', 160, 1)
      if (formIds.has(id)) throw new PluginError('InvalidPath', 'Duplicate form ID')
      formIds.add(id)
      const command = uiString(candidate.command, 'Form command', 220, 1)
      if (!commandIds.has(command)) throw new PluginError('PermissionDenied', 'Undeclared form command')
      const fields = candidate.fields.map(validateFormField)
      if (fields.some(field => field.visibleWhen && !fields.some(item => item.id === field.visibleWhen?.field && item.id !== field.id))) throw new PluginError('InvalidPath', 'Invalid visibility condition field')
      const changeCommand = candidate.changeCommand === undefined ? undefined : uiString(candidate.changeCommand, 'Change command', 220, 1)
      if (changeCommand && !commandIds.has(changeCommand)) throw new PluginError('PermissionDenied', 'Undeclared change command')
      if (candidate.submitDisabled !== undefined && typeof candidate.submitDisabled !== 'boolean') throw new PluginError('InvalidPath', 'Invalid submit disabled flag')
      if (new Set(fields.map(field => field.id)).size !== fields.length) throw new PluginError('InvalidPath', 'Duplicate form field ID')
      blocks.push({ type: 'form', id, command, fields, ...(changeCommand ? { changeCommand } : {}), ...(candidate.submitDisabled === undefined ? {} : { submitDisabled: candidate.submitDisabled }), ...(candidate.resetKey === undefined ? {} : { resetKey: uiString(candidate.resetKey, 'Form reset key', 160) }), submitLabel: uiString(candidate.submitLabel, 'Submit label', 160, 1) })
      continue
    }
    if (candidate.type === 'navigation-list') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'id', 'generation', 'label', 'emptyText', 'addLabel', 'removeLabel', 'reorderLabel', 'items', 'openCommand', 'addCommand', 'removeCommand', 'reorderCommand'])) || !Array.isArray(candidate.items) || candidate.items.length > 100) throw new PluginError('InvalidPath', 'Invalid navigation list')
      const id = uiString(candidate.id, 'Navigation ID', 160, 1)
      if (blocks.some(block => block.type === 'navigation-list' && block.id === id)) throw new PluginError('InvalidPath', 'Duplicate navigation list ID')
      const items = candidate.items.map(item => {
        if (!isPlainRecord(item) || !hasOnlyKeys(item, new Set(['id', 'label']))) throw new PluginError('InvalidPath', 'Invalid navigation item')
        return { id: uiString(item.id, 'Item ID', 1024, 1), label: uiString(item.label, 'Item label', 500, 1) }
      })
      if (new Set(items.map(item => item.id)).size !== items.length) throw new PluginError('InvalidPath', 'Duplicate navigation item ID')
      const command = (key: string) => {
        const value = uiString(candidate[key], 'Command', 220, 1)
        if (!commandIds.has(value)) throw new PluginError('PermissionDenied', 'Undeclared navigation command')
        return value
      }
      blocks.push({ type: 'navigation-list', id, items,
        generation: uiString(candidate.generation, 'Generation', 160, 1), label: uiString(candidate.label, 'Label', 160, 1),
        emptyText: uiString(candidate.emptyText, 'Empty text', 500), addLabel: uiString(candidate.addLabel, 'Add label', 160, 1),
        removeLabel: uiString(candidate.removeLabel, 'Remove label', 160, 1), reorderLabel: uiString(candidate.reorderLabel, 'Reorder label', 160, 1),
        openCommand: command('openCommand'), addCommand: command('addCommand'), removeCommand: command('removeCommand'), reorderCommand: command('reorderCommand'),
      })
      continue
    }
    if (candidate.type === 'separator') {
      if (!hasOnlyKeys(candidate, new Set(['type']))) throw new PluginError('InvalidPath', 'Invalid separator')
      blocks.push({ type: 'separator' })
      continue
    }
    if (candidate.type === 'callout') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'title', 'text', 'tone'])) || (candidate.tone !== undefined && candidate.tone !== 'default' && candidate.tone !== 'destructive')) throw new PluginError('InvalidPath', 'Invalid callout')
      blocks.push({ type: 'callout', title: uiString(candidate.title, 'Callout title', 240, 1), text: uiString(candidate.text, 'Callout text', 20_000), ...(candidate.tone === undefined ? {} : { tone: candidate.tone }) })
      continue
    }
    if (candidate.type === 'progress') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'label', 'value'])) || typeof candidate.value !== 'number' || !Number.isFinite(candidate.value) || candidate.value < 0 || candidate.value > 100) throw new PluginError('InvalidPath', 'Invalid progress')
      blocks.push({ type: 'progress', label: uiString(candidate.label, 'Progress label', 160, 1), value: candidate.value })
      continue
    }
    if (candidate.type === 'table') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'id', 'rowIds', 'columns', 'rows'])) || !Array.isArray(candidate.columns) || candidate.columns.length < 1 || candidate.columns.length > 20 || !Array.isArray(candidate.rows) || candidate.rows.length > 100) throw new PluginError('InvalidPath', 'Invalid table')
      const id = candidate.id === undefined ? undefined : uiString(candidate.id, 'Table ID', 160, 1)
      if (id && tableIds.has(id)) throw new PluginError('InvalidPath', 'Duplicate table ID')
      if (id) tableIds.add(id)
      let rowIds: string[] | undefined
      if (candidate.rowIds !== undefined) {
        if (!Array.isArray(candidate.rowIds)) throw new PluginError('InvalidPath', 'Invalid row IDs')
        rowIds = candidate.rowIds.map(id => uiString(id, 'Row ID', 160, 1))
        if (rowIds.length !== candidate.rows.length || new Set(rowIds).size !== rowIds.length) throw new PluginError('InvalidPath', 'Row IDs must be unique and match row count')
      }
      const columns = candidate.columns.map(column => uiString(column, 'Column', 500))
      const rows = candidate.rows.map(row => {
        if (!Array.isArray(row) || row.length !== columns.length) throw new PluginError('InvalidPath', 'Invalid table row width')
        return row.map(cell => {
          if (typeof cell === 'string') return uiString(cell, 'Cell', 2_000)
          if (!isPlainRecord(cell) || !hasOnlyKeys(cell, new Set(['text', 'command', 'argument', 'disabled'])) || (cell.disabled !== undefined && typeof cell.disabled !== 'boolean')) throw new PluginError('InvalidPath', 'Invalid interactive cell')
          const command = uiString(cell.command, 'Cell command', 220, 1)
          if (!commandIds.has(command)) throw new PluginError('PermissionDenied', 'Undeclared cell command')
          return { text: uiString(cell.text, 'Cell text', 160, 1), command, ...(cell.argument === undefined ? {} : { argument: cloneJsonValue(cell.argument) }), ...(cell.disabled === undefined ? {} : { disabled: cell.disabled }) }
        })
      })
      blocks.push({ type: 'table', columns, rows, ...(id ? { id } : {}), ...(rowIds ? { rowIds } : {}) })
      continue
    }
    if (candidate.type === 'tree') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'items'])) || !Array.isArray(candidate.items) || candidate.items.length > 100) throw new PluginError('InvalidPath', 'Invalid tree')
      const items = candidate.items.map(item => {
        if (!isPlainRecord(item) || !hasOnlyKeys(item, new Set(['id', 'parentId', 'label', 'command', 'argument']))) throw new PluginError('InvalidPath', 'Invalid tree item')
        const command = item.command === undefined ? undefined : uiString(item.command, 'Tree command', 220, 1)
        if (command && !commandIds.has(command)) throw new PluginError('PermissionDenied', 'Undeclared tree command')
        return { id: uiString(item.id, 'Tree ID', 160, 1), label: uiString(item.label, 'Tree label', 500), ...(item.parentId === undefined ? {} : { parentId: uiString(item.parentId, 'Parent ID', 160, 1) }), ...(command === undefined ? {} : { command }), ...(item.argument === undefined ? {} : { argument: cloneJsonValue(item.argument) }) }
      })
      const byId = new Map(items.map(item => [item.id, item]))
      if (byId.size !== items.length) throw new PluginError('InvalidPath', 'Duplicate tree ID')
      for (const item of items) {
        let parent = item.parentId
        const seen = new Set([item.id])
        while (parent !== undefined) {
          if (!byId.has(parent) || seen.has(parent) || seen.size >= 8) throw new PluginError('InvalidPath', 'Invalid tree parent, cycle or depth')
          seen.add(parent)
          parent = byId.get(parent)?.parentId
        }
      }
      blocks.push({ type: 'tree', items })
      continue
    }
    if (candidate.type === 'heading') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'text']))) {
        throw new PluginError('InvalidPath', 'Plugin heading block is malformed')
      }
      blocks.push({ type: 'heading', text: uiString(candidate.text, 'Heading text', 2_000) })
      continue
    }
    if (candidate.type === 'text') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'text', 'tone']))) {
        throw new PluginError('InvalidPath', 'Plugin text block is malformed')
      }
      const tone = candidate.tone
      if (tone !== undefined && tone !== 'default' && tone !== 'muted' && tone !== 'warning') {
        throw new PluginError('InvalidPath', 'Plugin text tone is malformed')
      }
      blocks.push({
        type: 'text',
        text: uiString(candidate.text, 'Text block content', 20_000),
        ...(tone === undefined ? {} : { tone }),
      })
      continue
    }
    if (candidate.type === 'list') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'items']))
        || !Array.isArray(candidate.items)
        || candidate.items.length > 100) {
        throw new PluginError('InvalidPath', 'Plugin list block is malformed')
      }
      blocks.push({
        type: 'list',
        items: candidate.items.map((item) => uiString(item, 'List item', 2_000)),
      })
      continue
    }
    if (candidate.type === 'key-value') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'items']))
        || !Array.isArray(candidate.items)
        || candidate.items.length > 100) {
        throw new PluginError('InvalidPath', 'Plugin key-value block is malformed')
      }
      blocks.push({
        type: 'key-value',
        items: candidate.items.map((item) => {
          if (!isPlainRecord(item) || !hasOnlyKeys(item, new Set(['label', 'value']))) {
            throw new PluginError('InvalidPath', 'Plugin key-value item is malformed')
          }
          return {
            label: uiString(item.label, 'Key-value label', 500),
            value: uiString(item.value, 'Key-value value', 2_000),
          }
        }),
      })
      continue
    }
    if (candidate.type === 'actions') {
      if (!hasOnlyKeys(candidate, new Set(['type', 'actions']))
        || !Array.isArray(candidate.actions)
        || candidate.actions.length > 20) {
        throw new PluginError('InvalidPath', 'Plugin actions block is malformed')
      }
      blocks.push({
        type: 'actions',
        actions: candidate.actions.map((action) => {
          if (!isPlainRecord(action)
            || !hasOnlyKeys(action, new Set(['id', 'label', 'command', 'argument', 'variant', 'disabled']))) {
            throw new PluginError('InvalidPath', 'Plugin UI action is malformed')
          }
          const command = uiString(action.command, 'Action command', 220, 1)
          if (!commandIds.has(command)) {
            throw new PluginError(
              'PermissionDenied',
              `UI action references an undeclared command: ${command}`,
            )
          }
          const variant = action.variant
          if (action.disabled !== undefined && typeof action.disabled !== 'boolean') throw new PluginError('InvalidPath', 'Invalid action disabled flag')
          if (variant !== undefined
            && variant !== 'default'
            && variant !== 'secondary'
            && variant !== 'destructive') {
            throw new PluginError('InvalidPath', 'Plugin UI action variant is malformed')
          }
          return {
            id: uiString(action.id, 'Action ID', 160, 1),
            label: uiString(action.label, 'Action label', 160, 1),
            command,
            ...(action.argument === undefined
              ? {}
              : { argument: cloneJsonValue(action.argument) }),
            ...(variant === undefined ? {} : { variant }),
            ...(action.disabled === undefined ? {} : { disabled: action.disabled }),
          }
        }),
      })
      continue
    }
    throw new PluginError('InvalidPath', `Unknown plugin UI block type: ${candidate.type}`)
  }

  const document: PluginUiDocument = { blocks }
  if (value.expectedContextId !== undefined) document.expectedContextId = uiString(value.expectedContextId, 'Context ID', 160, 1)
  if (value.expectedForm !== undefined) {
    const expected = value.expectedForm
    if (!isPlainRecord(expected) || !hasOnlyKeys(expected, new Set(['formId', 'generation', 'revision'])) || typeof expected.revision !== 'number' || !Number.isSafeInteger(expected.revision) || expected.revision < 0) throw new PluginError('InvalidPath', 'Invalid form snapshot')
    document.expectedForm = { formId: uiString(expected.formId, 'Form ID', 160, 1), generation: uiString(expected.generation, 'Form generation', 160, 1), revision: expected.revision }
  }
  if (utf8Length(JSON.stringify(document)) > MAX_UI_BYTES) {
    throw new PluginError('QuotaExceeded', 'Plugin view exceeds its content limit')
  }
  return document
}

function validateDialogOptions(
  value: unknown,
  commandIds: ReadonlySet<string>,
): PluginDialogOptions {
  if (!isPlainRecord(value)
    || !hasOnlyKeys(value, new Set(['title', 'description', 'content', 'closeLabel', 'replaceId']))) {
    throw new PluginError('InvalidPath', 'Plugin dialog content is malformed')
  }
  const result: PluginDialogOptions = {
    ...(value.replaceId === undefined ? {} : { replaceId: uiString(value.replaceId, 'Dialog replacement ID', 160, 1) }),
    title: uiString(value.title, 'Dialog title', 240, 1),
    content: validateUiDocument(value.content, commandIds),
    ...(value.description === undefined
      ? {}
      : { description: uiString(value.description, 'Dialog description', 2_000) }),
    ...(value.closeLabel === undefined
      ? {}
      : { closeLabel: uiString(value.closeLabel, 'Dialog close label', 160, 1) }),
  }
  if (utf8Length(JSON.stringify(result)) > MAX_UI_BYTES) {
    throw new PluginError('QuotaExceeded', 'Plugin dialog exceeds its content limit')
  }
  return result
}

function normalizeNetworkRequest(request: PluginNetworkRequest): PluginNetworkRequest {
  let parsed: URL
  try {
    parsed = new URL(request.url)
  } catch {
    throw new PluginError('InvalidPath', 'Network URL is invalid')
  }
  const hostname = parsed.hostname.toLowerCase()
  if (parsed.protocol !== 'https:'
    || parsed.username.length > 0
    || parsed.password.length > 0
    || parsed.hash.length > 0
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname.endsWith('.local')
    || /^\[.*\]$/u.test(hostname)
    || /^[\d.]+$/u.test(hostname)) {
    throw new PluginError('PermissionDenied', 'Only public HTTPS hostnames are allowed')
  }

  const method = request.method ?? 'GET'
  if (!NETWORK_METHODS.has(method)) {
    throw new PluginError('InvalidPath', 'Network method is invalid')
  }
  const headers: Record<string, string> = Object.create(null) as Record<string, string>
  if (Object.keys(request.headers ?? {}).length > 100) {
    throw new PluginError('QuotaExceeded', 'Network request declares too many headers')
  }
  for (const [name, value] of Object.entries(request.headers ?? {})) {
    const normalizedName = name.toLowerCase()
    if (!/^[a-z0-9-]{1,100}$(?![\s\S])/u.test(normalizedName)
      || FORBIDDEN_NETWORK_HEADERS.has(normalizedName)
      || normalizedName.startsWith('proxy-')) {
      throw new PluginError('PermissionDenied', `Network header is not allowed: ${name}`)
    }
    if (typeof value !== 'string' || utf8Length(value) > 8_192) {
      throw new PluginError('QuotaExceeded', `Network header is too large: ${name}`)
    }
    headers[normalizedName] = value
  }
  if (request.body !== undefined) {
    if (typeof request.body !== 'string') {
      throw new PluginError('InvalidPath', 'Network request body must be text')
    }
    if (utf8Length(request.body) > MAX_NETWORK_BODY_BYTES) {
      throw new PluginError('QuotaExceeded', 'Network request body exceeds 2 MiB')
    }
  }
  const timeout = request.timeoutMs ?? 15_000
  if (!Number.isInteger(timeout) || timeout < 1_000 || timeout > 30_000) {
    throw new PluginError('InvalidPath', 'Network timeout must be between 1000 and 30000 milliseconds')
  }
  return {
    url: parsed.toString(),
    method,
    headers,
    ...(request.body === undefined ? {} : { body: request.body }),
    timeoutMs: timeout,
  }
}

function normalizeNetworkResponse(value: unknown): PluginNetworkResponse {
  if (!isPlainRecord(value)
    || typeof value.url !== 'string'
    || typeof value.status !== 'number'
    || !Number.isInteger(value.status)
    || Number(value.status) < 100
    || Number(value.status) > 599
    || !isPlainRecord(value.headers)
    || typeof value.body !== 'string') {
    throw new PluginError('RuntimeFailure', 'The test network handler returned a malformed response')
  }
  if (utf8Length(value.body) > MAX_NETWORK_BODY_BYTES) {
    throw new PluginError('QuotaExceeded', 'Network response exceeds 2 MiB')
  }
  const headers: Record<string, string> = Object.create(null) as Record<string, string>
  if (Object.keys(value.headers).length > 100) {
    throw new PluginError('QuotaExceeded', 'Network response declares too many headers')
  }
  for (const [name, headerValue] of Object.entries(value.headers)) {
    if (typeof headerValue !== 'string' || !/^[a-z0-9-]{1,100}$/u.test(name.toLowerCase())) {
      throw new PluginError('RuntimeFailure', 'The test network handler returned a malformed header')
    }
    if (utf8Length(headerValue) > 8_192) {
      throw new PluginError('QuotaExceeded', `Network response header is too large: ${name}`)
    }
    if (name.toLowerCase() !== 'set-cookie') headers[name.toLowerCase()] = headerValue
  }
  return {
    url: value.url,
    status: Number(value.status),
    headers,
    body: value.body,
  }
}

function interpolate(
  message: string,
  values: Record<string, string | number> | undefined,
): string {
  if (!values) return message
  return message.replace(/\{([^{}]+)\}/g, (placeholder, key: string) => {
    const value = values[key]
    return value === undefined ? placeholder : String(value)
  })
}

function datePartRecord(
  parts: readonly Intl.DateTimeFormatPart[],
): Readonly<Record<string, string>> {
  const result = emptyRecord<string>()
  for (const part of parts) {
    if (part.type !== 'literal') result[part.type] = part.value
  }
  return result
}

function requiredDatePart(
  parts: Readonly<Record<string, string>>,
  name: string,
): string {
  const value = parts[name]
  if (value !== undefined) return value
  throw new PluginError('RuntimeFailure', `Calendar result is missing "${name}"`)
}

function previousDate(year: string, month: string, day: string): string {
  const instant = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day) - 1))
  return instant.toISOString().slice(0, 10)
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function compareStrings(left: string, right: string): number {
  if (left < right) return -1
  if (left > right) return 1
  return 0
}

function emptyRecord<Value>(): Record<string, Value> {
  return Object.create(null) as Record<string, Value>
}

function assertSelectionMatchesEditor(
  selection: EditorSelection | null,
  editor: ActiveEditorContext | null,
): void {
  if (!selection) return
  if (!editor || selection.editorId !== editor.editorId) {
    throw new PluginError(
      'NotFound',
      `Selection editor "${selection.editorId}" is not active`,
      { editorId: selection.editorId },
    )
  }
  if (selection.revision !== editor.revision) {
    throw new PluginError(
      'StaleRevision',
      'Selection revision does not match the active editor',
      {
        expectedRevision: editor.revision,
        actualRevision: selection.revision,
      },
    )
  }
}
