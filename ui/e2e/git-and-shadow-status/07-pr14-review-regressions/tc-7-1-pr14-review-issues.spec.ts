import {
  test,
  expect,
  gotoApp,
  selectFileInSidebar,
  typeInEditor,
  saveActiveDocument,
  clickStageOrSnapshot,
  pace,
  safeRemoveDirSync,
} from '../helpers'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdirSync, writeFileSync, readFileSync } from 'fs'
import { execFileSync } from 'child_process'

const API_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:8000'

test.describe('Group 7: PR #14 Review Regressions', () => {
  test('Issue 1: rejects unknown restore mode ("commited" typo) and unenforced restore modes without wiping worktree/staged changes', async ({
    page,
    testWorkspace,
  }) => {
    await gotoApp(page)
    await pace(page, 800)

    await selectFileInSidebar(page, 'chapter-1.md')
    await typeInEditor(page, '\n\nStaged paragraph for Issue 1.')
    await saveActiveDocument(page)
    await clickStageOrSnapshot(page)

    await typeInEditor(page, '\nUnstaged working edit for Issue 1.')
    await saveActiveDocument(page)

    const ch1DiskPath = join(testWorkspace.path, 'chapters', 'chapter-1.md')
    const contentBefore = readFileSync(ch1DiskPath, 'utf-8')

    // Typo mode "commited" must return 400 and leave worktree + index untouched
    const badModeRes = await fetch(`${API_BASE}/api/workspace/restore-diff-base`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'chapters/chapter-1.md', mode: 'commited' }),
      signal: AbortSignal.timeout(10000),
    })
    expect(badModeRes.status).toBe(400)
    expect(readFileSync(ch1DiskPath, 'utf-8')).toBe(contentBefore)
  })

  test('Issue 4: renames a newly created untracked file in a Git workspace via sidebar UI without 400 error', async ({
    page,
  }) => {
    await gotoApp(page)
    await pace(page, 800)

    // 1. Create a new uncommitted (untracked) file chapters/notes.md via sidebar '+'
    const chaptersHeader = page.locator('.group').filter({ hasText: /^chapters\//i }).first()
    await chaptersHeader.hover()
    const addFileBtn = chaptersHeader.locator('button[title*="New file"]').first()
    await expect(addFileBtn).toBeVisible()
    await addFileBtn.click()

    const filenameInput = page.locator('input[placeholder*="chapter-2.md"]').first()
    await expect(filenameInput).toBeVisible()
    await filenameInput.fill('notes.md')
    await page.getByRole('button', { name: /create file/i }).click()
    await pace(page, 800)

    const notesRow = page.locator('.group').filter({ hasText: 'notes.md' }).first()
    await expect(notesRow).toBeVisible()

    // 2. Rename untracked chapters/notes.md -> ideas.md via RenameModal
    await notesRow.hover()
    const renameBtn = notesRow.locator('button[title*="Rename"]').first()
    await expect(renameBtn).toBeVisible()
    await renameBtn.click()

    const renameInput = page.locator('input[placeholder*="chapter-1.md"]').first()
    await expect(renameInput).toBeVisible()
    await renameInput.fill('ideas.md')

    const renameResponsePromise = page.waitForResponse(
      (res) => res.url().includes('/api/workspace/files/') && res.request().method() === 'PATCH',
      { timeout: 10000 }
    )
    const submitBtn = page.locator('button[type="submit"]').filter({ hasText: /Rename/i }).first()
    await submitBtn.click()

    const renameRes = await renameResponsePromise
    expect(renameRes.status()).toBe(200)

    await pace(page, 800)
    const ideasRow = page.locator('.group').filter({ hasText: 'ideas.md' }).first()
    await expect(ideasRow).toBeVisible()
  })

  test('Issue 5: .margin-shadow/ files in a Git workspace never leak into /api/workspace/status', async ({
    testWorkspace,
  }) => {
    const shadowDir = join(testWorkspace.path, '.margin-shadow', 'chapters')
    mkdirSync(shadowDir, { recursive: true })
    writeFileSync(join(shadowDir, 'chapter-1.md'), '# Shadow baseline\n', 'utf-8')

    const res = await fetch(`${API_BASE}/api/workspace/status`, {
      signal: AbortSignal.timeout(10000),
    })
    expect(res.ok).toBe(true)
    const data = await res.json()
    const leakedKeys = Object.keys(data.statuses || {}).filter((k) =>
      k.split('/').some((part) => part.startsWith('.'))
    )
    expect(leakedKeys).toEqual([])
  })

  test('Issue 6: restoring a renamed file via staged_and_unstage preserves manifest edits', async ({
    page,
    testWorkspace,
  }) => {
    await gotoApp(page)
    await pace(page, 800)

    // Add an unrelated working edit to chapters/CHAPTERS.md
    const manifestPath = join(testWorkspace.path, 'chapters', 'CHAPTERS.md')
    const origManifest = readFileSync(manifestPath, 'utf-8')
    writeFileSync(
      manifestPath,
      origManifest.trimEnd() + '\n| bonus-note.md | Author working note |\n',
      'utf-8'
    )

    // Rename chapter-1.md -> chapter-one.md via API/UI
    const targetRow = page.locator('.group').filter({ hasText: 'chapter-1.md' }).first()
    await targetRow.hover()
    await targetRow.locator('button[title*="Rename"]').first().click()
    const input = page.locator('input[placeholder*="chapter-1.md"]').first()
    await input.fill('chapter-one.md')
    await page.locator('button[type="submit"]').filter({ hasText: /Rename/i }).first().click()
    await pace(page, 1000)

    // Select chapter-one.md and restore using staged_and_unstage
    await selectFileInSidebar(page, 'chapter-one.md')
    const restoreBtn = page.locator('button[title*="Restore"]').first()
    await restoreBtn.click()
    await pace(page, 500)

    const modal = page.locator('div.fixed').filter({ hasText: /Restore chapter-one\.md\?/i })
    await expect(modal).toBeVisible()
    const stagedAndUnstageRadio = modal.locator('input[value="staged_and_unstage"]')
    await stagedAndUnstageRadio.click()
    await page.getByRole('button', { name: /Restore File/i }).first().click()
    await pace(page, 1000)

    const updatedManifest = readFileSync(manifestPath, 'utf-8')
    expect(updatedManifest).toContain('chapter-1.md')
    expect(updatedManifest).not.toContain('chapter-one.md')
    expect(updatedManifest).toContain('Author working note')
  })

  test('Issue 7: /api/workspace/git-init on an existing directory does not auto-commit .env or private files', async () => {
    const existingDir = join(
      tmpdir(),
      `margin_e2e_existing_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    )
    mkdirSync(join(existingDir, 'chapters'), { recursive: true })
    writeFileSync(join(existingDir, '.env'), 'SECRET_KEY=super-secret\n', 'utf-8')
    writeFileSync(join(existingDir, 'private-notes.txt'), 'Private outline\n', 'utf-8')
    writeFileSync(join(existingDir, 'chapters', 'chapter-1.md'), '# Chapter 1\n', 'utf-8')

    try {
      const res = await fetch(`${API_BASE}/api/workspace/git-init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: existingDir }),
        signal: AbortSignal.timeout(10000),
      })
      expect(res.ok).toBe(true)

      const lsFiles = execFileSync('git', ['ls-files'], {
        cwd: existingDir,
        encoding: 'utf-8',
        timeout: 10000,
      })
        .trim()
        .split(/\r?\n/)
        .filter(Boolean)

      expect(lsFiles).not.toContain('.env')
      expect(lsFiles).not.toContain('private-notes.txt')
    } finally {
      safeRemoveDirSync(existingDir)
    }
  })
})
