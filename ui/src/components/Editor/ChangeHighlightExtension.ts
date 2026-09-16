import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import { DOMParser, Node as ProsemirrorNode } from '@tiptap/pm/model'
import { useEditorStore } from '../../stores/editorStore'
import { useSettingsStore } from '../../stores/settingsStore'

export const changeHighlightPluginKey = new PluginKey('changeHighlight')

// ─── Token & Block diffing helpers ───────────────────────────────────────────

type Tag = 'equal' | 'replace' | 'delete' | 'insert'

interface BlockOp {
  tag: Tag
  i1: number
  i2: number
  j1: number
  j2: number
}

export interface DocBlock {
  pos: number
  nodeSize: number
  text: string
}

interface DiffOp {
  type: 'equal' | 'delete' | 'insert'
  delText: string
  insText: string
  charOffset: number
  insLen: number
}

function tokenize(text: string): string[] {
  // Matches word tokens, punctuation tokens, or whitespace runs
  return text.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}\s]+|\s+/gu) || []
}

function levenshtein(a: string, b: string): number {
  const n = a.length
  const m = b.length
  const d: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 0; i <= n; i++) d[i][0] = i
  for (let j = 0; j <= m; j++) d[0][j] = j
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost)
    }
  }
  return d[n][m]
}

function getWordOnly(token: string): string {
  const m = token.match(/^[\p{L}\p{N}]+/u)
  return m ? m[0] : ''
}

function isIntraWordEdit(baseToken: string, currToken: string): boolean {
  const baseWord = getWordOnly(baseToken)
  const currWord = getWordOnly(currToken)
  if (!baseWord || !currWord) return false
  if (baseWord === currWord) return true

  const minLen = Math.min(baseWord.length, currWord.length)
  const maxLen = Math.max(baseWord.length, currWord.length)

  // Exact prefix match (e.g. walk -> walking, running -> run)
  if (baseWord.startsWith(currWord) || currWord.startsWith(baseWord)) {
    return true
  }

  // Exact suffix match (e.g. national -> international)
  if (baseWord.endsWith(currWord) || currWord.endsWith(baseWord)) {
    return true
  }

  // Small typo/edit distance relative to word length (e.g. recieve -> receive, wnd -> wind)
  const dist = levenshtein(baseWord, currWord)
  if (dist <= 2 && minLen >= 3 && dist / maxLen <= 0.35) {
    return true
  }

  return false
}

function diffStringsCharLevel(aStr: string, bStr: string): Array<{ type: 'equal' | 'delete' | 'insert'; delText: string; insText: string }> {
  const a = Array.from(aStr)
  const b = Array.from(bStr)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  let i = 0
  let j = 0
  const raw: Array<{ type: 'equal' | 'delete' | 'insert'; i1: number; i2: number; j1: number; j2: number }> = []

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      raw.push({ type: 'equal', i1: i, i2: i + 1, j1: j, j2: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ type: 'delete', i1: i, i2: i + 1, j1: j, j2: j })
      i++
    } else {
      raw.push({ type: 'insert', i1: i, i2: i, j1: j, j2: j + 1 })
      j++
    }
  }
  while (i < n) {
    raw.push({ type: 'delete', i1: i, i2: i + 1, j1: j, j2: j })
    i++
  }
  while (j < m) {
    raw.push({ type: 'insert', i1: i, i2: i, j1: j, j2: j + 1 })
    j++
  }

  const ops: Array<{ type: 'equal' | 'delete' | 'insert'; delText: string; insText: string }> = []
  for (let k = 0; k < raw.length; k++) {
    const cur = raw[k]
    let i1 = cur.i1
    let i2 = cur.i2
    let j1 = cur.j1
    let j2 = cur.j2
    while (k + 1 < raw.length && raw[k + 1].type === cur.type) {
      k++
      i2 = raw[k].i2
      j2 = raw[k].j2
    }
    ops.push({
      type: cur.type,
      delText: a.slice(i1, i2).join(''),
      insText: b.slice(j1, j2).join(''),
    })
  }
  return ops
}

function isWhitespaceToken(token: string): boolean {
  return /^\s+$/.test(token)
}

