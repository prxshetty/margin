import { test, expect, gotoApp, restoreActiveDocument, pace } from '../helpers'

test.describe('Group 2: File Operations - TC-2.2 Rename File', () => {
  test('renames tracked file and updates parent manifest', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // Select protagonist.md
    const targetRow = page.locator('.group').filter({ hasText: 'protagonist.md' }).first()
    await targetRow.hover()

    // Click Pencil (Rename)
    const renameBtn = targetRow.locator('button[title*="Rename"]').first()
    await expect(renameBtn).toBeVisible()
    await renameBtn.click()

    // Fill in new name in RenameModal
    const input = page.locator('input[placeholder*="chapter-1.md"]').first()
    await expect(input).toBeVisible()
    await input.fill('lead-actor.md')

    // Submit rename
    const submitBtn = page.locator('button[type="submit"]').filter({ hasText: /Rename/i }).first()
    await submitBtn.click()
    await pace(page, 1500)

    // Verify renamed file appears with 'R' badge
    const renamedRow = page.locator('.group').filter({ hasText: 'lead-actor.md' }).first()
    await expect(renamedRow).toBeVisible()
    const rBadge = renamedRow.locator('span[title="Renamed in Git"]').first()
    await expect(rBadge).toBeVisible()

    // Cleanup: Restore renamed file back to original
    await renamedRow.click()
    await restoreActiveDocument(page)
    await pace(page, 500)
    await expect(page.locator('.group').filter({ hasText: 'protagonist.md' }).first()).toBeVisible()
  })
})
