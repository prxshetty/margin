import { rmSync } from 'fs'
import { E2E_ROOT } from './isolated-env'

/** Remove the run's throwaway settings and fallback workspace. */
export default function globalTeardown() {
  try {
    rmSync(E2E_ROOT, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch (err) {
    // The isolated backend may still hold a handle on Windows; a leftover temp folder is harmless.
    console.warn(`Could not remove E2E temp root ${E2E_ROOT}:`, err)
  }
}
