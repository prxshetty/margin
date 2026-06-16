export async function streamSSE(
  url: string,
  body: Record<string, unknown>,
  onEvent: (type: string, data: Record<string, unknown>) => void,
  signal?: AbortSignal
): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)

  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const clean = line.trim()
      if (!clean.startsWith('data: ')) continue
      try {
        const data = JSON.parse(clean.slice(6))
        onEvent(data.status, data)
      } catch (e) {
        console.error('Error parsing stream chunk:', e)
      }
    }
  }
}
