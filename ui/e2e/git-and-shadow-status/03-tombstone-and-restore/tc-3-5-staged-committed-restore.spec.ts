import {
  test,
  expect,
  gotoApp,
  selectFileInSidebar,
  typeInEditor,
  saveActiveDocument,
  clickStageOrSnapshot,
  pace,
} from '../helpers'

test.describe('Group 3: Tombstone & Restore - TC-3.5 Staged Committed Restore', () => {
  test('verifies restore button is active for clean staged committed file and only committed option is enabled', async ({
    page,
  }) => {
    test.setTimeout(60000)
    await gotoApp(page)
    await pace(page, 1000)

    // 1. Select a previously committed file in the workspace
    await selectFileInSidebar(page, 'general.md')

    // 2. Modify content and stage it
    const testContent = '\n\n/* Clean Staged Committed File Test Entry */'
    await typeInEditor(page, testContent)
    await saveActiveDocument(page)
    await clickStageOrSnapshot(page)
    await pace(page, 500)

    // Verify row has S badge (clean staged: no unstaged changes)
    const row = page.locator('.group').filter({ hasText: 'general.md' }).first()
    await expect(row.locator('span[title="Staged changes"]')).toBeVisible()
    await expect(row.locator('span[title="Staged and unstaged changes"]')).toHaveCount(0)
    await expect(row.locator('span[title="Unstaged changes"]')).toHaveCount(0)

    // 3. Verify Restore button in the bottom toolbar is active and enabled
    const restoreBtn = page.locator('button[title*="Restore"]').first()
    await expect(restoreBtn).toBeEnabled()

    // 4. Click restore button to open modal
    await restoreBtn.click()
    await pace(page, 500)

    const modal = page.locator('div.fixed').filter({ hasText: 'Restore general.md?' })
    await expect(modal).toBeVisible()

    const worktreeOnlyRadio = modal.locator('input[value="worktree_only"]')
    const stagedAndUnstageRadio = modal.locator('input[value="staged_and_unstage"]')
    const committedRadio = modal.locator('input[value="committed"]')

    // 5. Verify Option 1 (worktree_only) is disabled
    await expect(worktreeOnlyRadio).toBeDisabled()

    // 6. Verify Option 2 (staged_and_unstage) is disabled
    await expect(stagedAndUnstageRadio).toBeDisabled()

    // 7. Verify Option 3 (committed) is enabled and checked by default
    await expect(committedRadio).toBeEnabled()
    await expect(committedRadio).toBeChecked()

    // 8. Verify disabled reason indicates working copy already matches staged version
    await expect(modal).toContainText('Working copy already matches staged version')

    // 9. Confirm restore to committed version
    const confirmBtn = page.getByRole('button', { name: /Restore File/i }).first()
    await confirmBtn.click()
    await pace(page, 1000)

    // Modal should close
    await expect(modal).toHaveCount(0)

    // 10. Verify file is now clean in Git
    await expect(row.locator('span[title="Staged changes"]')).toHaveCount(0)
    await expect(row.locator('span[title="Unstaged changes"]')).toHaveCount(0)
    await expect(row.locator('span[title="Staged and unstaged changes"]')).toHaveCount(0)

    // 11. Verify editor content was restored to committed baseline without the test entry
    const editor = page.locator('.ProseMirror').first()
    await expect(editor).not.toContainText('Clean Staged Committed File Test Entry')
  })
})
