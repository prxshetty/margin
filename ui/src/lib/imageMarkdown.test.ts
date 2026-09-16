import { describe, expect, it } from 'vitest'
import { parseImageMarkdown, serializeImageMarkdown, splitAltDims } from './imageMarkdown'

describe('parseImageMarkdown', () => {
  it('parses plain images (existing behavior)', () => {
    expect(parseImageMarkdown('![A cat](assets/cat.png "A cute cat")')).toEqual({
      alt: 'A cat', src: 'assets/cat.png', title: 'A cute cat',
      width: null, height: null, align: null,
    })
    expect(parseImageMarkdown('![cover](assets/cover.png)')).toEqual({
      alt: 'cover', src: 'assets/cover.png', title: null,
      width: null, height: null, align: null,
    })
  })

  it('parses width-only, WxH, and height-only dimensions', () => {
    expect(parseImageMarkdown('![a|800](s.png)')).toMatchObject({ alt: 'a', width: 800, height: null })
    expect(parseImageMarkdown('![map|800x600](assets/map.png "cap")')).toMatchObject({
      alt: 'map', src: 'assets/map.png', title: 'cap', width: 800, height: 600,
    })
    expect(parseImageMarkdown('![a|x600](s.png)')).toMatchObject({ alt: 'a', width: null, height: 600 })
  })

  it('leaves non-dimension pipes as literal alt text', () => {
    expect(parseImageMarkdown('![a|b](s.png)')).toMatchObject({ alt: 'a|b', width: null, height: null })
    expect(parseImageMarkdown('![a|](s.png)')).toMatchObject({ alt: 'a|', width: null, height: null })
    expect(parseImageMarkdown('![a|b|800](s.png)')).toMatchObject({ alt: 'a|b', width: 800, height: null })
  })

  it('rejects zero and negative dimensions, falling back to a plain image', () => {
    expect(parseImageMarkdown('![a|0](s.png)')).toMatchObject({ alt: 'a', width: null, height: null })
    expect(parseImageMarkdown('![a|0x600](s.png)')).toMatchObject({ alt: 'a', width: null, height: null })
    expect(parseImageMarkdown('![a|-5](s.png)')).toMatchObject({ alt: 'a|-5', width: null, height: null })
  })

  it('parses the alignment suffix', () => {
    expect(parseImageMarkdown('![a](s.png){align=right}')).toMatchObject({ align: 'right' })
    expect(parseImageMarkdown('![a|400](s.png "t"){align=center}')).toMatchObject({
      width: 400, title: 't', align: 'center',
    })
  })

  it('returns null for malformed syntax', () => {
    expect(parseImageMarkdown('not markdown')).toBeNull()
    expect(parseImageMarkdown('')).toBeNull()
    expect(parseImageMarkdown('![a](s.png){align=diagonal}')).toBeNull()
    expect(parseImageMarkdown('![a](s.png) trailing')).toBeNull()
  })
})

describe('serializeImageMarkdown', () => {
  it('serializes plain images unchanged', () => {
    expect(serializeImageMarkdown('A cat', 'assets/cat.png', 'A cute cat'))
      .toBe('![A cat](assets/cat.png "A cute cat")')
    expect(serializeImageMarkdown('cover', 'assets/cover.png', null)).toBe('![cover](assets/cover.png)')
  })

  it('serializes dimensions and alignment', () => {
    expect(serializeImageMarkdown('m', 'a.png', 'c', 800, 600))
      .toBe('![m|800x600](a.png "c")')
    expect(serializeImageMarkdown('a', 's.png', null, 800, null)).toBe('![a|800](s.png)')
    expect(serializeImageMarkdown('a', 's.png', null, null, 600)).toBe('![a|x600](s.png)')
    expect(serializeImageMarkdown('a', 's.png', null, null, null, 'right'))
      .toBe('![a](s.png){align=right}')
    expect(serializeImageMarkdown('a', 's.png', 't', 400, null, 'left'))
      .toBe('![a|400](s.png "t"){align=left}')
  })

  it('round-trips parse → serialize → parse', () => {
    const cases: string[] = [
      '![plain](s.png "t")',
      '![m|800x600](a.png "c")',
      '![a|800](s.png)',
      '![a|x600](s.png)',
      '![x|y](s.png)',
      '![a](s.png){align=right}',
      '![a|400](s.png "t"){align=center}',
    ]
    for (const md of cases) {
      const p = parseImageMarkdown(md)
      expect(p).not.toBeNull()
      if (!p) continue
      expect(serializeImageMarkdown(p.alt, p.src, p.title, p.width, p.height, p.align)).toBe(md)
    }
  })
})

describe('splitAltDims', () => {
  it('splits the DOM alt suffix used by the node parser', () => {
    expect(splitAltDims('map|800x600')).toEqual({ alt: 'map', width: 800, height: 600 })
    expect(splitAltDims('just alt')).toEqual({ alt: 'just alt', width: null, height: null })
    expect(splitAltDims('a|0')).toEqual({ alt: 'a', width: null, height: null })
  })
})
