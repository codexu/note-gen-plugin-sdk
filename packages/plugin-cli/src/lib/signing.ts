import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  KeyObject,
  sign as nodeSign,
  verify as nodeVerify,
  type JsonWebKey,
} from 'node:crypto'

import canonicalize from 'canonicalize'

import { fail } from './diagnostics.js'

const canonicalizeJson = canonicalize as (value: unknown) => string | undefined
const PACKAGE_SIGNATURE_DOMAIN = Buffer.from('NOTEGEN_PLUGIN_SIGNATURE_V1\0', 'utf8')

export const ED25519_PUBLIC_KEY_BYTES = 32
export const ED25519_SIGNATURE_BYTES = 64

export type PrivateKeySource = string | Uint8Array | KeyObject
export type PublicKeySource = string | KeyObject

export interface PrivateKeyOptions {
  readonly passphrase?: string | Uint8Array
}

export interface GeneratedPublisherKeyPair {
  /** PKCS#8 PEM. It is encrypted when a passphrase is supplied. */
  readonly privateKeyPem: string
  /** Raw 32-byte Ed25519 public key encoded with standard padded Base64. */
  readonly publicKey: string
  /** Stable SDK convention; the host treats keyId as signed marketplace metadata. */
  readonly keyId: string
}

function lengthFrame(length: number): Buffer {
  if (!Number.isSafeInteger(length) || length < 0) {
    fail('signature.invalid-length', 'Signature message length is outside the supported range')
  }
  const bytes = Buffer.alloc(8)
  bytes.writeBigUInt64BE(BigInt(length))
  return bytes
}

export function canonicalJsonBytes(value: unknown): Buffer {
  let serialized: string | undefined
  try {
    serialized = canonicalizeJson(value)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'value is not canonicalizable'
    fail('signature.invalid-json', `Unable to canonicalize signed JSON: ${message}`)
  }
  if (typeof serialized !== 'string') {
    fail('signature.invalid-json', 'Signed value is not valid canonical JSON')
  }
  return Buffer.from(serialized, 'utf8')
}

export function createPackageSignatureMessage(
  manifestValue: unknown,
  integrityValue: unknown,
): Buffer {
  const manifest = canonicalJsonBytes(manifestValue)
  const integrity = canonicalJsonBytes(integrityValue)
  return Buffer.concat([
    PACKAGE_SIGNATURE_DOMAIN,
    lengthFrame(manifest.byteLength),
    manifest,
    lengthFrame(integrity.byteLength),
    integrity,
  ])
}

function decodeBase64(value: string, expectedBytes: number, label: string): Buffer {
  const compact = [...value]
    .filter((character) => !/\p{White_Space}/u.test(character))
    .join('')
  let decoded: Buffer | undefined

  const paddedStandard = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$(?![\s\S])/u
  const unpaddedStandard = /^[A-Za-z0-9+/]*$(?![\s\S])/u
  const unpaddedUrlSafe = /^[A-Za-z0-9_-]*$(?![\s\S])/u
  if (paddedStandard.test(compact) && compact.length % 4 === 0) {
    const candidate = Buffer.from(compact, 'base64')
    if (candidate.toString('base64') === compact) decoded = candidate
  } else if (unpaddedStandard.test(compact) && compact.length % 4 !== 1) {
    const candidate = Buffer.from(compact, 'base64')
    if (candidate.toString('base64').replace(/=+$/u, '') === compact) decoded = candidate
  } else if (unpaddedUrlSafe.test(compact) && compact.length % 4 !== 1) {
    const candidate = Buffer.from(compact, 'base64url')
    if (candidate.toString('base64url') === compact) decoded = candidate
  }

  if (!decoded) fail('signature.invalid-base64', `${label} is not valid Base64`, label)
  if (decoded.byteLength !== expectedBytes) {
    fail('signature.invalid-length', `${label} must decode to ${expectedBytes} bytes`, label)
  }
  return decoded
}

export function decodePublisherPublicKey(value: string): Buffer {
  return decodeBase64(value, ED25519_PUBLIC_KEY_BYTES, 'publisher public key')
}

export function decodePackageSignature(value: string): Buffer {
  return decodeBase64(value, ED25519_SIGNATURE_BYTES, 'signature.sig')
}

