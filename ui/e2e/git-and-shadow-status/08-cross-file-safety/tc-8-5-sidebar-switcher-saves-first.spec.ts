import { tmpdir } from 'os'
import { E2E_API_BASE } from '../../isolated-env'
import { test, expect, gotoApp, selectFileInSidebar, typeInEditor, pace, safeRemoveDirSync } from '../helpers'
import { getLinkedWorkspace } from './crossFileHelpers'

// Regression: the sidebar's workspace switcher sent the switch without waiting for the
// open file to save. The blur save it triggers could land after the backend switched
// (writing into the new workspace), and a failed save went unnoticed. The switch now
// waits for the save and is refused when it fails (simulated here).
test.describe('Group 8: Cross-file safety - TC-8.5 Sidebar workspace switcher', () => {
  test('the sidebar switcher refuses to switch when the open file cannot be saved', async ({ page, testWorkspace }) => {
    // A second workspace profile to switch to (not activated).
    const createRes = await fetch(`${E2E_API_BASE}/api/workspace/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        parent_path: tmpdir().replace(/\\/g, '/'),
        name: `margin_e2e_switch_${Date.now()}`,
        init_git: false,
        set_as_active: false,
      }),
      signal: AbortSignal.timeout(10000),
    })
    expect(createRes.ok).toBe(true)
    const otherPath: string = (await createRes.json()).path
    // Not activated, so add its profile for the switcher to list (the fixture restores settings).
    const settings = await (await fetch(`${E2E_API_BASE}/api/settings/`, { signal: AbortSignal.timeout(10000) })).json()
    const profiles = [...(settings.workspace_profiles || []), { id: `e2e-${Date.now()}`, name: 'Other workspace', path: otherPath }]
    await fetch(`${E2E_API_BASE}/api/settings/`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ updates: { workspace_profiles: profiles } }),
      signal: AbortSignal.timeout(10000),
    })
    try {
      await page.route('**/api/workspace/files/chapters%2Fchapter-1.md', async (route) => {
        if (route.request().method() === 'PUT') {
          await route.fulfill({ status: 500, contentType: 'application/json', body: '{"detail":"disk busy"}' })
          return
        }
        await route.continue()
      })

      await gotoApp(page)
      await selectFileInSidebar(page, 'chapter-1.md')
      await typeInEditor(page, ' unsaved words')

      await page.locator('button[title="Switch workspace"]').first().click()
      await page.getByRole('button', { name: 'Other workspace', exact: true }).first().click()
      await pace(page, 800)

      await expect(page.getByText(/workspace was not switched/i).first()).toBeVisible({ timeout: 5000 })
      expect(await getLinkedWorkspace()).toBe(testWorkspace.path)
      await expect(page.locator('.ProseMirror').first()).toContainText('unsaved words')
    } finally {
      safeRemoveDirSync(otherPath)
    }
  })
})
