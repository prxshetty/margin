/** Centralized dropdown placement: open up when the menu wouldn't fit below.
 *
 * Measures against the nearest scroll container (e.g. Settings modal content
 * `overflow-y-auto`) AND the window, so bottom-of-panel dropdowns flip up
 * instead of extending the scroll content / falling below the viewport.
 * All Dropdown instances share this — no per-caller positioning logic.
 */
export function computeDropdownOpenUp(
  buttonEl: HTMLElement | null,
  itemCount: number,
  minimal = false,
): boolean {
  if (!buttonEl) return false
  const rect = buttonEl.getBoundingClientRect()
  const menuH = Math.min(itemCount * 36 + 8, minimal ? 160 : 220)

  // Nearest scrollable ancestor (modal content). Fall back to window only.
  let below = window.innerHeight - rect.bottom
  let above = rect.top
  let el: HTMLElement | null = buttonEl.parentElement
  while (el) {
    const style = window.getComputedStyle(el)
    const overflowY = style.overflowY
    if (overflowY === 'auto' || overflowY === 'scroll') {
      const cRect = el.getBoundingClientRect()
      const belowInContainer = cRect.bottom - rect.bottom
      const aboveInContainer = rect.top - cRect.top
      below = Math.min(below, belowInContainer)
      above = Math.min(above, aboveInContainer)
      break
    }
    el = el.parentElement
  }
  return below < menuH && above > below
}
