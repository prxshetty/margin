// Forgiving multi-term match: every query token must appear in the haystack.
export function matchesQuery(query: string, haystack: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const hay = haystack.toLowerCase()
  return q.split(/\s+/).every((token) => hay.includes(token))
}
