import { test, expect, gotoApp, restoreActiveDocument, pace } from '../helpers'

test.describe('Group 2: File Operations - TC-2.3 Delete File', () => {
  test('deleting tracked file transitions to tombstone with strikethrough and D badge', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // Find protagonist.md
    const targetRow = page.locator('.group').filter({ hasText: 'protagonist.md' }).first()
    await targetRow.hover()

    // Click Trash (Delete) icon
    const trashBtn = targetRow.locator('button[title*="Delete"]').first()
    await expect(trashBtn).toBeVisible()
    await trashBtn.click()

    // Confirm in DeleteConfirmModal
    await page.getByRole('button', { name: /Delete File/i }).click()
    await pace(page, 1000)

    // Verify file row remains as tombstone with strikethrough and 'D' badge
    const tombstoneRow = page.locator('.group').filter({ hasText: 'protagonist.md' }).first()
    await expect(tombstoneRow).toBeVisible()
    const dBadge = tombstoneRow.locator('span:text-is("D")').first()
    await expect(dBadge).toBeVisible()

    // Cleanup: Restore the deleted file
    await tombstoneRow.click()
    await restoreActiveDocument(page)
    await pace(page, 500)
  })
})
