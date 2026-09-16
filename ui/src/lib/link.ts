/** Normalize user-typed URLs: keep explicit schemes, default bare hosts to https. */
export function normalizeHref(raw: string): string {
  const v = (raw || '').trim()
  if (!v) return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(v)) return v
  return `https://${v}`
}
