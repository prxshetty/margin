/**
 * Isolated E2E environment.
 *
 * The suite never talks to the user's own backend (port 8000) or settings:
 * Playwright starts a dedicated backend and UI on their own ports, with
 * settings.json and the fallback workspace in a throwaway temp folder.
 * Nothing a test does — including a late save-on-close request that lands
 * after a test's teardown — can reach the user's settings or manuscripts.
 */
import { existsSync, mkdirSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join, resolve } from 'path'
import { fileURLToPath } from 'url'

const UI_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const REPO_ROOT = resolve(UI_DIR, '..')

/** Ports reserved for the isolated instance (never the app's own 8000 / 5173). */
export const E2E_API_PORT = Number(process.env.E2E_API_PORT || 8765)
export const E2E_UI_PORT = Number(process.env.E2E_UI_PORT || 5199)

const RESERVED_PORTS = new Set([8000, 5173])
for (const port of [E2E_API_PORT, E2E_UI_PORT]) {
  if (RESERVED_PORTS.has(port)) {
    throw new Error(`E2E port ${port} is reserved for the real app; pick another E2E_API_PORT / E2E_UI_PORT.`)
  }
}

export const E2E_API_BASE = `http://127.0.0.1:${E2E_API_PORT}`
export const E2E_UI_BASE = `http://127.0.0.1:${E2E_UI_PORT}`

/**
 * One temp root per run. The config is evaluated in the runner and again in
 * each worker; workers inherit MARGIN_E2E_ROOT, so they all agree on it.
 */
function ensureRunRoot(): string {
  if (!process.env.MARGIN_E2E_ROOT) {
    process.env.MARGIN_E2E_ROOT = mkdtempSync(join(tmpdir(), 'margin-e2e-'))
  }
  const root = process.env.MARGIN_E2E_ROOT
  for (const sub of ['config', 'default-workspace']) mkdirSync(join(root, sub), { recursive: true })
  return root
}

export const E2E_ROOT = ensureRunRoot()
export const E2E_CONFIG_DIR = join(E2E_ROOT, 'config')
export const E2E_DEFAULT_WORKSPACE = join(E2E_ROOT, 'default-workspace')

// Every fixture helper reads these, so test code can only reach the isolated instance.
process.env.API_BASE_URL = E2E_API_BASE
process.env.BASE_URL = E2E_UI_BASE

/** The project venv's interpreter when present, else python on PATH (cross-platform). */
export function pythonExecutable(): string {
  const candidates = process.platform === 'win32'
    ? [join(REPO_ROOT, '.venv', 'Scripts', 'python.exe')]
    : [join(REPO_ROOT, '.venv', 'bin', 'python3'), join(REPO_ROOT, '.venv', 'bin', 'python')]
  const found = candidates.find((p) => existsSync(p))
  if (found) return found
  return process.platform === 'win32' ? 'python' : 'python3'
}

const quote = (s: string) => (/\s/.test(s) ? `"${s}"` : s)

/** Playwright `webServer` entries for the isolated backend and UI. Never reuses a running server. */
export function isolatedWebServers() {
  return [
    {
      command: `${quote(pythonExecutable())} -m uvicorn api.main:app --host 127.0.0.1 --port ${E2E_API_PORT}`,
      cwd: REPO_ROOT,
      url: `${E2E_API_BASE}/api/settings/`,
      reuseExistingServer: false,
      timeout: 60000,
      stdout: 'ignore' as const,
      stderr: 'pipe' as const,
      env: {
        ...process.env,
        MARGIN_CONFIG_DIR: E2E_CONFIG_DIR,
        MARGIN_DEFAULT_WORKSPACE_DIR: E2E_DEFAULT_WORKSPACE,
      } as Record<string, string>,
    },
    {
      command: `npm run dev -- --host 127.0.0.1 --port ${E2E_UI_PORT} --strictPort`,
      cwd: UI_DIR,
      url: E2E_UI_BASE,
      reuseExistingServer: false,
      timeout: 60000,
      stdout: 'ignore' as const,
      stderr: 'pipe' as const,
      env: { ...process.env, VITE_API_BASE: E2E_API_BASE } as Record<string, string>,
    },
  ]
}
