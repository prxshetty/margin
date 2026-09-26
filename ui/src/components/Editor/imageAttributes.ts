export function numOrNull(v: unknown): number | null {
  return typeof v === 'number' ? v : null
}
