import assert from 'node:assert/strict'
import test from 'node:test'
import {
  diffBlockSequences,
  computeBlockSimilarity,
  diffTokens,
  canonicalizeText,
  isBlockEqual,
} from '../ChangeHighlightExtension.ts'

test('canonicalizeText & isBlockEqual normalize smart quotes, apostrophes, dashes, and whitespace', () => {
  const p1 = 'Elara snarls at Kaelen, ice in her gaze. "You think you know everything," she hisses. "Prove it — what makes your doodles so much better?" He scoffs, a faint grin tugging at his lips. "Yeah, right? I’ve seen those stuffy galleries full of pretenders too." She snaps back, barely holding in her seething rage.'
  const p2 = 'Elara snarls at Kaelen, ice in her gaze. "You think you know everything," she hisses. "Prove it—what makes your doodles so much better?" He scoffs, a faint grin tugging at his lips. "Yeah, right? I\'ve seen those stuffy galleries full of pretenders too." She snaps back, barely holding in her seething rage.'

  assert.equal(canonicalizeText(p1), canonicalizeText(p2))
  assert.equal(isBlockEqual(p1, p2), true)
  assert.equal(computeBlockSimilarity(p1, p2), 1.0)
})

test('diffBlockSequences treats paragraphs differing only by smart quotes or dash spacing as equal', () => {
  const base = [
    'Elara snarls at Kaelen, ice in her gaze. "You think you know everything," she hisses. "Prove it — what makes your doodles so much better?" He scoffs, a faint grin tugging at his lips. "Yeah, right? I’ve seen those stuffy galleries full of pretenders too." She snaps back, barely holding in her seething rage.',
    'During the fight, Kaelen notices an older hidden painting turned against the wall — raw, strange, emotionally honest, completely unlike her polished gallery work. He realizes she’s been hiding her best work because it scares her.',
    'After he leaves the room for air, Elara quietly studies the hidden painting alone.',
  ]
  const current = [
    'Elara snarls at Kaelen, ice in her gaze. "You think you know everything," she hisses. "Prove it—what makes your doodles so much better?" He scoffs, a faint grin tugging at his lips. "Yeah, right? I\'ve seen those stuffy galleries full of pretenders too." She snaps back, barely holding in her seething rage.',
    'During the fight, Kaelen notices an older hidden painting turned against the wall — raw, strange, emotionally honest, completely unlike her polished gallery work. He realizes she\'s been hiding her best work because it scares her.',
    'After he leaves the room for air, Elara quietly studies the hidden painting alone.',
  ]

  const ops = diffBlockSequences(base, current)
  assert.deepEqual(ops, [
    { tag: 'equal', i1: 0, i2: 3, j1: 0, j2: 3 },
  ])
})

test('computeBlockSimilarity matches identical blocks with score 1.0', () => {
  const p1 = 'The quick brown fox jumps over the lazy dog.'
  assert.equal(computeBlockSimilarity(p1, p1), 1.0)
})

test('computeBlockSimilarity matches normalized whitespace blocks', () => {
  const p1 = 'The quick  brown fox jumps   over the lazy dog.'
  const p2 = 'The quick brown fox jumps over the lazy dog.'
  assert.ok(computeBlockSimilarity(p1, p2) >= 0.98)
})

test('computeBlockSimilarity detects modified paragraphs with high similarity', () => {
  const p1 = 'The quick brown fox jumps over the lazy dog.'
  const p2 = 'The quick brown fox leaps over the sleepy dog.'
  const sim = computeBlockSimilarity(p1, p2)
  assert.ok(sim >= 0.6, `Expected sim >= 0.6, got ${sim}`)
})

test('computeBlockSimilarity detects unrelated paragraphs with low similarity', () => {
  const p1 = 'The quick brown fox jumps over the lazy dog.'
  const p2 = 'Astronomers discover new exoplanet with habitable atmosphere.'
  const sim = computeBlockSimilarity(p1, p2)
  assert.ok(sim < 0.2, `Expected sim < 0.2, got ${sim}`)
})

