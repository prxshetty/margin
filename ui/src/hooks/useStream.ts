import { useEditorStore } from '../stores/editorStore'
import { useQueryClient } from '@tanstack/react-query'
import { API_BASE } from '../lib/api'

export function useStream() {
  const { setContent, setIsStreaming, eventSource, setEventSource } = useEditorStore()
  const queryClient = useQueryClient()

  const generateScene = (sceneId: string) => {
    setIsStreaming(true)
    setContent('')

    // Close any previous stream just in case
    if (eventSource) {
      eventSource.close()
    }

    const es = new EventSource(`${API_BASE}/scenes/${sceneId}/generate`)
    setEventSource(es)

    es.onmessage = (event) => {
      const data = JSON.parse(event.data)
      if (data.done) {
        es.close()
        setEventSource(null)
        setIsStreaming(false)
        
        // Refresh scene data and logs when stream finishes
        queryClient.invalidateQueries({ queryKey: ['scene', sceneId] })
        queryClient.invalidateQueries({ queryKey: ['sceneLogs', sceneId] })
      } else if (data.content) {
        setContent(data.content)
      }
    }

    es.onerror = (error) => {
      console.error('SSE error:', error)
      es.close()
      setEventSource(null)
      setIsStreaming(false)
    }
  }

  const stopGeneration = () => {
    if (eventSource) {
      eventSource.close()
      setEventSource(null)
    }
    setIsStreaming(false)
  }

  return { generateScene, stopGeneration }
}
