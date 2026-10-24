import {
  test,
  expect,
  gotoApp,
  setEditorContent,
  clearEditor,
  saveActiveDocument,
  clickStageOrSnapshot,
  pace,
} from '../helpers'

test.describe('Group 2: File Operations - TC-2.4 New File Stage/Snapshot and Restore Lifecycle', () => {
  test('Git workspace: new file stage and restore button lifecycle', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    const uniqueId = Date.now().toString().slice(-4)
    const newFileName = `new-git-file-${uniqueId}.md`

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

    // Verify file is opened and bottom toolbar is present
    await expect(page.locator('.editor-bottom-bar')).toBeVisible({ timeout: 10000 })
    const stageBtn = page.locator('.editor-bottom-bar button').first()
    const restoreBtn = page.locator('button[title*="Restore" i]').first()

    // Step 1: Both Stage and Restore should be disabled for a new empty file
    await expect(stageBtn).toBeDisabled()
    await expect(restoreBtn).toBeDisabled()

    // Step 2: Stage should become enabled when content is added; Restore remains disabled
    await setEditorContent(page, 'Initial content added to newly created file.')
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(stageBtn).toBeEnabled()
    await expect(restoreBtn).toBeDisabled()

    // Step 3: Stage should disable when that content is removed; Restore remains disabled
    await clearEditor(page)
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(stageBtn).toBeDisabled()
    await expect(restoreBtn).toBeDisabled()

    // Step 4: Re-add content and stage the file
    const stagedBaselineText = 'Committed baseline content for this file.'
    await setEditorContent(page, stagedBaselineText)
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(stageBtn).toBeEnabled()
    await expect(restoreBtn).toBeDisabled()

    await clickStageOrSnapshot(page)
    await pace(page, 500)

    // After staging, with no working diffs from the staged version, both buttons are disabled
    await expect(stageBtn).toBeDisabled()
    await expect(restoreBtn).toBeDisabled()

    // Step 5: Add additional content on top of staged version -> both Stage and Restore become enabled
    await setEditorContent(page, `${stagedBaselineText}\nAdditional text appended.`)
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(stageBtn).toBeEnabled()
    await expect(restoreBtn).toBeEnabled()

    // Step 6: Delete the additional content so it matches staged version again -> both Stage and Restore disable
    await setEditorContent(page, stagedBaselineText)
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(stageBtn).toBeDisabled()
    await expect(restoreBtn).toBeDisabled()
  })

  test('Shadow non-git workspace: new file snapshot and restore button lifecycle', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    const uniqueId = Date.now().toString().slice(-4)
    const newFileName = `new-shadow-file-${uniqueId}.md`

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

    // Verify file is opened and bottom toolbar is present
    await expect(page.locator('.editor-bottom-bar')).toBeVisible({ timeout: 10000 })
    const snapshotBtn = page.locator('.editor-bottom-bar button').first()
    const restoreBtn = page.locator('button[title*="Restore" i]').first()

    // Step 1: Both Snapshot and Restore should be disabled for a new empty file
    await expect(snapshotBtn).toBeDisabled()
    await expect(restoreBtn).toBeDisabled()

    // Step 2: Snapshot should become enabled when content is added; Restore remains disabled
    await setEditorContent(page, 'Initial content in non-git shadow file.')
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(snapshotBtn).toBeEnabled()
    await expect(restoreBtn).toBeDisabled()

    // Step 3: Snapshot should disable when that content is removed; Restore remains disabled
    await clearEditor(page)
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(snapshotBtn).toBeDisabled()
    await expect(restoreBtn).toBeDisabled()

    // Step 4: Re-add content and snapshot the file baseline
    const snapshotBaselineText = 'Permanent shadow baseline content.'
    await setEditorContent(page, snapshotBaselineText)
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(snapshotBtn).toBeEnabled()
    await expect(restoreBtn).toBeDisabled()

    await clickStageOrSnapshot(page)
    await pace(page, 500)

    // After snapshot creation, with no working diffs from the baseline, both buttons are disabled
    await expect(snapshotBtn).toBeDisabled()
    await expect(restoreBtn).toBeDisabled()

    // Step 5: Add additional content on top of snapshot baseline -> both Snapshot and Restore become enabled
    await setEditorContent(page, `${snapshotBaselineText}\nSecond line added for shadow diff.`)
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(snapshotBtn).toBeEnabled()
    await expect(restoreBtn).toBeEnabled()

    // Step 6: Delete the additional content so it matches snapshot baseline -> both Snapshot and Restore disable
    await setEditorContent(page, snapshotBaselineText)
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(snapshotBtn).toBeDisabled()
    await expect(restoreBtn).toBeDisabled()
  })
})
