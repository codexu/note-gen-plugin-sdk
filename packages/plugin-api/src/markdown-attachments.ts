import type { PluginRenderedDocument } from './index.js'

/** Resolve an image reference against a workspace-relative Markdown note. */
export function resolveMarkdownAttachmentPath(notePath: string, source: string): string | null {
  if (/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(source)) return null
  let decoded: string
  try { decoded = decodeURIComponent(source.split(/[?#]/)[0]) } catch { return null }
  const parts = notePath.split('/').slice(0, -1)
  for (const part of decoded.replace(/\\/g, '/').split('/')) {
    if (part === '..') { if (!parts.length) return null; parts.pop() }
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/') || null
}

/** Collect unique Markdown image references in source order. */
export function collectMarkdownImageSources(markdown: string, limit = 32): string[] {
  return [...new Set(Array.from(markdown.matchAll(/!\[[^\]]*\]\((?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g), match => match[1] ?? match[2]))].slice(0, Math.max(0, limit))
}

/** Use renderer warnings to explain which references still need explicit image mappings. */
export function unresolvedMarkdownImageSources(warnings: PluginRenderedDocument['warnings']): string[] {
  return [...new Set(warnings.filter(item => item.code === 'image-unresolved' && item.source).map(item => item.source!))]
}
