import { describe, it, expect } from 'vitest'
import {
  isManifestPath,
  validateManifestText,
  formatManifestTooltip,
} from '../manifestValidator'

describe('manifestValidator', () => {
  describe('isManifestPath', () => {
    it('identifies valid manifest paths case-insensitively', () => {
      expect(isManifestPath('chapters/CHAPTERS.md')).toBe(true)
      expect(isManifestPath('characters/CHARACTERS.md')).toBe(true)
      expect(isManifestPath('styles/STYLES.md')).toBe(true)
      expect(isManifestPath('characters/characters.md')).toBe(true)
      expect(isManifestPath('custom_dir/CUSTOM_DIR.md')).toBe(true)
    })

    it('rejects non-manifest paths', () => {
      expect(isManifestPath('chapters/chapter-1.md')).toBe(false)
      expect(isManifestPath('characters/protagonist.md')).toBe(false)
      expect(isManifestPath('CHARACTERS.md')).toBe(false)
      expect(isManifestPath('nested/sub/FOLDER.md')).toBe(false)
      expect(isManifestPath('')).toBe(false)
    })
  })

  describe('validateManifestText', () => {
    it('considers empty or whitespace content valid', () => {
      expect(validateManifestText('').isValid).toBe(true)
      expect(validateManifestText('   \n\n\t').isValid).toBe(true)
    })

    it('validates compliant manifest lines with varied separators and bolding', () => {
      const content = [
        '- chapter-1.md — Opening scene',
        '- **chapter-2.md** – Market chase',
        '- chapter-3.md: Confrontation',
        '- style_general - General prose tone',
        '- elara_vance.md — Protagonist artist',
      ].join('\n')

      const res = validateManifestText(content)
      expect(res.isValid).toBe(true)
      expect(res.invalidLines).toEqual([])
      expect(res.totalCount).toBe(0)
      expect(res.hasMore).toBe(false)
    })

    it('flags non-compliant lines with 1-indexed line numbers', () => {
      const content = [
        '- chapter-1.md — Opening scene', // line 1 (valid)
        '# Chapter Manifest',             // line 2 (invalid header)
        '- chapter-2.md — Second scene',  // line 3 (valid)
        'Unstructured note paragraph',    // line 4 (invalid text)
        '- bad_bullet_no_separator',      // line 5 (invalid bullet)
        '',                               // line 6 (valid blank)
        '- chapter-3.md — Third scene',   // line 7 (valid)
      ].join('\n')

      const res = validateManifestText(content)
      expect(res.isValid).toBe(false)
      expect(res.invalidLines).toEqual([2, 4, 5])
      expect(res.totalCount).toBe(3)
      expect(res.hasMore).toBe(false)
    })

    it('caps reported invalid line numbers at maxReported', () => {
      const lines = Array.from({ length: 12 }, (_, i) => `Invalid line ${i + 1}`)
      const content = lines.join('\n')

      const res = validateManifestText(content, 5)
      expect(res.isValid).toBe(false)
      expect(res.invalidLines).toEqual([1, 2, 3, 4, 5])
      expect(res.totalCount).toBe(12)
      expect(res.hasMore).toBe(true)
    })
  })

  describe('formatManifestTooltip', () => {
    it('returns empty string for valid results', () => {
      expect(formatManifestTooltip({ isValid: true, invalidLines: [], totalCount: 0, hasMore: false })).toBe('')
    })

    it('formats single invalid line tooltip correctly', () => {
      const res = { isValid: false, invalidLines: [3], totalCount: 1, hasMore: false }
      expect(formatManifestTooltip(res)).toBe(
        "Manifest formatting issue on line 3 (expected '- filename.md — Description')"
      )
    })

    it('formats multiple invalid lines tooltip correctly', () => {
      const res = { isValid: false, invalidLines: [2, 4, 7], totalCount: 3, hasMore: false }
      expect(formatManifestTooltip(res)).toBe(
        "Manifest formatting issue on lines 2, 4, 7 (expected '- filename.md — Description')"
      )
    })

    it('formats capped tooltip with (+N more) correctly', () => {
      const res = { isValid: false, invalidLines: [1, 2, 3, 4, 5], totalCount: 15, hasMore: true }
      expect(formatManifestTooltip(res)).toBe(
        "Manifest formatting issue on lines 1, 2, 3, 4, 5 (+10 more) (expected '- filename.md — Description')"
      )
    })
  })
})
