import { readFileSync } from 'node:fs'

/** Read the installed package metadata so release bumps cannot leave a stale CLI version. */
export const PLUGIN_CLI_VERSION: string = (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version

export const PACKAGE_EXTENSION = '.notegen-plugin'
export const UNSIGNED_PACKAGE_EXTENSION = '.unsigned.notegen-plugin'
export const DEVELOPMENT_OUTPUT_DIRECTORY = '.notegen/package'
export const RELEASE_OUTPUT_DIRECTORY = '.notegen/releases'

export const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024
export const MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024
export const MAX_ENTRY_BYTES = 10 * 1024 * 1024
export const MAX_ENTRY_FILE_BYTES = 5 * 1024 * 1024
export const MAX_ARCHIVE_ENTRIES = 256
export const MAX_COMPRESSION_RATIO = 100

export const EXIT_SUCCESS = 0
export const EXIT_PROJECT_FAILURE = 1
export const EXIT_USAGE = 2
export const EXIT_UNSAFE_REFUSAL = 3
export const EXIT_UNEXPECTED = 70
export const EXIT_INTERRUPTED = 130
