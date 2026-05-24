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

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!sceneId) return null
      const res = await fetch(`http://127.0.0.1:8000/scenes/${sceneId}/approve`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to approve scene')
      return res.json()
    },
  })

  const approveScene = async () => {
    try {
      const data = await approveMutation.mutateAsync()
      if (data) {
        queryClient.invalidateQueries({ queryKey: ['scene', sceneId] })
        queryClient.invalidateQueries({ queryKey: ['blueprint'] })
      }
    } catch (err) {
      console.error('Approval failed:', err)
    }
  }

  return { 
    sceneData, 
    isLoading,
    decomposeScene,
    isDecomposing: decomposeMutation.isPending,
    approveScene,
    isApproving: approveMutation.isPending
  }
}
