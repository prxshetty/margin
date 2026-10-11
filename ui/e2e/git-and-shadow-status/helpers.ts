import { test as base, expect, Page } from '@playwright/test'
import { tmpdir } from 'os'
import { join } from 'path'
import { rmSync, statSync, readdirSync, chmodSync, existsSync } from 'fs'

const API_BASE = process.env.API_BASE_URL || 'http://127.0.0.1:8000'

function safeRemoveDirSync(dirPath: string) {
  try {
    rmSync(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    try {
      const resetPerms = (cur: string) => {
        if (!existsSync(cur)) return
        const stat = statSync(cur)
        if (stat.isDirectory()) {
          for (const entry of readdirSync(cur)) {
            resetPerms(join(cur, entry))
          }
        }
        chmodSync(cur, 0o666)
      }
      resetPerms(dirPath)
      rmSync(dirPath, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
    } catch (err) {
      console.warn(`Cleanup error for test workspace ${dirPath}:`, err)
    }
  }
}

export interface TestWorkspace {
  path: string
  isGit: boolean
}

/**
 * Custom Playwright test fixture that automatically scaffolds a brand-new,
 * isolated workspace in OS temp before each test and completely cleans it up after.
 */
export const test = base.extend<{ testWorkspace: TestWorkspace }>({
  testWorkspace: [
    async ({}, use, testInfo) => {
      const testTitle = testInfo.title.toLowerCase()
      const fileBase = (testInfo.file.split(/[/\\]/).pop() || '').toLowerCase()
      const isShadow =
        testTitle.includes('shadow') ||
        testTitle.includes('finalize') ||
        fileBase.includes('shadow') ||
        fileBase.includes('finalize')

      // 1. Capture full original application settings
      let originalSettings: Record<string, unknown> | null = null
      try {
        const settingsRes = await fetch(`${API_BASE}/api/settings/`, {
          signal: AbortSignal.timeout(10000),
        })
        if (settingsRes.ok) {
          originalSettings = await settingsRes.json()
        }
      } catch {}

      // 2. Generate unique temp directory path
      const uniqueName = `margin_e2e_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      const wsPath = join(tmpdir(), uniqueName).replace(/\\/g, '/')

      // 3. Create fresh workspace via backend API
      const parentDir = tmpdir().replace(/\\/g, '/')
      const createRes = await fetch(`${API_BASE}/api/workspace/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          parent_path: parentDir,
          name: uniqueName,
          init_git: !isShadow,
          set_as_active: true,
        }),
        signal: AbortSignal.timeout(10000),
      })

      if (!createRes.ok) {
        const err = await createRes.text()
        throw new Error(`Failed to create test workspace at ${wsPath}: ${err}`)
      }
      const createData = await createRes.json()
      const actualWsPath = createData.path || wsPath

      // 4. Initialize known test default settings for predictable execution
      try {
        await fetch(`${API_BASE}/api/settings/`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            updates: {
              show_additions: true,
              show_deletions: true,
              show_file_action_labels: true,
              theme_family: 'sand',
              theme: 'light',
              text_style: 'system',
              editor_stats: 'words',
              linked_workspace_dir: actualWsPath,
            },
          }),
          signal: AbortSignal.timeout(10000),
        })
      } catch {}

      // 5. Run test within this isolated workspace
      await use({ path: actualWsPath, isGit: !isShadow })

      // 6. Cleanup: Restore full original settings & permanently remove temp directory
      try {
        if (originalSettings) {
          await fetch(`${API_BASE}/api/settings/`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              updates: originalSettings,
            }),
            signal: AbortSignal.timeout(10000),
          }).catch(() => {})
        }

        safeRemoveDirSync(actualWsPath)
      } catch (err) {
        console.warn(`Cleanup error for test workspace ${actualWsPath}:`, err)
      }
    },
    { auto: true },
  ],
})

export { expect }

/**
 * Navigates to the app root, automatically falling back to http://localhost:5173 if baseURL is not configured.
 */
export async function gotoApp(page: Page) {
  try {
    await page.goto('/')
  } catch {
    await page.goto(process.env.BASE_URL || 'http://localhost:5173')
  }
}

/**
 * Paces actions when running headed so actions can be observed comfortably.
 */
export async function pace(page: Page, ms = 600) {
  if (process.env.HEADED || process.argv.includes('--headed')) {
    await page.waitForTimeout(Math.max(ms, 1000))
  } else {
    await page.waitForTimeout(ms)
  }
}

/**
 * Selects a file in the sidebar by name.
 */
export async function selectFileInSidebar(page: Page, fileName: string) {
  const row = page.locator('.group').filter({ hasText: fileName }).first()
  await expect(row).toBeVisible({ timeout: 10000 })
  await row.click()
  await expect(page.locator('.editor-bottom-bar')).toBeVisible({ timeout: 10000 })
  await pace(page, 500)
}

/**
 * Types text into the ProseMirror TipTap editor canvas.
 */
export async function typeInEditor(page: Page, textToType: string) {
  const editor = page.locator('.ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 10000 })
  await editor.click()

  await page.keyboard.type(textToType)
  await pace(page, 600)
}

/**
 * Saves active document (Ctrl+S / Cmd+S).
 */
export async function saveActiveDocument(page: Page) {
  await page.keyboard.press('ControlOrMeta+S')
  await pace(page, 600)
}

/**
 * Clicks the Stage or Snapshot button in the bottom toolbar.
 */
export async function clickStageOrSnapshot(page: Page) {
  const btn = page.locator('.editor-bottom-bar button').first()
  await expect(btn).toBeEnabled({ timeout: 10000 })
  await btn.click()
  await pace(page, 1000)
}

/**
 * Clicks the Restore button in the bottom toolbar and confirms the modal.
 */
export async function restoreActiveDocument(
  page: Page,
  mode?: 'worktree_only' | 'staged_and_unstage' | 'committed'
) {
  const restoreBtn = page.locator('button[title*="Restore"]').first()
  await expect(restoreBtn).toBeEnabled({ timeout: 10000 })
  await restoreBtn.click()
  await pace(page, 500)

  if (mode) {
    const radio = page.locator(`input[value="${mode}"]`)
    if (await radio.count() > 0 && await radio.isEnabled()) {
      await radio.click()
      await pace(page, 300)
    }
  }

  // Confirm in modal
  const confirmBtn = page.getByRole('button', { name: /Restore File|Confirm Restore/i }).first()
  await expect(confirmBtn).toBeVisible({ timeout: 5000 })
  await confirmBtn.click()
  await pace(page, 1000)
}

/**
 * Clears all content from the editor canvas.
 */
export async function clearEditor(page: Page) {
  const editor = page.locator('.ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 10000 })
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  await pace(page, 500)
}

/**
 * Sets editor content by selecting all, clearing, and typing the new text.
 */
export async function setEditorContent(page: Page, text: string) {
  const editor = page.locator('.ProseMirror').first()
  await expect(editor).toBeVisible({ timeout: 10000 })
  await editor.click()
  await page.keyboard.press('ControlOrMeta+A')
  await page.keyboard.press('Backspace')
  if (text) {
    await page.keyboard.type(text)
  }
  await pace(page, 500)
}
