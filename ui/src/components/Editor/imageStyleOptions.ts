const BUILTIN_STYLE_NAMES = ['None', 'Cinematic', 'Illustration']

export function imageStyleOptions(
  customs: { name: string; prompt: string }[] | undefined,
  deleted?: string[] | undefined,
): string[] {
  const hidden = (deleted ?? []).map((d) => d.toLowerCase())
  const names = BUILTIN_STYLE_NAMES.filter((n) => !hidden.includes(n.toLowerCase()))
  for (const c of customs ?? []) {
    const n = (c?.name || '').trim()
    if (n && !names.some((x) => x.toLowerCase() === n.toLowerCase())) names.push(n)
  }
  return names
}
