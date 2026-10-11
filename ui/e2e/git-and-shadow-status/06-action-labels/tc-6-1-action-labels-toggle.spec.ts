import { test, expect, gotoApp, selectFileInSidebar, pace } from '../helpers'

test.describe('Group 6: Appearance Settings - TC-6.1 Action Labels Toggle', () => {
  test('toggles text labels on Stage/Snapshot and Restore toolbar buttons', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // Select chapter-1.md so bottom toolbar is visible
    await selectFileInSidebar(page, 'chapter-1.md')

    // Open Settings Modal -> Appearance
    const settingsBtn = page.locator('button[title*="Settings"]').first()
    await settingsBtn.click()
    await pace(page, 500)

    const appearanceTab = page.getByRole('button', { name: /Appearance/i })
    await appearanceTab.click()
    await pace(page, 500)

    // Find "Show text labels on file management buttons" checkbox
    const labelCheckbox = page.locator('input[type="checkbox"]').filter({ has: page.locator('..', { hasText: /Show text labels on file management buttons/i }) }).first()
    const isChecked = await labelCheckbox.isChecked()

    // Toggle checkbox to ON if it was OFF
    if (!isChecked) {
      await labelCheckbox.click()
      await pace(page, 300)
    }

    // Close Settings Modal
    await page.keyboard.press('Escape')
    await pace(page, 500)

    // Verify text labels are visible in toolbar buttons
    const toolbar = page.locator('.editor-bottom-bar').first()
    await expect(toolbar).toBeVisible()
    const stageOrSnapshotBtn = toolbar.locator('button').filter({ hasText: /Stage|Snapshot/i }).first()
    await expect(stageOrSnapshotBtn).toBeVisible()
    const restoreBtn = toolbar.locator('button').filter({ hasText: /Restore/i }).first()
    await expect(restoreBtn).toBeVisible()
  })
})
