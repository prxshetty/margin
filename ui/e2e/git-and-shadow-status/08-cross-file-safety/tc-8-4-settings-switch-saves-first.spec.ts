import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { test, expect, gotoApp, selectFileInSidebar, typeInEditor, pace, safeRemoveDirSync } from '../helpers'
import { getLinkedWorkspace } from './crossFileHelpers'

// Regression: linking a workspace from Settings did not save the open file first.
// The backend switched workspace while the editor still held unsaved text under a
// path that now resolved in the other workspace. The switch now saves first and
// is refused when that save fails (simulated here), so nothing is lost or misfiled.
test.describe('Group 8: Cross-file safety - TC-8.4 Settings workspace switch', () => {
  test('linking a workspace is refused when the open file cannot be saved', async ({ page, testWorkspace }) => {
    const otherWorkspace = mkdtempSync(join(tmpdir(), 'margin_e2e_other_')).replace(/\\/g, '/')
    try {
      await page.route('**/api/workspace/files/chapters%2Fchapter-1.md', async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"disk busy"}' })
          return
        }
        await route.continue()
      })
      // The folder picker is a native dialog on the backend; answer it directly.
      await page.route('**/api/workspace/pick-folder', (route) =>
        route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ path: otherWorkspace }) })
      )

      await gotoApp(page)
      await selectFileInSidebar(page, 'chapter-1.md')
      await typeInEditor(page, ' unsaved words')

      await page.locator('button[title="Settings"]').first().click()
      await page.getByText('Workspaces', { exact: true }).first().click()
      await page.getByRole('button', { name: /Open existing/i }).first().click()
      await page.getByRole('button', { name: /^Link$/ }).first().click()
      await pace(page, 800)

      await expect(page.getByText(/workspace was not switched/i).first()).toBeVisible({ timeout: 5000 })
      expect(await getLinkedWorkspace()).toBe(testWorkspace.path)
    } finally {
      safeRemoveDirSync(otherWorkspace)
    }
  })
})
