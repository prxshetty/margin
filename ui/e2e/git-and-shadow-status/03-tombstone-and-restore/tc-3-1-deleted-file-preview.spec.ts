import { test, expect, gotoApp, restoreActiveDocument, pace } from '../helpers'

test.describe('Group 3: Tombstone & Restore - TC-3.1 Read-Only Deleted File Preview', () => {
  test('displays warning banner and read-only mode for deleted file tombstones', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // Delete protagonist.md
    const targetRow = page.locator('.group').filter({ hasText: 'protagonist.md' }).first()
    await targetRow.hover()
    const trashBtn = targetRow.locator('button[title*="Delete"]').first()
    await trashBtn.click()
    await page.getByRole('button', { name: /Delete File/i }).click()
    await pace(page, 1000)

    // Click the tombstone file row
    await targetRow.click()
    await pace(page, 500)

    // Verify red warning banner appears above editor
    const banner = page.locator('div').filter({ hasText: /This file was deleted/i }).first()
    await expect(banner).toBeVisible()

    // Verify Stage/Snapshot button is disabled
    const stageBtn = page.locator('button[title*="Cannot stage"], button[title*="Cannot snapshot"]').first()
    await expect(stageBtn).toBeDisabled()

    // Verify Restore button is enabled
    const restoreBtn = page.locator('button[title*="Restore deleted file"]').first()
    await expect(restoreBtn).toBeEnabled()

    // Cleanup: Restore file
    await restoreActiveDocument(page)
  })
})
