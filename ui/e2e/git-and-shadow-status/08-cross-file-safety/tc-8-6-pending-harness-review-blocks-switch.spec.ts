import { writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, gotoApp, selectFileInSidebar, pace } from '../helpers'
import { assistInput, editorText, fulfillSse, readWorkspaceFile, startAssistEdit, useHarness } from './crossFileHelpers'

const CHAPTER = 'chapters/chapter-1.md'
const AGENT_TEXT = '# Chapter 1\n\nThe agent rewrote the opening on disk.\n'

// Regression: leaving a file with a pending harness review reverted the editor to the
// pre-run snapshot and cached it as that file's text. Reopening it later showed the
// snapshot as an unsaved edit, and the next blur save wrote it over the agent's version.
// Leaving is now refused until the review is accepted or rejected.
test.describe('Group 8: Cross-file safety - TC-8.6 Pending harness review', () => {
  test('a pending harness review keeps the file open and the agent’s version on disk', async ({ page, testWorkspace }) => {
    writeFileSync(join(testWorkspace.path, 'chapters', 'chapter-2.md'), '# Chapter 2\n\nSecond chapter.\n')
    await useHarness('claude')
    await page.route('**/api/assist/simple', async (route) => {
      writeFileSync(join(testWorkspace.path, 'chapters', 'chapter-1.md'), AGENT_TEXT)
      await fulfillSse(route, [
        { status: 'tool', tool: 'write', path: CHAPTER, detail: CHAPTER },
        { status: 'harness_done' },
      ])
    })

    await gotoApp(page)
    await selectFileInSidebar(page, 'chapter-1.md')
    const assistDone = page.waitForResponse('**/api/assist/simple')
    await startAssistEdit(page, 'Rewrite the opening')
    await assistDone
    await expect(editorText(page)).toContainText('The agent rewrote the opening on disk.', { timeout: 10000 })

    await page.locator('.group').filter({ hasText: 'chapter-2.md' }).first().click()
    await expect(page.getByText(/Accept or reject the AI changes/i).first()).toBeVisible({ timeout: 5000 })
    await expect(editorText(page)).toContainText('The agent rewrote the opening on disk.')

    // A blur save must not put the pre-run text back on disk either.
    await editorText(page).click()
    await assistInput(page).click()
    await pace(page, 1000)
    expect(readWorkspaceFile(testWorkspace.path, CHAPTER)).toContain('The agent rewrote the opening on disk.')
  })
})
