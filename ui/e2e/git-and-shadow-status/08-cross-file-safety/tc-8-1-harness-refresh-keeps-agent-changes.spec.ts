import { writeFileSync } from 'fs'
import { join } from 'path'
import { test, expect, gotoApp, selectFileInSidebar, pace } from '../helpers'
import { assistInput, editorText, fulfillSse, readWorkspaceFile, startAssistEdit, useHarness } from './crossFileHelpers'

const CHAPTER = 'chapters/chapter-1.md'
const AGENT_TEXT = '# Chapter 1\n\nThe agent rewrote this chapter on disk.\n'

// Regression: the sidebar refresh scheduled by a harness write event used to blank
// the open file's saved copy. The editor's pre-run text then looked like an unsaved
// edit, and the next blur save wrote it over the agent's changes on disk.
test.describe('Group 8: Cross-file safety - TC-8.1 Harness refresh', () => {
  test('a sidebar refresh during a harness run does not overwrite the agent’s changes', async ({ page, testWorkspace }) => {
    await useHarness('claude')
    await page.route('**/api/assist/simple', async (route) => {
      // The agent edits the open chapter on disk, then reports the write.
      // The stream ends without harness_done, so the editor still shows the pre-run text.
      writeFileSync(join(testWorkspace.path, 'chapters', 'chapter-1.md'), AGENT_TEXT)
      await fulfillSse(route, [
        { status: 'planning' },
        { status: 'tool', tool: 'write', path: CHAPTER, detail: CHAPTER },
      ])
    })

    await gotoApp(page)
    await selectFileInSidebar(page, 'chapter-1.md')
    const preRun = await editorText(page).innerText()
    expect(preRun).not.toContain('The agent rewrote')

    const assistDone = page.waitForResponse('**/api/assist/simple')
    await startAssistEdit(page, 'Rewrite this chapter')
    await assistDone
    // The tool event schedules the sidebar refresh (500 ms debounce).
    await page.waitForResponse((r) => r.url().endsWith('/api/workspace/files') && r.request().method() === 'GET')
    await pace(page, 500)

    // Blur the editor: the routine save that used to overwrite the agent's work.
    await editorText(page).click()
    await assistInput(page).click()
    await pace(page, 1000)

    expect(readWorkspaceFile(testWorkspace.path, CHAPTER)).toBe(AGENT_TEXT)
  })
})
