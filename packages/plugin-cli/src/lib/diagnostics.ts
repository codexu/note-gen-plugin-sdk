export type DiagnosticSeverity = 'error' | 'warning'

export interface Diagnostic {
  readonly severity: DiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly hint?: string
}

export interface DiagnosticInput {
  readonly severity?: DiagnosticSeverity
  readonly code: string
  readonly message: string
  readonly path?: string
  readonly hint?: string
}

export function diagnostic(input: DiagnosticInput): Diagnostic {
  return Object.freeze({
    severity: input.severity ?? 'error',
    code: input.code,
    message: input.message,
    ...(input.path === undefined ? {} : { path: input.path }),
    ...(input.hint === undefined ? {} : { hint: input.hint }),
  })
}

export class DiagnosticError extends Error {
  readonly diagnostics: readonly Diagnostic[]

  constructor(diagnostics: Diagnostic | readonly Diagnostic[]) {
    const values: readonly Diagnostic[] = Array.isArray(diagnostics)
      ? diagnostics as readonly Diagnostic[]
      : [diagnostics as Diagnostic]
    const first = values[0]
    super(first?.message ?? 'NoteGen plugin validation failed')
    this.name = 'DiagnosticError'
    this.diagnostics = Object.freeze([...values])
  }
}

export function fail(
  code: string,
  message: string,
  path?: string,
  hint?: string,
): never {
  throw new DiagnosticError(diagnostic({ code, message, path, hint }))
}

export function isDiagnosticError(value: unknown): value is DiagnosticError {
  return value instanceof DiagnosticError
}

export function hasDiagnosticErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error')
}

export function formatDiagnostic(value: Diagnostic): string {
  const location = value.path ? ` ${value.path}` : ''
  const hint = value.hint ? `\n  hint: ${value.hint}` : ''
  return `${value.severity.toUpperCase()} [${value.code}]${location}: ${value.message}${hint}`
}

export function diagnosticsFromError(error: unknown): readonly Diagnostic[] {
  if (isDiagnosticError(error)) return error.diagnostics
  if (error instanceof Error) {
    return [diagnostic({
      code: 'internal.unexpected',
      message: error.message || error.name,
    })]
  }
  return [diagnostic({
    code: 'internal.unexpected',
    message: typeof error === 'string' ? error : 'Unexpected failure',
  })]
}
