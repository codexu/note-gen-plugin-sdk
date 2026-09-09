import {
  getNodeValue,
  parseTree,
  printParseErrorCode,
  type Node as JsonNode,
  type ParseError,
} from 'jsonc-parser'

import { fail } from './diagnostics.js'

export type JsonObject = Record<string, unknown>

export interface StrictJsonDocument<T = unknown> {
  readonly text: string
  readonly value: T
}

type JsonContainer = Record<string, unknown> | readonly unknown[]

const integerNumberToken = /^(?:0|[1-9]\d*)$(?![\s\S])/u
const signedIntegerNumberToken = /^(?:0|[1-9]\d*|-[1-9]\d*)$(?![\s\S])/u
const numberTokens = new WeakMap<object, ReadonlyMap<string | number, string>>()

function decodeJsonInput(input: string | Uint8Array, label: string): string {
  if (typeof input === 'string') return input
  try {
    // Keeping a BOM in the decoded result lets us reject it just like serde_json.
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(input)
  } catch {
    fail('json.invalid-utf8', `${label} must be valid UTF-8`, label)
  }
}

function lineAndColumn(text: string, offset: number): string {
  let line = 1
  let column = 1
  for (let index = 0; index < offset && index < text.length; index += 1) {
    if (text.charCodeAt(index) === 0x0a) {
      line += 1
      column = 1
    } else {
      column += 1
    }
  }
  return `${line}:${column}`
}

function propertyPath(segments: readonly (string | number)[]): string {
  let output = '$'
  for (const segment of segments) {
    if (typeof segment === 'number') {
      output += `[${segment}]`
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$(?![\s\S])/.test(segment)) {
      output += `.${segment}`
    } else {
      output += `[${JSON.stringify(segment)}]`
    }
  }
  return output
}

function assertNoDuplicateKeys(
  node: JsonNode,
  text: string,
  label: string,
  path: readonly (string | number)[] = [],
): void {
  if (node.type === 'object') {
    const keys = new Set<string>()
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0]
      const valueNode = property.children?.[1]
      if (!keyNode || typeof keyNode.value !== 'string' || !valueNode) continue
      const key = keyNode.value
      if (keys.has(key)) {
        fail(
          'json.duplicate-key',
          `${label} contains the duplicate object key ${JSON.stringify(key)}`,
          `${propertyPath([...path, key])} (${lineAndColumn(text, keyNode.offset)})`,
        )
      }
      keys.add(key)
      assertNoDuplicateKeys(valueNode, text, label, [...path, key])
    }
    return
  }

  if (node.type === 'array') {
    for (const [index, child] of (node.children ?? []).entries()) {
      assertNoDuplicateKeys(child, text, label, [...path, index])
    }
  }
}

function assertValidSyntax(text: string, label: string): JsonNode {
  if (text.startsWith('\uFEFF')) {
    fail('json.bom', `${label} must not start with a UTF-8 byte-order mark`, label)
  }

  const errors: ParseError[] = []
  const root = parseTree(text, errors, {
    allowEmptyContent: false,
    allowTrailingComma: false,
    disallowComments: true,
  })
  const first = errors[0]
  if (!root || first) {
    const message = first
      ? printParseErrorCode(first.error)
      : 'JSON document has no root value'
    const location = first ? lineAndColumn(text, first.offset) : '1:1'
    fail('json.invalid-syntax', `${label} is not valid strict JSON: ${message}`, `${label}:${location}`)
  }
  return root
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

function assertCompatibleJsonValue(
  value: unknown,
  label: string,
  path: readonly (string | number)[] = [],
): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('json.number-out-of-range', `${label} contains a number outside the JSON range`, propertyPath(path))
    }
    return
  }
  if (typeof value === 'string') {
    if (hasLoneSurrogate(value)) {
      fail(
        'json.invalid-unicode',
        `${label} contains an unpaired UTF-16 surrogate`,
        propertyPath(path),
      )
    }
    return
  }
  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      assertCompatibleJsonValue(child, label, [...path, index])
    }
    return
  }
  if (typeof value === 'object' && value !== null) {
    for (const [key, child] of Object.entries(value)) {
      if (hasLoneSurrogate(key)) {
        fail(
          'json.invalid-unicode',
          `${label} contains an object key with an unpaired UTF-16 surrogate`,
          propertyPath([...path, key]),
        )
      }
      assertCompatibleJsonValue(child, label, [...path, key])
    }
  }
}

function indexNumberTokens(node: JsonNode, value: unknown, text: string): void {
  if (node.type !== 'object' && node.type !== 'array') return
  if (typeof value !== 'object' || value === null) return

  const direct = new Map<string | number, string>()
  if (node.type === 'object' && !Array.isArray(value)) {
    const objectValue = value as Record<string, unknown>
    for (const property of node.children ?? []) {
      const keyNode = property.children?.[0]
      const valueNode = property.children?.[1]
      if (!keyNode || typeof keyNode.value !== 'string' || !valueNode) continue
      const key = keyNode.value
      if (valueNode.type === 'number') {
        direct.set(key, text.slice(valueNode.offset, valueNode.offset + valueNode.length))
      } else {
        indexNumberTokens(valueNode, objectValue[key], text)
      }
    }
  } else if (node.type === 'array' && Array.isArray(value)) {
    for (const [index, child] of (node.children ?? []).entries()) {
      if (child.type === 'number') {
        direct.set(index, text.slice(child.offset, child.offset + child.length))
      } else {
        indexNumberTokens(child, value[index], text)
      }
    }
  }
  numberTokens.set(value, direct)
}

/**
 * Ensures a parsed JSON number used by an integer schema field was written as
 * an integer token. This mirrors serde's u32/i32/u64 decoding, which rejects
 * otherwise equivalent floating-point forms such as `1.0` and `1e0`.
 */
export function assertJsonIntegerToken(
  container: JsonContainer,
  key: string | number,
  path: string,
  options: { readonly signed?: boolean } = {},
): void {
  const token = numberTokens.get(container)?.get(key)
  if (token === undefined) return
  const valid = (options.signed ? signedIntegerNumberToken : integerNumberToken).test(token)
  if (!valid) {
    fail(
      'json.expected-integer-token',
      `${path} must use an integer JSON token without a fraction, exponent, or negative zero`,
      path,
    )
  }
}

/**
 * Parses standard JSON while rejecting comments, trailing commas, BOMs, trailing
 * values, invalid UTF-8, and duplicate keys at every object depth.
 *
 * The returned value preserves the fields supplied by the author. Callers must
 * not add schema defaults before passing it to package signing.
 */
export function parseStrictJsonDocument(
  input: string | Uint8Array,
  label = 'JSON',
): StrictJsonDocument {
  const text = decodeJsonInput(input, label)
  const root = assertValidSyntax(text, label)
  assertNoDuplicateKeys(root, text, label)

  // parseTree has already applied the strict syntax policy. getNodeValue keeps
  // the same JSON value without a schema-driven normalize/reserialize step.
  const value = getNodeValue(root) as unknown
  assertCompatibleJsonValue(value, label)
  indexNumberTokens(root, value, text)
  return { text, value }
}

export function parseStrictJson(input: string | Uint8Array, label = 'JSON'): unknown {
  return parseStrictJsonDocument(input, label).value
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseStrictJsonObject(
  input: string | Uint8Array,
  label = 'JSON',
): JsonObject {
  const value = parseStrictJson(input, label)
  if (!isJsonObject(value)) {
    fail('json.expected-object', `${label} must contain a JSON object`, label)
  }
  return value
}
