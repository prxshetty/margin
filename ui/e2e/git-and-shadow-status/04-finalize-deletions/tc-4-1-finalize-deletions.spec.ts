import { test, expect, gotoApp, pace } from '../helpers'

test.describe('Group 4: Finalize Deletions - TC-4.1 Finalize Deletions in Shadow Mode', () => {
  test('purges shadow snapshots of deleted files when in non-Git mode', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // Open Settings Modal
    const settingsBtn = page.locator('button[title*="Settings"]').first()
    await expect(settingsBtn).toBeVisible()
    await settingsBtn.click()
    await pace(page, 500)

    // Navigate to Workspaces tab in Settings Modal
    const workspacesTabBtn = page.getByRole('button', { name: /Workspaces/i }).first()
    if (await workspacesTabBtn.isVisible()) {
      await workspacesTabBtn.click()
      await pace(page, 500)
    }

    // Verify Finalize Deletions section is visible in non-Git shadow mode
    const finalizeSection = page.locator('h3:text-is("Finalize Deletions")')
    await expect(finalizeSection).toBeVisible({ timeout: 10000 })

    const finalizeBtn = page.getByRole('button', { name: /Finalize Deletions/i })
    // 1. In a clean workspace with no deleted files, the button must be disabled
    await expect(finalizeBtn).toBeDisabled()

    // Close Settings Modal
    const closeBtn = page.locator('button').filter({ hasText: /Close|×/i }).first()
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
    } else {
      await page.keyboard.press('Escape')
    }
    await pace(page, 500)

    // 2. Delete protagonist.md to create a shadow tombstone
    const targetRow = page.locator('.group').filter({ hasText: 'protagonist.md' }).first()
    await targetRow.hover()
    const trashBtn = targetRow.locator('button[title*="Delete"]').first()
    await trashBtn.click()
    await page.getByRole('button', { name: /Delete File/i }).click()
    await pace(page, 1000)

    // Verify D badge appears on tombstone
    await expect(targetRow.locator('span:text-is("D")')).toBeVisible()

    // 3. Re-open Settings Modal - button should now be enabled!
    await settingsBtn.click()
    await pace(page, 500)
    await expect(finalizeBtn).toBeEnabled()
    await finalizeBtn.click()
    await pace(page, 1500)

    // Verify status message appears
    const statusMsg = page.locator('div').filter({ hasText: /Finalized/i }).first()
    await expect(statusMsg).toBeVisible()

    // After finalizing, button becomes disabled again
    await expect(finalizeBtn).toBeDisabled()

    // Close Settings Modal and verify tombstone is permanently removed
    if (await closeBtn.isVisible()) {
      await closeBtn.click()
    } else {
      await page.keyboard.press('Escape')
    }
    await pace(page, 500)
    await expect(page.locator('.group').filter({ hasText: 'protagonist.md' })).toHaveCount(0)
  })
})
