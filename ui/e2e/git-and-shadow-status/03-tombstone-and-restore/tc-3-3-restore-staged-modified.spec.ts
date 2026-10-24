import { test, expect, gotoApp, selectFileInSidebar, typeInEditor, saveActiveDocument, clickStageOrSnapshot, restoreActiveDocument, pace } from '../helpers'

test.describe('Group 3: Tombstone & Restore - TC-3.3 Restore Staged and Modified Changes', () => {
  test('restoring staged changes reverts to committed baseline and clears dirty flags', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // Select general.md in styles/
    await selectFileInSidebar(page, 'general.md')

    // Modify and stage/snapshot
    await typeInEditor(page, '\n\n/* Staged Revert Test Entry */')
    await saveActiveDocument(page)
    await clickStageOrSnapshot(page)

    // Add another edit
    await typeInEditor(page, '\n/* Working diff */')
    await saveActiveDocument(page)
    await pace(page, 500)

    // Click restore and confirm
    await restoreActiveDocument(page, 'committed')
    await pace(page, 500)

    // Verify row is clean
    const row = page.locator('.group').filter({ hasText: 'general.md' }).first()
    await expect(row.locator('span:text-is("S")')).toHaveCount(0)
    await expect(row.locator('span:text-is("M")')).toHaveCount(0)
  })
})
