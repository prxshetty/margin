import { writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, gotoApp, selectFileInSidebar, pace } from '../helpers'
import { editorText, fulfillSse, readWorkspaceFile, startAssistEdit, useHarness } from './crossFileHelpers'

const SECOND = 'chapters/chapter-2.md'
const SECOND_TEXT = '# Chapter 2\n\nThe second chapter stays exactly as written.\n'

// Regression: an AI edit snapshots the open file when it starts and applies its
// result to whichever file is open when it ends. Switching files mid-run attached
// one chapter's text to another, and the next save wrote it there.
test.describe('Group 8: Cross-file safety - TC-8.2 Switch during AI run', () => {
  test('opening another file is refused while an AI edit runs', async ({ page, testWorkspace }) => {
    writeFileSync(join(testWorkspace.path, 'chapters', 'chapter-2.md'), SECOND_TEXT)
    await useHarness('claude')

    // Hold the assist response open so the run stays active until released.
    let release: () => void = () => {}
    const released = new Promise<void>((resolve) => { release = resolve })
    await page.route('**/api/assist/simple', async (route) => {
      await released
      await fulfillSse(route, [{ status: 'harness_done' }])
    })

    await gotoApp(page)
    await selectFileInSidebar(page, 'chapter-1.md')
    await expect(editorText(page)).toContainText('Begin drafting your opening chapter here.')

    const assistDone = page.waitForResponse('**/api/assist/simple')
    await startAssistEdit(page, 'Tighten this chapter')

    // Mid-run: the switch is refused and chapter 1 stays open.
    await page.locator('.group').filter({ hasText: 'chapter-2.md' }).first().click()
    await expect(page.getByText(/Wait for the AI edit to finish/i).first()).toBeVisible({ timeout: 5000 })
    await expect(editorText(page)).toContainText('Begin drafting your opening chapter here.')
    await expect(editorText(page)).not.toContainText('The second chapter')

    release()
    await assistDone
    await pace(page, 800)

    // After the run the switch works, and chapter 2 is untouched on disk.
    await selectFileInSidebar(page, 'chapter-2.md')
    await expect(editorText(page)).toContainText('The second chapter stays exactly as written.')
    expect(readWorkspaceFile(testWorkspace.path, SECOND)).toBe(SECOND_TEXT)
  })
})
