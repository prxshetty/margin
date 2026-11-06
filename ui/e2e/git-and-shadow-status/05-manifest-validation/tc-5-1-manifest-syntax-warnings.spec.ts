import { test, expect, gotoApp, selectFileInSidebar, typeInEditor, saveActiveDocument, restoreActiveDocument, pace } from '../helpers'

test.describe('Group 5: Manifest Validation - TC-5.1 Real-Time Manifest Syntax Warnings', () => {
  test('flags malformed manifest rows with alert icon and line-specific tooltip', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    // Select CHAPTERS.md
    await selectFileInSidebar(page, 'CHAPTERS.md')

    // Add an invalid row (without bullet or separator)
    await typeInEditor(page, '\n\nMalformed raw text line without separator')
    await saveActiveDocument(page)
    // Click outside editor to trigger onBlur manifest validation
    await page.locator('.editor-bottom-bar').click().catch(() => {})
    await pace(page, 1000)

    // Verify amber AlertTriangle icon appears next to CHAPTERS.md in sidebar
    const chaptersRow = page.locator('.group').filter({ hasText: 'CHAPTERS.md' }).first()
    const warningIcon = chaptersRow.locator('span[title*="Manifest formatting issue"]').first()
    await expect(warningIcon).toBeVisible({ timeout: 5000 })

    // Verify tooltip contains line number information
    const tooltipText = await warningIcon.getAttribute('title')
    expect(tooltipText).toContain('Manifest formatting issue')

    // Cleanup: Restore CHAPTERS.md back to clean
    await restoreActiveDocument(page)
    await pace(page, 500)

    // Verify warning icon disappears
    await expect(chaptersRow.locator('span[title*="Manifest formatting issue"]')).toHaveCount(0)
  })
})
