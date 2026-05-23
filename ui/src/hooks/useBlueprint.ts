import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

export function useBlueprint(chapterId: string | null) {
  const queryClient = useQueryClient()

  const { data: blueprintData, isLoading } = useQuery({
    queryKey: ['blueprint', chapterId],
    queryFn: async () => {
      if (!chapterId) return null
      const res = await fetch(`http://127.0.0.1:8000/chapters/${chapterId}/blueprint/`)
      if (!res.ok) {
        if (res.status === 404) return null
        throw new Error('Failed to fetch blueprint')
      }
      return res.json()
    },
    enabled: !!chapterId
  })

  const generateMutation = useMutation({
    mutationFn: async () => {
      if (!chapterId) return
      const res = await fetch(`http://127.0.0.1:8000/chapters/${chapterId}/blueprint/`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to generate blueprint')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blueprint', chapterId] })
    }
  })

  return {
    blueprintData,
    isLoading,
    generateBlueprint: generateMutation.mutate,
    isGenerating: generateMutation.isPending
  }
}
