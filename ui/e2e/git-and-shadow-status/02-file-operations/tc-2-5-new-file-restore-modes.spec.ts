import {
  test,
  expect,
  gotoApp,
  setEditorContent,
  saveActiveDocument,
  clickStageOrSnapshot,
  pace,
} from '../helpers'

test.describe('Group 2: File Operations - TC-2.5 New File Restore Modes', () => {
  test('verifies restore defaults to worktree_only for staged and modified new file and handles restore modes', async ({
    page,
  }) => {
    test.setTimeout(60000)
    await gotoApp(page)
    await pace(page, 1000)

    const uniqueId = Date.now().toString().slice(-4)
    const newFileName = `new-restore-test-${uniqueId}.md`

    // 1. Create a new file in chapters/
    const chaptersHeader = page.locator('.group').filter({ hasText: 'chapters/' }).first()
    await expect(chaptersHeader).toBeVisible({ timeout: 10000 })
    await chaptersHeader.hover()
    const addFileBtn = chaptersHeader.locator('button[title*="New file"]').first()
    await expect(addFileBtn).toBeVisible({ timeout: 5000 })
    await addFileBtn.click()

    const filenameInput = page.locator('input[placeholder*="chapter-2.md"]').first()
    await expect(filenameInput).toBeVisible({ timeout: 5000 })
    await filenameInput.fill(newFileName)
    await page.getByRole('button', { name: /create file/i }).click()
    await pace(page, 1000)

    const fileRow = page.locator('.group').filter({ hasText: newFileName }).first()
    await expect(fileRow).toBeVisible({ timeout: 10000 })

    // 2. Add content and stage
    const stagedText = 'Initial staged text for new file.'
    await setEditorContent(page, stagedText)
    await saveActiveDocument(page)
    await clickStageOrSnapshot(page)
    await pace(page, 500)

    // Verify row has S badge
    await expect(fileRow.locator('span[title="Staged changes"]')).toBeVisible()

    // 3. Add modifications on top of staged version WITHOUT saving to disk first
    const modifiedText = `${stagedText}\nWorking copy edit without save.`
    await setEditorContent(page, modifiedText)
    await pace(page, 200)

    // 4. Click restore immediately
    const restoreBtn = page.locator('.editor-bottom-bar').getByRole('button', { name: /Restore/i })
    await expect(restoreBtn).toBeEnabled()
    await restoreBtn.click()
    await pace(page, 500)

    const modal = page.locator('div.fixed').filter({ hasText: `Restore ${newFileName}?` })
    await expect(modal).toBeVisible()

    const worktreeOnlyRadio = modal.locator('input[value="worktree_only"]')
    const stagedAndUnstageRadio = modal.locator('input[value="staged_and_unstage"]')
    const committedRadio = modal.locator('input[value="committed"]')

    // Verify topmost least destructive option (worktree_only) is checked by default
    await expect(worktreeOnlyRadio).toBeEnabled()
    await expect(worktreeOnlyRadio).toBeChecked()

    // Verify staged_and_unstage is enabled and unchecked
    await expect(stagedAndUnstageRadio).toBeEnabled()
    await expect(stagedAndUnstageRadio).not.toBeChecked()

    // Verify committed is disabled because there is no committed baseline in HEAD
    await expect(committedRadio).toBeDisabled()
    await expect(modal).toContainText('No committed version in repository')

    // Verify dynamic description for worktree_only
    await expect(modal).toContainText('discard uncommitted modifications in your working copy and restore the file to the staged version')
    await expect(modal).toContainText('Staged changes will remain staged in Git.')

    // 5. Confirm Option 1: worktree_only restore
    const confirmBtn = page.getByRole('button', { name: /Restore File|Confirm Restore/i }).first()
    await confirmBtn.click()
    await pace(page, 1000)

    // Content in editor is restored to staged version
    await expect(page.locator('.ProseMirror')).toContainText(stagedText)
    await expect(page.locator('.ProseMirror')).not.toContainText('Working copy edit without save')

    // File remains staged (S badge is still visible)
    await expect(fileRow.locator('span[title="Staged changes"]')).toBeVisible()

    // Both Stage and Restore buttons become disabled
    const stageBtn = page.locator('.editor-bottom-bar button').first()
    await expect(stageBtn).toBeDisabled()
    await expect(restoreBtn).toBeDisabled()

    // 6. Test Option 2: staged_and_unstage
    // Modify the staged file again and save with Ctrl+S
    await setEditorContent(page, `${stagedText}\nSecond edit to test unstage mode.`)
    await saveActiveDocument(page)
    await pace(page, 500)

    await expect(restoreBtn).toBeEnabled()
    await restoreBtn.click()
    await pace(page, 500)

    await expect(modal).toBeVisible()

    // Even with saved working changes, worktree_only must still be the default checked option
    await expect(worktreeOnlyRadio).toBeEnabled()
    await expect(worktreeOnlyRadio).toBeChecked()
    await expect(stagedAndUnstageRadio).toBeEnabled()

    // Click Option 2: staged_and_unstage
    await stagedAndUnstageRadio.click()
    await expect(stagedAndUnstageRadio).toBeChecked()
    await expect(modal).toContainText('restore the content of the staged version to the working tree and unstage it')

    // Confirm staged_and_unstage
    await confirmBtn.click()
    await pace(page, 1500)

    // File is unstaged: S badge is gone!
    await expect(fileRow.locator('span[title="Staged changes"]')).toHaveCount(0)
    await expect(fileRow.locator('span[title="Staged and unstaged changes"]')).toHaveCount(0)

    // Editor still contains the restored content
    await expect(page.locator('.ProseMirror')).toContainText(stagedText)
  })
})