function publicKeyObject(source: PublicKeySource): KeyObject {
  if (typeof source !== 'string') {
    if (source.type !== 'public' || source.asymmetricKeyType !== 'ed25519') {
      fail('signature.invalid-public-key', 'Publisher public key must be an Ed25519 public key')
    }
    return source
  }
  const raw = decodePublisherPublicKey(source)
  try {
    return createPublicKey({
      key: {
        kty: 'OKP',
        crv: 'Ed25519',
        x: raw.toString('base64url'),
      },
      format: 'jwk',
    })
  } catch {
    fail('signature.invalid-public-key', 'Unable to import the Ed25519 publisher public key')
  }
}

function privateKeyObject(source: PrivateKeySource, options: PrivateKeyOptions = {}): KeyObject {
  let key: KeyObject
  try {
    key = source instanceof KeyObject
      ? source
      : createPrivateKey({
          key: typeof source === 'string' ? source : Buffer.from(source),
          format: 'pem',
          ...(options.passphrase === undefined ? {} : {
            passphrase: typeof options.passphrase === 'string' ? options.passphrase : Buffer.from(options.passphrase),
          }),
        })
  } catch {
    fail('signature.invalid-private-key', 'Unable to import the PKCS#8 publisher private key')
  }
  if (key.type !== 'private' || key.asymmetricKeyType !== 'ed25519') {
    fail('signature.invalid-private-key', 'Publisher private key must be an Ed25519 private key')
  }
  return key
}

function rawPublicKey(key: KeyObject): Buffer {
  let exported: JsonWebKey
  try {
    exported = key.export({ format: 'jwk' })
  } catch {
    fail('signature.invalid-public-key', 'Unable to export the Ed25519 publisher public key')
  }
  if (exported.kty !== 'OKP' || exported.crv !== 'Ed25519' || typeof exported.x !== 'string') {
    fail('signature.invalid-public-key', 'Publisher public key is not raw Ed25519 key material')
  }
  const raw = Buffer.from(exported.x, 'base64url')
  if (raw.byteLength !== ED25519_PUBLIC_KEY_BYTES) {
    fail('signature.invalid-public-key', 'Publisher public key must contain 32 raw bytes')
  }
  return raw
}

export function publisherPublicKeyFromPrivate(
  privateKey: PrivateKeySource,
  options: PrivateKeyOptions = {},
): string {
  const publicKey = createPublicKey(privateKeyObject(privateKey, options))
  return rawPublicKey(publicKey).toString('base64')
}

export function publisherKeyId(publicKey: PublicKeySource): string {
  const raw = typeof publicKey === 'string'
    ? decodePublisherPublicKey(publicKey)
    : rawPublicKey(publicKeyObject(publicKey))
  return `ed25519-${createHash('sha256').update(raw).digest('hex')}`
}

export function generatePublisherKeyPair(passphrase?: string | Uint8Array): GeneratedPublisherKeyPair {
  const generated = generateKeyPairSync('ed25519')
  const exportedPrivate = passphrase === undefined
    ? generated.privateKey.export({ type: 'pkcs8', format: 'pem' })
    : generated.privateKey.export({
        type: 'pkcs8',
        format: 'pem',
        cipher: 'aes-256-cbc',
        passphrase: typeof passphrase === 'string' ? passphrase : Buffer.from(passphrase),
      })
  const publicKey = rawPublicKey(generated.publicKey).toString('base64')
  return {
    privateKeyPem: exportedPrivate.toString(),
    publicKey,
    keyId: publisherKeyId(publicKey),
  }
}

export function signPackage(
  manifestValue: unknown,
  integrityValue: unknown,
  privateKey: PrivateKeySource,
  options: PrivateKeyOptions = {},
): string {
  const key = privateKeyObject(privateKey, options)
  const signature = nodeSign(null, createPackageSignatureMessage(manifestValue, integrityValue), key)
  if (signature.byteLength !== ED25519_SIGNATURE_BYTES) {
    fail('signature.invalid-length', 'Ed25519 signer returned an unexpected signature length')
  }
  return signature.toString('base64')
}

export function verifyPackageSignature(
  manifestValue: unknown,
  integrityValue: unknown,
  signatureBase64: string,
  publicKey: PublicKeySource,
): boolean {
  const signature = decodePackageSignature(signatureBase64)
  const key = publicKeyObject(publicKey)
  return nodeVerify(
    null,
    createPackageSignatureMessage(manifestValue, integrityValue),
    key,
    signature,
  )
}

export function assertPackageSignature(
  manifestValue: unknown,
  integrityValue: unknown,
  signatureBase64: string,
  publicKey: PublicKeySource,
): void {
  if (!verifyPackageSignature(manifestValue, integrityValue, signatureBase64, publicKey)) {
    fail('signature.verification-failed', 'Ed25519 package signature verification failed', 'signature.sig')
  }
}