test('diffBlockSequences: detects single paragraph insertion between existing paragraphs', () => {
  const base = [
    'Paragraph 1: Introduction to the story.',
    'Paragraph 2: The detective investigates the crime scene in detail.',
  ]
  const current = [
    'Paragraph 1: Introduction to the story.',
    'New inserted paragraph explaining the background lore.',
    'Paragraph 2: The detective investigates the crime scene in detail.',
  ]

  const ops = diffBlockSequences(base, current)
  assert.deepEqual(ops, [
    { tag: 'equal', i1: 0, i2: 1, j1: 0, j2: 1 },
    { tag: 'insert', i1: 1, i2: 1, j1: 1, j2: 2 },
    { tag: 'equal', i1: 1, i2: 2, j1: 2, j2: 3 },
  ])
})

test('diffBlockSequences: detects multi-paragraph insertion between existing paragraphs', () => {
  const base = [
    'Paragraph 1: Introduction to the story.',
    'Paragraph 2: The detective investigates the crime scene in detail.',
  ]
  const current = [
    'Paragraph 1: Introduction to the story.',
    'New inserted paragraph 1.',
    'New inserted paragraph 2.',
    'New inserted paragraph 3.',
    'Paragraph 2: The detective investigates the crime scene in detail.',
  ]

  const ops = diffBlockSequences(base, current)
  assert.deepEqual(ops, [
    { tag: 'equal', i1: 0, i2: 1, j1: 0, j2: 1 },
    { tag: 'insert', i1: 1, i2: 1, j1: 1, j2: 4 },
    { tag: 'equal', i1: 1, i2: 2, j1: 4, j2: 5 },
  ])
})

test('diffBlockSequences: detects insertion followed by an edited paragraph without misaligning', () => {
  const base = [
    'Paragraph 1: Introduction to the story.',
    'Paragraph 2: The detective investigates the crime scene in detail.',
  ]
  const current = [
    'Paragraph 1: Introduction to the story.',
    'New inserted paragraph with random words like detective and scene.',
    'Paragraph 2: The detective carefully investigates the dark crime scene in detail.',
  ]

  const ops = diffBlockSequences(base, current)
  assert.deepEqual(ops, [
    { tag: 'equal', i1: 0, i2: 1, j1: 0, j2: 1 },
    { tag: 'insert', i1: 1, i2: 1, j1: 1, j2: 2 },
    { tag: 'replace', i1: 1, i2: 2, j1: 2, j2: 3 },
  ])
})

test('diffBlockSequences: detects insertions at the beginning of the document', () => {
  const base = [
    'Paragraph 1: Existing start.',
    'Paragraph 2: Existing end.',
  ]
  const current = [
    'New Prologue Paragraph A.',
    'New Prologue Paragraph B.',
    'Paragraph 1: Existing start.',
    'Paragraph 2: Existing end.',
  ]

  const ops = diffBlockSequences(base, current)
  assert.deepEqual(ops, [
    { tag: 'insert', i1: 0, i2: 0, j1: 0, j2: 2 },
    { tag: 'equal', i1: 0, i2: 2, j1: 2, j2: 4 },
  ])
})

test('diffBlockSequences: detects insertions at the end of the document', () => {
  const base = [
    'Paragraph 1: Existing start.',
    'Paragraph 2: Existing end.',
  ]
  const current = [
    'Paragraph 1: Existing start.',
    'Paragraph 2: Existing end.',
    'New Epilogue Paragraph A.',
    'New Epilogue Paragraph B.',
  ]

  const ops = diffBlockSequences(base, current)
  assert.deepEqual(ops, [
    { tag: 'equal', i1: 0, i2: 2, j1: 0, j2: 2 },
    { tag: 'insert', i1: 2, i2: 2, j1: 2, j2: 4 },
  ])
})

test('diffBlockSequences: detects deleted paragraphs', () => {
  const base = [
    'Paragraph 1: Start.',
    'Paragraph 2: Deleted paragraph 1.',
    'Paragraph 3: Deleted paragraph 2.',
    'Paragraph 4: End.',
  ]
  const current = [
    'Paragraph 1: Start.',
    'Paragraph 4: End.',
  ]

  const ops = diffBlockSequences(base, current)
  assert.deepEqual(ops, [
    { tag: 'equal', i1: 0, i2: 1, j1: 0, j2: 1 },
    { tag: 'delete', i1: 1, i2: 3, j1: 1, j2: 1 },
    { tag: 'equal', i1: 3, i2: 4, j1: 1, j2: 2 },
  ])
})

