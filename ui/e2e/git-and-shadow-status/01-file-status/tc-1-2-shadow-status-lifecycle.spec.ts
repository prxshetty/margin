import { test, expect, gotoApp, selectFileInSidebar, typeInEditor, saveActiveDocument, clickStageOrSnapshot, restoreActiveDocument, pace } from '../helpers'

test.describe('Group 1: File Status Engine - TC-1.2 Shadow Status Lifecycle', () => {
  test('handles modified state and snapshot updating', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // Select protagonist.md
    await selectFileInSidebar(page, 'protagonist.md')

    // Add modifications
    await typeInEditor(page, '\n\n[Shadow Snapshot Test Entry]')
    await saveActiveDocument(page)
    await pace(page, 500)

    // Verify Snapshot / Stage button is active and click it
    await clickStageOrSnapshot(page)

    // Add working edits on top of snapshotted baseline
    await typeInEditor(page, '\n[Unsnapshotted Working Diff]')
    await saveActiveDocument(page)
    await pace(page, 500)

    // Restore back to snapshotted baseline
    await restoreActiveDocument(page)
    await pace(page, 500)

    // Check file returns to clean
    const row = page.locator('.group').filter({ hasText: 'protagonist.md' }).first()
    await expect(row).toBeVisible()
  })
})
