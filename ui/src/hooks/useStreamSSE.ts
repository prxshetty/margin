import { useCallback, useRef, useEffect } from 'react'
import { streamSSE } from '../lib/stream-sse'

export function useStreamSSE() {
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    return () => abortRef.current?.abort()
  }, [])

  const stream = useCallback(async (
    url: string,
    body: Record<string, unknown>,
    onEvent: (type: string, data: Record<string, unknown>) => void
  ): Promise<void> => {
    abortRef.current?.abort()
    abortRef.current = new AbortController()
    await streamSSE(url, body, onEvent, abortRef.current.signal)
  }, [])

  const cancel = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { stream, cancel } as const
}