export function diffTokens(baseText: string, currText: string): DiffOp[] {
  const a = tokenize(baseText)
  const b = tokenize(currText)
  const n = a.length
  const m = b.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))

  // Whitespace tokens are ONLY eligible to match if at least one adjacent token also matches
  const canMatch = (i: number, j: number): boolean => {
    if (a[i] !== b[j]) return false
    if (!isWhitespaceToken(a[i])) return true
    const prevMatch = i > 0 && j > 0 && a[i - 1] === b[j - 1] && !isWhitespaceToken(a[i - 1])
    const nextMatch = i + 1 < n && j + 1 < m && a[i + 1] === b[j + 1] && !isWhitespaceToken(a[i + 1])
    return prevMatch || nextMatch
  }

  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (canMatch(i, j)) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  let i = 0
  let j = 0
  const raw: BlockOp[] = []

  while (i < n && j < m) {
    if (canMatch(i, j) && dp[i][j] === dp[i + 1][j + 1] + 1) {
      raw.push({ tag: 'equal', i1: i, i2: i + 1, j1: j, j2: j + 1 })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      raw.push({ tag: 'delete', i1: i, i2: i + 1, j1: j, j2: j })
      i++
    } else {
      raw.push({ tag: 'insert', i1: i, i2: i, j1: j, j2: j + 1 })
      j++
    }
  }
  while (i < n) {
    raw.push({ tag: 'delete', i1: i, i2: i + 1, j1: j, j2: j })
    i++
  }
  while (j < m) {
    raw.push({ tag: 'insert', i1: i, i2: i, j1: j, j2: j + 1 })
    j++
  }

  // Merge adjacent change operations
  const grouped: BlockOp[] = []
  for (const op of raw) {
    const prev = grouped[grouped.length - 1]
    if (!prev) {
      grouped.push({ ...op })
      continue
    }
    if (prev.tag === 'equal' && op.tag === 'equal') {
      prev.i2 = op.i2
      prev.j2 = op.j2
    } else if (prev.tag !== 'equal' && op.tag !== 'equal') {
      prev.tag = 'replace'
      prev.i2 = Math.max(prev.i2, op.i2)
      prev.j2 = Math.max(prev.j2, op.j2)
    } else {
      grouped.push({ ...op })
    }
  }

  const finalOps: DiffOp[] = []
  let currCharOffset = 0

  for (const op of grouped) {
    const delTokens = a.slice(op.i1, op.i2)
    const insTokens = b.slice(op.j1, op.j2)
    const delText = delTokens.join('')
    const insText = insTokens.join('')

    if (op.tag === 'equal') {
      finalOps.push({
        type: 'equal',
        delText: '',
        insText: '',
        charOffset: currCharOffset,
        insLen: insText.length,
      })
      currCharOffset += insText.length
    } else if (op.tag === 'insert') {
      let iText = insText
      let trailingSpace = ''
      const iMatch = iText.match(/\s+$/)
      if (iMatch) {
        trailingSpace = iMatch[0]
        iText = iText.slice(0, -trailingSpace.length)
      }

      if (iText.length > 0) {
        finalOps.push({
          type: 'insert',
          delText: '',
          insText: iText,
          charOffset: currCharOffset,
          insLen: iText.length,
        })
        currCharOffset += iText.length
      }
      if (trailingSpace.length > 0) {
        finalOps.push({
          type: 'equal',
          delText: '',
          insText: trailingSpace,
          charOffset: currCharOffset,
          insLen: trailingSpace.length,
        })
        currCharOffset += trailingSpace.length
      }
    } else if (op.tag === 'delete') {
      let dText = delText
      const dMatch = dText.match(/\s+$/)
      if (dMatch) {
        dText = dText.slice(0, -dMatch[0].length)
      }
      if (dText.length > 0) {
        finalOps.push({
          type: 'delete',
          delText: dText,
          insText: '',
          charOffset: currCharOffset,
          insLen: 0,
        })
      }
    } else if (op.tag === 'replace') {
      // Check if this is a single word edit (e.g. 1 base token vs 1 curr token and isIntraWordEdit)
      if (delTokens.length === 1 && insTokens.length === 1 && isIntraWordEdit(delTokens[0], insTokens[0])) {
        // Run intra-word character diff
        const charDiffs = diffStringsCharLevel(delTokens[0], insTokens[0])
        let intraOffset = 0
        for (const cd of charDiffs) {
          if (cd.type === 'equal') {
            intraOffset += cd.insText.length
          } else if (cd.type === 'insert') {
            finalOps.push({
              type: 'insert',
              delText: '',
              insText: cd.insText,
              charOffset: currCharOffset + intraOffset,
              insLen: cd.insText.length,
            })
            intraOffset += cd.insText.length
          } else if (cd.type === 'delete') {
            finalOps.push({
              type: 'delete',
              delText: cd.delText,
              insText: '',
              charOffset: currCharOffset + intraOffset,
              insLen: 0,
            })
          }
        }
        currCharOffset += insText.length
      } else {
        // Whole word / phrase replacement:
        // Factor out common or trailing whitespace so neither strikethrough nor underline bleed into trailing space
        let dText = delText
        let iText = insText
        let trailingSpace = ''

        const dMatch = dText.match(/\s+$/)
        const iMatch = iText.match(/\s+$/)
        if (dMatch && iMatch) {
          const commonSpaceLen = Math.min(dMatch[0].length, iMatch[0].length)
          trailingSpace = iMatch[0].slice(0, commonSpaceLen)
          dText = dText.slice(0, -commonSpaceLen)
          iText = iText.slice(0, -commonSpaceLen)
        } else if (dMatch) {
          dText = dText.slice(0, -dMatch[0].length)
        } else if (iMatch) {
          trailingSpace = iMatch[0]
          iText = iText.slice(0, -trailingSpace.length)
        }

        if (dText.length > 0) {
          finalOps.push({
            type: 'delete',
            delText: dText,
            insText: '',
            charOffset: currCharOffset,
            insLen: 0,
          })
        }
        if (iText.length > 0) {
          finalOps.push({
            type: 'insert',
            delText: '',
            insText: iText,
            charOffset: currCharOffset,
            insLen: iText.length,
          })
          currCharOffset += iText.length
        }
        if (trailingSpace.length > 0) {
          finalOps.push({
            type: 'equal',
            delText: '',
            insText: trailingSpace,
            charOffset: currCharOffset,
            insLen: trailingSpace.length,
          })
          currCharOffset += trailingSpace.length
        }
      }
    }
  }

  return finalOps
}

