import { test, expect, gotoApp, selectFileInSidebar, typeInEditor, clickStageOrSnapshot, restoreActiveDocument, pace } from '../helpers'

test.describe('Group 1: File Status Engine - TC-1.1 Git / Shadow Status Lifecycle', () => {
  test('transitions through Clean -> Modified -> Staged/Snapshotted -> Working Diff -> Restored (Clean)', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // 1. Select chapter-1.md
    await selectFileInSidebar(page, 'chapter-1.md')

    // 2. Add edits in editor (enables Stage button)
    await typeInEditor(page, '\n\n[TC-1.1 E2E Test Entry]')
    await pace(page, 500)

    // 3. Click Stage or Snapshot button in bottom toolbar
    await clickStageOrSnapshot(page)

    // 4. Verify staged / clean baseline is acknowledged
    const stagedOrClean = page.locator('.group').filter({ hasText: 'chapter-1.md' }).first()
    await expect(stagedOrClean).toBeVisible()

    // 5. Add working edits on top of staged/snapshot baseline
    await typeInEditor(page, '\n[Second Working Edit]')
    await pace(page, 500)

    // 6. Click Restore and confirm revert to baseline
    await restoreActiveDocument(page, 'committed')

    // 7. Verify all dirty badges on chapter-1.md are cleared back to clean
    const fileRow = page.locator('.group').filter({ hasText: 'chapter-1.md' }).first()
    await expect(fileRow.locator('span:text-is("S")')).toHaveCount(0)
    await expect(fileRow.locator('span:text-is("M")')).toHaveCount(0)
  })
})
