import { test, expect, gotoApp, pace } from '../helpers'

test.describe('Group 2: File Operations - TC-2.1 Create File & Section Folder', () => {
  test('creates new file via + button and new section folder via FolderPlus button', async ({ page }) => {
    await gotoApp(page)
    await pace(page, 1000)

    const uniqueId = Date.now().toString().slice(-4)
    const newFileName = `char-${uniqueId}.md`

    // 1. Hover on characters/ and click '+' icon
    const charactersHeader = page.locator('.group').filter({ hasText: /^characters\//i }).first()
    await charactersHeader.hover()
    const addFileBtn = charactersHeader.locator('button[title*="New file"]').first()
    await expect(addFileBtn).toBeVisible()
    await addFileBtn.click()

    // 2. Fill in CreateFileModal
    const filenameInput = page.locator('input[placeholder*="chapter-2.md"]').first()
    await expect(filenameInput).toBeVisible()
    await filenameInput.fill(newFileName)
    await page.getByRole('button', { name: /create file/i }).click()
    await pace(page, 1000)

    // 3. Verify new file appears in sidebar and is selected
    const createdRow = page.locator('.group').filter({ hasText: newFileName }).first()
    await expect(createdRow).toBeVisible()

    // 4. Create new Section Folder via New Folder button
    const newFolderBtn = page.locator('button[title="New Folder"]').first()
    await expect(newFolderBtn).toBeVisible()
    await newFolderBtn.click()
    const folderInput = page.locator('input[placeholder*="world_building"]').first()
    await expect(folderInput).toBeVisible()
    const newFolderName = `locs${uniqueId}`
    await folderInput.fill(newFolderName)
    await page.getByRole('button', { name: /create folder/i }).click()
    await pace(page, 1000)

    // Verify new folder appears in sidebar
    const createdFolder = page.locator('.group').filter({ hasText: new RegExp(`^${newFolderName}/`, 'i') }).first()
    await expect(createdFolder).toBeVisible()

    // Cleanup: Delete the created test file
    await createdRow.hover()
    const trashBtn = createdRow.locator('button[title*="Delete"]').first()
    await trashBtn.click()
    await page.getByRole('button', { name: /Delete File/i }).click()
    await pace(page, 800)
  })
})