test('diffTokens: correctly computes word-level additions and deletions', () => {
  const base = 'The brown fox jumps.'
  const curr = 'The quick brown fox jumps high.'
  const diffOps = diffTokens(base, curr)

  const inserted = diffOps.filter(op => op.type === 'insert').map(op => op.insText)
  const deleted = diffOps.filter(op => op.type === 'delete').map(op => op.delText)

  assert.ok(inserted.some(s => s.includes('quick')))
  assert.ok(inserted.some(s => s.includes('high')))
  assert.equal(deleted.length, 0)
})

test('diffTokens: does not interweave deletion and addition on completely different phrase replacement', () => {
  const base = 'electrically different'
  const curr = 'acrid with turpentine and possibility'
  const diffOps = diffTokens(base, curr)

  const deleteOps = diffOps.filter(op => op.type === 'delete')
  const insertOps = diffOps.filter(op => op.type === 'insert')

  assert.equal(deleteOps.length, 1, 'Should have exactly 1 deletion block')
  assert.equal(insertOps.length, 1, 'Should have exactly 1 addition block')
  assert.equal(deleteOps[0].delText, 'electrically different')
  assert.equal(insertOps[0].insText, 'acrid with turpentine and possibility')
})

test('diffBlockSequences: handles complex mix of insertions, edits, and deletions', () => {
  const base = [
    'Header block',
    'Paragraph A: To be deleted.',
    'Paragraph B: Original text about astronomy and stars.',
    'Paragraph C: Untouched conclusion.',
  ]
  const current = [
    'Header block',
    'Inserted Paragraph 1: New background lore.',
    'Inserted Paragraph 2: More lore.',
    'Paragraph B: Original text about astronomy and distant bright stars.',
    'Paragraph C: Untouched conclusion.',
    'Inserted Footer paragraph.',
  ]

  const ops = diffBlockSequences(base, current)
  assert.deepEqual(ops, [
    { tag: 'equal', i1: 0, i2: 1, j1: 0, j2: 1 },
    { tag: 'delete', i1: 1, i2: 2, j1: 1, j2: 1 },
    { tag: 'insert', i1: 2, i2: 2, j1: 1, j2: 3 },
    { tag: 'replace', i1: 2, i2: 3, j1: 3, j2: 4 },
    { tag: 'equal', i1: 3, i2: 4, j1: 4, j2: 5 },
    { tag: 'insert', i1: 4, i2: 4, j1: 5, j2: 6 },
  ])
})

test('diffBlockSequences: completely rewritten paragraph with low similarity is treated as delete + insert', () => {
  const base = [
    'Chapter 1: The Beginning.',
    'A long detailed description of cooking recipes and making homemade pasta from scratch.',
    'Chapter 2: The Next Day.',
  ]
  const current = [
    'Chapter 1: The Beginning.',
    'A theoretical explanation of quantum mechanical superposition and entanglement in physics.',
    'Chapter 2: The Next Day.',
  ]

  const ops = diffBlockSequences(base, current)
  assert.deepEqual(ops, [
    { tag: 'equal', i1: 0, i2: 1, j1: 0, j2: 1 },
    { tag: 'delete', i1: 1, i2: 2, j1: 1, j2: 1 },
    { tag: 'insert', i1: 2, i2: 2, j1: 1, j2: 2 },
    { tag: 'equal', i1: 2, i2: 3, j1: 2, j2: 3 },
  ])
})

test('diffBlockSequences: empty base or current documents handled gracefully', () => {
  assert.deepEqual(diffBlockSequences([], []), [])
  assert.deepEqual(diffBlockSequences([], ['P1', 'P2']), [
    { tag: 'insert', i1: 0, i2: 0, j1: 0, j2: 2 },
  ])
  assert.deepEqual(diffBlockSequences(['P1', 'P2'], []), [
    { tag: 'delete', i1: 0, i2: 2, j1: 0, j2: 0 },
  ])
})