const baseBlocksCache = new Map<string, string[]>()

export function getBaseBlocks(editor: any, baseContent: string): string[] {
  if (!baseContent) return []
  const normalized = baseContent.replace(/\r\n/g, '\n')
  const cached = baseBlocksCache.get(normalized)
  if (cached) return cached

  let blocks: string[] = []
  try {
    const parser = editor?.storage?.markdown?.parser
    if (parser && editor?.schema) {
      const html = parser.parse(normalized)
      const element = document.createElement('div')
      element.innerHTML = typeof html === 'string' ? html : ''
      const baseDoc = DOMParser.fromSchema(editor.schema).parse(element)
      baseDoc.descendants((child) => {
        if (child.isTextblock) {
          blocks.push(child.textContent)
          return false
        }
        return true
      })
    }
  } catch (e) {
    console.warn('Failed to parse baseContent with markdown parser, falling back to regex:', e)
  }

  if (blocks.length === 0) {
    blocks = normalized
      .split(/\n\s*\n/)
      .map((p) => p.replace(/^(#{1,6}\s+|>\s+|[-*+]\s+|\d+\.\s+)/gm, '').trim())
      .filter((p) => p.length > 0)
  }

  if (baseBlocksCache.size > 20) {
    baseBlocksCache.clear()
  }
  baseBlocksCache.set(normalized, blocks)
  return blocks
}

export function extractTextBlocks(doc: ProsemirrorNode): DocBlock[] {
  const blocks: DocBlock[] = []
  doc.descendants((child, pos) => {
    if (child.isTextblock) {
      blocks.push({
        pos,
        nodeSize: child.nodeSize,
        text: child.textContent,
      })
      return false
    }
    return true
  })
  return blocks
}

export function canonicalizeText(text: string): string {
  if (!text) return ''
  return text
    // Replace smart/curly single quotes and apostrophes with straight apostrophe
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035`]/g, "'")
    // Replace smart/curly double quotes with straight double quote
    .replace(/[\u201C\u201D\u201E\u201F\u2033\u2036«»]/g, '"')
    // Normalize dashes (em-dash, en-dash, horizontal bar) and collapse spaces around dashes
    .replace(/\s*[\u2013\u2014\u2015]\s*/g, '—')
    .replace(/\s*--\s*/g, '—')
    // Replace non-breaking spaces and zero-width spaces
    .replace(/[\u00A0\u202F\u2007]/g, ' ')
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')
    // Collapse all whitespace runs
    .replace(/\s+/g, ' ')
    .trim()
}

export function isBlockEqual(a: string, b: string): boolean {
  if (a === b) return true
  if (a.trim() === b.trim()) return true
  return canonicalizeText(a) === canonicalizeText(b)
}

function normalizeSpaces(text: string): string {
  return text.replace(/[\u00A0\s]+/g, ' ').trim()
}

function tokenLcsLength(a: string[], b: string[]): number {
  const n = a.length
  const m = b.length
  if (n === 0 || m === 0) return 0

  let prev = new Array(m + 1).fill(0)
  let curr = new Array(m + 1).fill(0)

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (a[i - 1] === b[j - 1]) {
        curr[j] = prev[j - 1] + 1
      } else {
        curr[j] = Math.max(prev[j], curr[j - 1])
      }
    }
    const temp = prev
    prev = curr
    curr = temp
    curr.fill(0)
  }

  return prev[m]
}

function extractWordTokens(text: string): string[] {
  const matches = text.match(/[\p{L}\p{N}]+/gu)
  return matches ? matches.map((m) => m.toLowerCase()) : []
}

export function computeBlockSimilarity(a: string, b: string): number {
  if (a === b) return 1.0
  if (a.trim() === b.trim()) return 0.99
  if (isBlockEqual(a, b)) return 1.0

  const normA = normalizeSpaces(a)
  const normB = normalizeSpaces(b)
  if (normA === normB) return 0.98
  if (!normA || !normB) return 0.0

  const wordsA = extractWordTokens(normA)
  const wordsB = extractWordTokens(normB)

  // If both blocks have no alphanumeric words (e.g. markdown dividers '***' or '---')
  if (wordsA.length === 0 && wordsB.length === 0) {
    return normA === normB || isBlockEqual(a, b) ? 1.0 : 0.0
  }
  if (wordsA.length === 0 || wordsB.length === 0) return 0.0

  const lcsLen = tokenLcsLength(wordsA, wordsB)
  const wordSim = (2 * lcsLen) / (wordsA.length + wordsB.length)

  // For short blocks / headings with few words, also check character-level Levenshtein similarity
  if (wordsA.length <= 4 && wordsB.length <= 4) {
    const dist = levenshtein(normA.toLowerCase(), normB.toLowerCase())
    const maxLen = Math.max(normA.length, normB.length)
    const charSim = maxLen > 0 ? Math.max(0, 1 - dist / maxLen) : 1
    return Math.max(wordSim, charSim)
  }

  return wordSim
}

export function diffBlockSequences(a: string[], b: string[]): BlockOp[] {
  const n = a.length
  const m = b.length

  if (n === 0 && m === 0) return []
  if (n === 0) {
    return [{ tag: 'insert' as Tag, i1: 0, i2: 0, j1: 0, j2: m }]
  }
  if (m === 0) {
    return [{ tag: 'delete' as Tag, i1: 0, i2: n, j1: 0, j2: 0 }]
  }

  // Fast path: Exact or canonical common prefix trimming
  let prefixLen = 0
  const maxPrefix = Math.min(n, m)
  while (prefixLen < maxPrefix && isBlockEqual(a[prefixLen], b[prefixLen])) {
    prefixLen++
  }

  // Fast path: Exact or canonical common suffix trimming
  let suffixLen = 0
  const maxSuffix = Math.min(n - prefixLen, m - prefixLen)
  while (suffixLen < maxSuffix && isBlockEqual(a[n - 1 - suffixLen], b[m - 1 - suffixLen])) {
    suffixLen++
  }

  const ops: BlockOp[] = []

  if (prefixLen > 0) {
    ops.push({ tag: 'equal', i1: 0, i2: prefixLen, j1: 0, j2: prefixLen })
  }

  // Middle slice to align with DP
  const midA = a.slice(prefixLen, n - suffixLen)
  const midB = b.slice(prefixLen, m - suffixLen)
  const midN = midA.length
  const midM = midB.length

  if (midN === 0 && midM > 0) {
    ops.push({ tag: 'insert', i1: prefixLen, i2: prefixLen, j1: prefixLen, j2: prefixLen + midM })
  } else if (midN > 0 && midM === 0) {
    ops.push({ tag: 'delete', i1: prefixLen, i2: prefixLen + midN, j1: prefixLen, j2: prefixLen })
  } else if (midN > 0 && midM > 0) {
    // Pre-tokenize words for the middle slices only
    const midWordsA = midA.map((t) => extractWordTokens(normalizeSpaces(t)))
    const midWordsB = midB.map((t) => extractWordTokens(normalizeSpaces(t)))

    const SIM_THRESHOLD = 0.35
    const dp: number[][] = Array.from({ length: midN + 1 }, () => new Array(midM + 1).fill(0))
    // choice: 0 = delete a[i], 1 = insert b[j], 2 = match/replace a[i] <-> b[j]
    const choice: number[][] = Array.from({ length: midN + 1 }, () => new Array(midM + 1).fill(0))

    for (let i = midN - 1; i >= 0; i--) {
      for (let j = midM - 1; j >= 0; j--) {
        // Option 1: Delete midA[i]
        let bestScore = dp[i + 1][j] - 0.0001
        let bestChoice = 0

        // Option 2: Insert midB[j]
        const insScore = dp[i][j + 1] - 0.0001
        if (insScore > bestScore) {
          bestScore = insScore
          bestChoice = 1
        }

        // Option 3: Align/replace midA[i] with midB[j] if similarity meets threshold
        let sim = 0
        if (isBlockEqual(midA[i], midB[j])) {
          sim = 1.0
        } else {
          const wA = midWordsA[i]
          const wB = midWordsB[j]
          if (wA.length === 0 && wB.length === 0) {
            sim = isBlockEqual(midA[i], midB[j]) ? 1.0 : 0.0
          } else if (wA.length > 0 && wB.length > 0) {
            const lcsLen = tokenLcsLength(wA, wB)
            sim = (2 * lcsLen) / (wA.length + wB.length)
            if (wA.length <= 4 && wB.length <= 4) {
              const normA = normalizeSpaces(midA[i]).toLowerCase()
              const normB = normalizeSpaces(midB[j]).toLowerCase()
              const dist = levenshtein(normA, normB)
              const maxLen = Math.max(normA.length, normB.length)
              const charSim = maxLen > 0 ? Math.max(0, 1 - dist / maxLen) : 1
              sim = Math.max(sim, charSim)
            }
          }
        }

        if (sim >= SIM_THRESHOLD) {
          let reward = 0.5 + (sim - SIM_THRESHOLD) * (1.5 / (1.0 - SIM_THRESHOLD))
          if (sim === 1.0) reward = 2.01 // strong preference for exact matches
          else if (sim >= 0.98) reward = 1.99

          const matchScore = dp[i + 1][j + 1] + reward
          if (matchScore > bestScore) {
            bestScore = matchScore
            bestChoice = 2
          }
        }

        dp[i][j] = bestScore
        choice[i][j] = bestChoice
      }
    }

    let i = 0
    let j = 0

    while (i < midN && j < midM) {
      const c = choice[i][j]
      const absI = prefixLen + i
      const absJ = prefixLen + j
      if (c === 2) {
        if (isBlockEqual(midA[i], midB[j])) {
          ops.push({ tag: 'equal', i1: absI, i2: absI + 1, j1: absJ, j2: absJ + 1 })
        } else {
          ops.push({ tag: 'replace', i1: absI, i2: absI + 1, j1: absJ, j2: absJ + 1 })
        }
        i++
        j++
      } else if (c === 0) {
        ops.push({ tag: 'delete', i1: absI, i2: absI + 1, j1: absJ, j2: absJ })
        i++
      } else {
        ops.push({ tag: 'insert', i1: absI, i2: absI, j1: absJ, j2: absJ + 1 })
        j++
      }
    }

    while (i < midN) {
      const absI = prefixLen + i
      const absJ = prefixLen + j
      ops.push({ tag: 'delete', i1: absI, i2: absI + 1, j1: absJ, j2: absJ })
      i++
    }

    while (j < midM) {
      const absI = prefixLen + i
      const absJ = prefixLen + j
      ops.push({ tag: 'insert', i1: absI, i2: absI, j1: absJ, j2: absJ + 1 })
      j++
    }
  }

  if (suffixLen > 0) {
    ops.push({
      tag: 'equal',
      i1: n - suffixLen,
      i2: n,
      j1: m - suffixLen,
      j2: m,
    })
  }

  // Group adjacent operations of the same tag (e.g. consecutive inserts or consecutive deletes)
  const groupedOps: BlockOp[] = []
  for (const op of ops) {
    const prev = groupedOps[groupedOps.length - 1]
    if (!prev) {
      groupedOps.push({ ...op })
      continue
    }
    if (prev.tag === op.tag) {
      if (op.tag === 'delete' && prev.j1 === op.j1) {
        prev.i2 = op.i2
        continue
      }
      if (op.tag === 'insert' && prev.i1 === op.i1) {
        prev.j2 = op.j2
        continue
      }
      if (op.tag === 'equal' && prev.i2 === op.i1 && prev.j2 === op.j1) {
        prev.i2 = op.i2
        prev.j2 = op.j2
        continue
      }
    }
    groupedOps.push({ ...op })
  }

  return groupedOps
}

function createDeletedSpan(text: string): HTMLElement {
  const span = document.createElement('span')
  span.className = 'diff-deletion'
  span.textContent = text
  span.style.pointerEvents = 'none'
  span.style.userSelect = 'none'
  return span
}

function createDeletedBlock(text: string): HTMLElement {
  const div = document.createElement('div')
  div.className = 'diff-deletion-block'
  div.textContent = text
  div.style.pointerEvents = 'none'
  div.style.userSelect = 'none'
  return div
}

interface ChangeHighlightPluginState {
  decorations: DecorationSet
  baseContent: string | null
  showAdditions: boolean
  showDeletions: boolean
}

function syncDocumentDiffStatus(hasChanges: boolean) {
  const store = useEditorStore.getState()
  if (store.hasDiffChanges !== hasChanges) {
    store.setHasDiffChanges(hasChanges)
  }
  const path = store.currentFilePath
  if (path) {
    const prevStatus = store.fileStatusMap[path] || 'clean'
    let nextStatus = prevStatus
    if (!hasChanges) {
      nextStatus = (!store.isGitWorkspace || prevStatus === 'unstaged_modified')
        ? 'clean'
        : (prevStatus === 'staged_modified' ? 'staged' : prevStatus)
    } else {
      nextStatus = !store.isGitWorkspace
        ? 'unstaged_modified'
        : (prevStatus === 'staged' || prevStatus === 'staged_modified' ? 'staged_modified' : 'unstaged_modified')
    }
    if (nextStatus !== prevStatus) {
      store.setFileStatusMap({ ...store.fileStatusMap, [path]: nextStatus })
    }
  }
}

export const ChangeHighlightExtension = Extension.create({
  name: 'changeHighlight',

  addProseMirrorPlugins() {
    const editor = this.editor

    return [
      new Plugin({
        key: changeHighlightPluginKey,
        state: {
          init(): ChangeHighlightPluginState {
            return {
              decorations: DecorationSet.empty,
              baseContent: null,
              showAdditions: true,
              showDeletions: true,
            }
          },
          apply: (tr, oldPluginState: ChangeHighlightPluginState, _oldState, newState): ChangeHighlightPluginState => {
            const editorState = useEditorStore.getState()
            const settings = useSettingsStore.getState().settings

            // When reviewing an AI-generated edit, suppress standard git/snapshot diff decorations
            // so the AI diff (contiguous deletion of old text + contiguous addition of new text) is displayed cleanly
            if (editorState.aiPendingEdit) {
              return {
                decorations: DecorationSet.empty,
                baseContent: null,
                showAdditions: false,
                showDeletions: false,
              }
            }

            const baseContent = editorState.diffBaseContent
            const showAdditions = (settings?.show_additions !== false) && editorState.documentShowAdditions
            const showDeletions = (settings?.show_deletions !== false) && editorState.documentShowDeletions

            const doc = newState.doc

            if (baseContent === null) {
              const hasText = doc.textContent.trim().length > 0
              queueMicrotask(() => syncDocumentDiffStatus(hasText))
              return {
                decorations: DecorationSet.empty,
                baseContent: null,
                showAdditions,
                showDeletions,
              }
            }

            // Fast path: if the document structure didn't change and diff options/base didn't change, map decorations directly
            if (
              !tr.docChanged &&
              baseContent === oldPluginState.baseContent &&
              showAdditions === oldPluginState.showAdditions &&
              showDeletions === oldPluginState.showDeletions
            ) {
              return {
                decorations: oldPluginState.decorations.map(tr.mapping, doc),
                baseContent,
                showAdditions,
                showDeletions,
              }
            }

            const currentBlocks = extractTextBlocks(doc)
            const baseBlocks = getBaseBlocks(editor, baseContent)

            // If base is empty and current is empty, no diff
            if (baseBlocks.length === 0 && currentBlocks.length === 0) {
              queueMicrotask(() => syncDocumentDiffStatus(false))
              return {
                decorations: DecorationSet.empty,
                baseContent,
                showAdditions,
                showDeletions,
              }
            }

            const blockOps = diffBlockSequences(baseBlocks, currentBlocks.map((b) => b.text))
            const hasChanges = blockOps.some((op) => op.tag !== 'equal')

            queueMicrotask(() => syncDocumentDiffStatus(hasChanges))

            if (!showAdditions && !showDeletions) {
              return {
                decorations: DecorationSet.empty,
                baseContent,
                showAdditions,
                showDeletions,
              }
            }

            const decorations: Decoration[] = []

            for (const op of blockOps) {
              if (op.tag === 'equal') {
                continue
              }

              if (op.tag === 'insert') {
                if (showAdditions) {
                  for (let j = op.j1; j < op.j2; j++) {
                    const block = currentBlocks[j]
                    if (block && block.text.length > 0) {
                      decorations.push(
                        Decoration.inline(block.pos + 1, block.pos + block.nodeSize - 1, {
                          class: 'diff-addition',
                        })
                      )
                    }
                  }
                }
                continue
              }

              if (op.tag === 'delete') {
                if (showDeletions) {
                  const targetPos = op.j1 < currentBlocks.length ? currentBlocks[op.j1].pos : doc.content.size
                  const deletedText = baseBlocks.slice(op.i1, op.i2).join('\n\n')
                  if (deletedText.length > 0) {
                    decorations.push(
                      Decoration.widget(targetPos, () => createDeletedBlock(deletedText), { side: -1 })
                    )
                  }
                }
                continue
              }

              if (op.tag === 'replace') {
                const baseCount = op.i2 - op.i1
                const currCount = op.j2 - op.j1
                const pairCount = Math.min(baseCount, currCount)

                // Diff paired blocks using word-level diffing with intra-word refinement
                for (let k = 0; k < pairCount; k++) {
                  const baseText = baseBlocks[op.i1 + k]
                  const currBlock = currentBlocks[op.j1 + k]
                  if (!currBlock) continue

                  const diffOps = diffTokens(baseText, currBlock.text)
                  for (const dop of diffOps) {
                    if (dop.type === 'insert' && showAdditions && dop.insLen > 0) {
                      const from = currBlock.pos + 1 + dop.charOffset
                      const to = from + dop.insLen
                      decorations.push(
                        Decoration.inline(from, to, {
                          class: 'diff-addition',
                        })
                      )
                    } else if (dop.type === 'delete' && showDeletions && dop.delText.length > 0) {
                      const pos = currBlock.pos + 1 + dop.charOffset
                      decorations.push(
                        Decoration.widget(pos, () => createDeletedSpan(dop.delText), { side: -1 })
                      )
                    }
                  }
                }

                // Handle any extra deleted base blocks
                if (baseCount > currCount && showDeletions) {
                  const extraDeletedText = baseBlocks.slice(op.i1 + pairCount, op.i2).join('\n\n')
                  if (extraDeletedText.length > 0) {
                    const targetPos = op.j2 < currentBlocks.length ? currentBlocks[op.j2].pos : doc.content.size
                    decorations.push(
                      Decoration.widget(targetPos, () => createDeletedBlock(extraDeletedText), { side: -1 })
                    )
                  }
                }

                // Handle any extra inserted current blocks
                if (currCount > baseCount && showAdditions) {
                  for (let j = op.j1 + pairCount; j < op.j2; j++) {
                    const block = currentBlocks[j]
                    if (block && block.text.length > 0) {
                      decorations.push(
                        Decoration.inline(block.pos + 1, block.pos + block.nodeSize - 1, {
                          class: 'diff-addition',
                        })
                      )
                    }
                  }
                }
              }
            }

            return {
              decorations: DecorationSet.create(doc, decorations),
              baseContent,
              showAdditions,
              showDeletions,
            }
          },
        },
        props: {
          decorations(state) {
            const pluginState = this.getState(state) as ChangeHighlightPluginState | undefined
            return pluginState ? pluginState.decorations : DecorationSet.empty
          },
        },
      }),
    ]
  },
})


