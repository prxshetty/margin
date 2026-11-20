import type { Page, Route } from '@playwright/test'
import { readFileSync } from 'fs'
import { join } from 'path'
import { E2E_API_BASE } from '../../isolated-env'
import { expect, pace } from '../helpers'

/** Server-sent events body in the format lib/stream-sse.ts parses. */
export function sseBody(events: Record<string, unknown>[]): string {
  return events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('')
}

export function fulfillSse(route: Route, events: Record<string, unknown>[]) {
  return route.fulfill({
    status: 200,
    headers: { 'Content-Type': 'text/event-stream' },
    body: sseBody(events),
  })
}

/** Selects an agent harness so assist runs take the harness (merge-at-done) path. The fixture restores settings. */
export async function useHarness(harness: string) {
  const res = await fetch(`${E2E_API_BASE}/api/settings/`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates: { default_harness: harness } }),
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Could not select harness: ${res.status}`)
}

export async function getLinkedWorkspace(): Promise<string | null> {
  const res = await fetch(`${E2E_API_BASE}/api/settings/`, { signal: AbortSignal.timeout(10000) })
  const data = await res.json()
  return data.linked_workspace_dir ?? null
}

export function readWorkspaceFile(wsPath: string, rel: string): string {
  return readFileSync(join(wsPath, ...rel.split('/')), 'utf-8').replace(/\r\n/g, '\n')
}

/** Starts an assist edit from the assist panel's instruction box. */
export async function startAssistEdit(page: Page, instruction: string) {
  const box = assistInput(page)
  await expect(box).toBeVisible({ timeout: 10000 })
  await box.click()
  await page.keyboard.type(instruction)
  await page.keyboard.press('Enter')
  await pace(page, 300)
}

/** The assist panel's instruction box (a contenteditable textbox). */
export function assistInput(page: Page) {
  return page.locator('[role="textbox"][data-placeholder]').first()
}

export function editorText(page: Page) {
  return page.locator('.ProseMirror').first()
}
