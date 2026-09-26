import { describe, expect, it } from 'vitest'
import { ITEMS } from './slashItems'

describe('slash menu image entries', () => {
  it('exposes Upload + Imagine', () => {
    const ids = ITEMS.map((i) => i.id)
    expect(ids).toContain('upload')
    expect(ids).toContain('generate')
    const gen = ITEMS.find((i) => i.id === 'generate')!
    expect(gen.label).toMatch(/Imagine/)
    expect(`${gen.label} ${gen.keywords}`.toLowerCase()).toContain('imagine')
  })
})
