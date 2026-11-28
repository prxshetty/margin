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

test.describe('Group 3: Tombstone & Restore - TC-3.4 Restore Modes and Rename Impact', () => {
  test('verifies worktree_only, staged_and_unstage, committed modes, disabled options, and rename descriptions', async ({
    page,
  }) => {
    test.setTimeout(60000)
    await gotoApp(page)
    await pace(page, 1000)

    // 1. Select general.md in styles/
    await selectFileInSidebar(page, 'general.md')

    // 2. Modify and stage
    await typeInEditor(page, '\n\n/* Staged baseline content */')
    await saveActiveDocument(page)
    await clickStageOrSnapshot(page)

    // Verify row has S badge
    const row = page.locator('.group').filter({ hasText: 'general.md' }).first()
    await expect(row.locator('span[title="Staged changes"]')).toBeVisible()

    // 3. Add unstaged working modifications
    await typeInEditor(page, '\n/* Unstaged working edit */')
    await saveActiveDocument(page)
    await pace(page, 500)

    // Row should now have S/M badge (staged_modified)
    await expect(row.locator('span[title="Staged and unstaged changes"]')).toBeVisible()

    // 4. Open restore modal
    const restoreBtn = page.locator('button[title*="Restore"]').first()
    await expect(restoreBtn).toBeEnabled()
    await restoreBtn.click()
    await pace(page, 500)

    // Verify modal is open and shows all 3 options
    const modal = page.locator('div.fixed').filter({ hasText: 'Restore general.md?' })
    await expect(modal).toBeVisible()

    const worktreeOnlyRadio = modal.locator('input[value="worktree_only"]')
    const stagedAndUnstageRadio = modal.locator('input[value="staged_and_unstage"]')
    const committedRadio = modal.locator('input[value="committed"]')

    // In staged_modified state, all 3 options should be enabled
    await expect(worktreeOnlyRadio).toBeEnabled()
    await expect(stagedAndUnstageRadio).toBeEnabled()
    await expect(committedRadio).toBeEnabled()

    // Topmost option worktree_only must be checked by default
    await expect(worktreeOnlyRadio).toBeChecked()

    // Test dynamic description updates when clicking options
    await worktreeOnlyRadio.click()
    await expect(modal).toContainText('discard uncommitted modifications in your working copy and restore the file to the staged version')
    await expect(modal).toContainText('Staged changes will remain staged in Git.')

    await stagedAndUnstageRadio.click()
    await expect(modal).toContainText('restore the content of the staged version to the working tree and unstage it')

    await committedRadio.click()
    await expect(modal).toContainText('discard all uncommitted modifications and staged changes in this file and restore it to the committed baseline version')

    // 5. Test Option 1: worktree_only
    await worktreeOnlyRadio.click()
    const confirmBtn = page.getByRole('button', { name: /Restore File/i }).first()
    await confirmBtn.click()
    await pace(page, 1000)

    // After worktree_only, unstaged modifications are discarded: S remains, S/M is gone
    await expect(row.locator('span[title="Staged changes"]')).toBeVisible()
    await expect(row.locator('span[title="Staged and unstaged changes"]')).toHaveCount(0)

    // 6. Test Option 2: staged_and_unstage
    // Add another working modification so restore button is active
    await typeInEditor(page, '\n/* Edit before unstaging */')
    await saveActiveDocument(page)
    await pace(page, 500)
    await expect(row.locator('span[title="Staged and unstaged changes"]')).toBeVisible()

    await restoreBtn.click()
    await pace(page, 500)

    await expect(stagedAndUnstageRadio).toBeEnabled()
    await stagedAndUnstageRadio.click()
    await expect(modal).toContainText('restore the content of the staged version to the working tree and unstage it')

    await confirmBtn.click()
    await pace(page, 1000)

    // After staged_and_unstage, file is unstaged: M appears, S is gone
    await expect(row.locator('span[title="Unstaged changes"]')).toBeVisible()
    await expect(row.locator('span[title="Staged changes"]')).toHaveCount(0)
    await expect(row.locator('span[title="Staged and unstaged changes"]')).toHaveCount(0)

    // 7. Verify disabled state when document has been committed but not staged since
    await restoreBtn.click()
    await pace(page, 500)

    // Both worktree_only and staged_and_unstage should be disabled!
    await expect(modal.locator('input[value="worktree_only"]')).toBeDisabled()
    await expect(modal.locator('input[value="staged_and_unstage"]')).toBeDisabled()
    await expect(modal).toContainText('Document has not been staged since commit')

    // Option 3 committed is enabled and selected by default
    await expect(committedRadio).toBeEnabled()
    await expect(committedRadio).toBeChecked()

    // Restore to committed baseline
    await confirmBtn.click()
    await pace(page, 1000)

    // File is now completely clean
    await expect(row.locator('span[title="Unstaged changes"]')).toHaveCount(0)
    await expect(row.locator('span[title="Staged changes"]')).toHaveCount(0)
    await expect(row.locator('span[title="Staged and unstaged changes"]')).toHaveCount(0)

    // 8. Test rename scenarios
    // First, modify general.md after the last commit and stage it
    await typeInEditor(page, '\n\n/* Modified before rename */')
    await saveActiveDocument(page)
    await clickStageOrSnapshot(page)
    await pace(page, 500)

    // Now rename general.md -> base-theme.md (staged rename with pre-rename modifications)
    await row.hover()
    const renamePencil = row.locator('button[title*="Rename"]').first()
    await expect(renamePencil).toBeVisible()
    await renamePencil.click()
    const renameInput = page.locator('input[placeholder*="chapter-1.md"]').first()
    await expect(renameInput).toBeVisible()
    await expect(renameInput).toHaveValue('general.md')
    await renameInput.fill('base-theme.md')
    await expect(renameInput).toHaveValue('base-theme.md')
    await page.locator('button[type="submit"]').filter({ hasText: /Rename/i }).first().click()
    await pace(page, 1500)

    const renamedRow = page.locator('.group').filter({ hasText: 'base-theme.md' }).first()
    await expect(renamedRow).toBeVisible()
    await renamedRow.click()

    // Add uncommitted working edits to the renamed file
    await typeInEditor(page, '\n/* Working edit on renamed file */')
    await saveActiveDocument(page)
    await pace(page, 500)

    // Open restore modal on renamed file
    await restoreBtn.click()
    await pace(page, 500)

    const renameModal = page.locator('div.fixed').filter({ hasText: 'Restore base-theme.md?' })
    await expect(renameModal).toBeVisible()
    await expect(renameModal).toContainText('Renamed from general.md')

    const rWorktreeRadio = renameModal.locator('input[value="worktree_only"]')
    const rStagedRadio = renameModal.locator('input[value="staged_and_unstage"]')
    const rCommittedRadio = renameModal.locator('input[value="committed"]')

    // Default must be the least destructive (worktree_only)
    await expect(rWorktreeRadio).toBeChecked()

    // Verify dynamic description for all 3 options mentions the rename
    await expect(renameModal).toContainText('This file was renamed from general.md')
    await expect(renameModal).toContainText('The file will remain renamed as base-theme.md and remain staged in Git.')

    await rStagedRadio.click()
    await expect(renameModal).toContainText('This file was renamed from general.md')
    await expect(renameModal).toContainText('undo the staged rename, restore general.md with the staged content, and unstage it')

    await rCommittedRadio.click()
    await expect(renameModal).toContainText('This file was renamed from general.md')
    await expect(renameModal).toContainText('undo the rename, remove base-theme.md, and restore general.md to its committed baseline version')

    // 8a. Test restoring while leaving staged:
    // Should revert worktree modifications but leave the rename in place
    await rWorktreeRadio.click()
    await confirmBtn.click()
    await pace(page, 1500)

    // Rename is still in place (base-theme.md)
    await expect(renamedRow).toBeVisible()
    await expect(renamedRow.locator('span[title="Renamed in Git"]')).toBeVisible()
    await expect(renamedRow.locator('span[title="Unstaged changes"]')).toHaveCount(0)
    await expect(renamedRow.locator('span[title="Staged and unstaged changes"]')).toHaveCount(0)

    // Editor content has reverted working modifications, but retains staged content
    await expect(page.locator('.ProseMirror')).not.toContainText('Working edit on renamed file')
    await expect(page.locator('.ProseMirror')).toContainText('Modified before rename')

    // 8b. Test reverting to staged:
    // Should undo the rename and retain any modifications made after the last commit and before the rename
    await restoreBtn.click()
    await pace(page, 500)

    // When no working edits exist, worktree_only is disabled, so staged_and_unstage is topmost enabled and default checked
    await expect(renameModal).toBeVisible()
    await expect(rWorktreeRadio).toBeDisabled()
    await expect(rStagedRadio).toBeEnabled()
    await expect(rStagedRadio).toBeChecked()

    // Confirm staged_and_unstage restore
    await confirmBtn.click()
    await pace(page, 1500)

    // Rename is undone: general.md is back, base-theme.md is gone
    const restoredGeneral = page.locator('.group').filter({ hasText: 'general.md' }).first()
    await expect(restoredGeneral).toBeVisible()
    await expect(page.locator('.group').filter({ hasText: 'base-theme.md' })).toHaveCount(0)

    // Modifications made after last commit and before rename are RETAINED in general.md
    await expect(page.locator('.ProseMirror')).toContainText('Modified before rename')

    // File is unstaged (has M badge, no S or R badge)
    await expect(restoredGeneral.locator('span[title="Unstaged changes"]')).toBeVisible()
    await expect(restoredGeneral.locator('span[title="Staged changes"]')).toHaveCount(0)
    await expect(restoredGeneral.locator('span[title="Renamed in Git"]')).toHaveCount(0)

    // 8c. Finally, committed restore returns general.md to repository clean baseline
    await restoreBtn.click()
    await pace(page, 500)
    const finalModal = page.locator('div.fixed').filter({ hasText: 'Restore general.md?' })
    await expect(finalModal).toBeVisible()
    const gCommittedRadio = finalModal.locator('input[value="committed"]')
    await expect(gCommittedRadio).toBeChecked()
    const finalConfirmBtn = finalModal.getByRole('button', { name: /Restore File/i }).first()
    await finalConfirmBtn.click()
    await pace(page, 1500)

    await expect(restoredGeneral.locator('span[title="Unstaged changes"]')).toHaveCount(0)
    await expect(page.locator('.ProseMirror')).not.toContainText('Modified before rename')
  })
})
