import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useScene(sceneId: string | null) {
  const queryClient = useQueryClient()

  const { data: sceneData, isLoading } = useQuery({
    queryKey: ['scene', sceneId],
    queryFn: async () => {
      if (!sceneId) return null
      const res = await fetch(`http://127.0.0.1:8000/scenes/${sceneId}`)
      if (!res.ok) throw new Error('Failed to fetch scene')
      return res.json()
    },
    enabled: !!sceneId
  })

  const decomposeMutation = useMutation({
    mutationFn: async () => {
      if (!sceneId) return
      const res = await fetch(`http://127.0.0.1:8000/scenes/${sceneId}/decompose`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to decompose scene events')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scene', sceneId] })
      queryClient.invalidateQueries({ queryKey: ['blueprint'] }) // Also refresh acts overview
    }
  })

  return { 
    sceneData, 
    isLoading,
    decomposeScene: decomposeMutation.mutate,
    isDecomposing: decomposeMutation.isPending
  }
}
