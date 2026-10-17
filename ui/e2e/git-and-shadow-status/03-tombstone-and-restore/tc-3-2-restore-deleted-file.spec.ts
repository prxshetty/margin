import { test, expect, gotoApp, restoreActiveDocument, pace } from '../helpers'

test.describe('Group 3: Tombstone & Restore - TC-3.2 Restore Deleted File', () => {
  test('restoring a deleted file clears the warning banner and resets status to clean', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // Delete protagonist.md
    const targetRow = page.locator('.group').filter({ hasText: 'protagonist.md' }).first()
    await targetRow.hover()
    const trashBtn = targetRow.locator('button[title*="Delete"]').first()
    await trashBtn.click()
    await page.getByRole('button', { name: /Delete File/i }).click()
    await pace(page, 1000)

    // Select deleted tombstone
    await targetRow.click()
    await pace(page, 400)

    // Click Restore and confirm
    await restoreActiveDocument(page)
    await pace(page, 500)

    // Verify warning banner is gone
    const banner = page.locator('div').filter({ hasText: /This file was deleted/i })
    await expect(banner).toHaveCount(0)

    // Verify 'D' badge is removed from row
    const restoredRow = page.locator('.group').filter({ hasText: 'protagonist.md' }).first()
    await expect(restoredRow).toBeVisible()
    await expect(restoredRow.locator('span:text-is("D")')).toHaveCount(0)
  })
})
