export interface ManifestValidationResult {
  isValid: boolean
  invalidLines: number[]
  totalCount: number
  hasMore: boolean
}

const MANIFEST_ENTRY_REGEX = /^\s*[-*]\s+(?:\*\*|)?([a-zA-Z0-9_\.\-]+)(?:\*\*|)?\s*(?:[—–:\-]+)\s*(.+)$/

/**
 * Check if a workspace path is a section manifest (<folder>/<FOLDER>.md).
 */
export function isManifestPath(path: string): boolean {
  if (!path) return false
  const normalized = path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const parts = normalized.split('/')
  if (parts.length !== 2) return false
  const [folder, filename] = parts
  return filename.toUpperCase() === `${folder.toUpperCase()}.MD`
}

/**
 * Validate manifest text content against expected line format:
 *   - Blank lines (valid)
 *   - Entry line: `- filename.md — Description` (valid)
 *   - Non-compliant lines: Flagged with 1-indexed line numbers, capped at maxReported
 */
export function validateManifestText(content: string, maxReported = 5): ManifestValidationResult {
  if (!content || !content.trim()) {
    return {
      isValid: true,
      invalidLines: [],
      totalCount: 0,
      hasMore: false,
    }
  }

  const invalidLines: number[] = []
  let totalCount = 0

  const lines = content.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    if (!MANIFEST_ENTRY_REGEX.test(line)) {
      totalCount++
      if (invalidLines.length < maxReported) {
        invalidLines.push(i + 1)
      }
    }
  }

  return {
    isValid: totalCount === 0,
    invalidLines,
    totalCount,
    hasMore: totalCount > invalidLines.length,
  }
}

/**
 * Format tooltip description for manifest validation errors.
 */
export function formatManifestTooltip(issues: ManifestValidationResult): string {
  if (issues.isValid || issues.totalCount === 0) return ''
  const lineStr = issues.invalidLines.join(', ')
  const moreStr = issues.hasMore ? ` (+${issues.totalCount - issues.invalidLines.length} more)` : ''
  const lineLabel = issues.totalCount === 1 ? `line ${lineStr}` : `lines ${lineStr}${moreStr}`
  return `Manifest formatting issue on ${lineLabel} (expected '- filename.md — Description')`
}
