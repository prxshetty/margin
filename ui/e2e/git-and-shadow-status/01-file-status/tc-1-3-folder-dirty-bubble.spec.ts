import { test, expect, gotoApp, restoreActiveDocument, pace } from '../helpers'

test.describe('Group 1: File Status Engine - TC-1.3 Folder Dirty Bubble Indicator', () => {
  test('displays amber bubble on collapsed folder when descendant has modified or renamed status', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // 1. Rename cinematic.md in styles/
    const targetRow = page.locator('.group').filter({ hasText: 'cinematic.md' }).first()
    await expect(targetRow).toBeVisible({ timeout: 5000 })
    await targetRow.hover()
    const renameBtn = targetRow.locator('button[title*="Rename"]').first()
    await renameBtn.click()

    const input = page.locator('input[placeholder*="chapter-1.md"]').first()
    await expect(input).toBeVisible()
    await input.fill('movie-style.md')
    const submitBtn = page.locator('button[type="submit"]').filter({ hasText: /Rename/i }).first()
    await submitBtn.click()
    await pace(page, 1500)

    // 2. Collapse styles/ folder
    const stylesHeader = page.locator('.group').filter({ hasText: /^styles\//i }).first()
    await stylesHeader.click()
    await pace(page, 800)

    // 3. Verify amber dirty bubble is visible on collapsed folder
    const dirtyBubble = stylesHeader.locator('span[title="Contains modified files"]')
    await expect(dirtyBubble).toBeVisible({ timeout: 5000 })

    // 4. Expand folder and restore renamed file back to original
    await stylesHeader.click()
    await pace(page, 400)
    const renamedRow = page.locator('.group').filter({ hasText: 'movie-style.md' }).first()
    await renamedRow.click()
    await restoreActiveDocument(page)
    await pace(page, 500)
  })
})
