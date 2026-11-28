import { test, expect, gotoApp, selectFileInSidebar, typeInEditor, pace } from '../helpers'
import { editorText } from './crossFileHelpers'

// Regression: renaming a file rewrites its folder manifest on disk, and the app
// reloaded that manifest into the editor even when it held unsaved edits.
// Unsaved edits only survive a blur when the save fails, so the test makes it fail.
test.describe('Group 8: Cross-file safety - TC-8.3 Manifest reload', () => {
  test('a manifest rewrite on disk keeps unsaved edits in the open manifest', async ({ page }) => {
    await page.route('**/api/workspace/files/chapters%2FCHAPTERS.md', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"disk busy"}' })
        return
      }
      await route.continue()
    })

    await gotoApp(page)
    await selectFileInSidebar(page, 'CHAPTERS.md')
    await page.locator('.ProseMirror').first().press('ControlOrMeta+End')
    await typeInEditor(page, ' my unsaved manifest note')

    // Rename chapter-1.md: the backend rewrites CHAPTERS.md and the app syncs it.
    const row = page.locator('.group').filter({ hasText: 'chapter-1.md' }).first()
    await row.hover()
    await row.locator('button[title*="Rename"]').first().click()
    const input = page.locator('input[placeholder*="chapter-1.md"]').first()
    await expect(input).toBeVisible()
    await input.fill('opening.md')
    await page.locator('button[type="submit"]').filter({ hasText: /Rename/i }).first().click()
    await expect(page.locator('.group').filter({ hasText: 'opening.md' }).first()).toBeVisible({ timeout: 10000 })
    await pace(page, 800)

    await expect(editorText(page)).toContainText('my unsaved manifest note')
    await expect(page.getByText(/updated on disk while you had unsaved edits/i).first()).toBeVisible({ timeout: 5000 })
  })
})
