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
      if (!sceneId) return null
      const res = await fetch(`http://127.0.0.1:8000/scenes/${sceneId}/decompose`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to decompose scene events')
      return res.json()
    },
  })

  const decomposeScene = async () => {
    try {
      const data = await decomposeMutation.mutateAsync()
      if (data) {
        queryClient.setQueryData(['scene', sceneId], data)
        queryClient.invalidateQueries({ queryKey: ['blueprint'] })
      }
    } catch (err) {
      console.error('Decomposition failed:', err)
    }
  }

  return { 
    sceneData, 
    isLoading,
    decomposeScene,
    isDecomposing: decomposeMutation.isPending
  }
}
