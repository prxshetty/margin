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
    mutationFn: async (isRegenerate: boolean = false) => {
      if (!chapterId) return
      const method = isRegenerate ? 'PATCH' : 'POST'
      const res = await fetch(`http://127.0.0.1:8000/chapters/${chapterId}/blueprint/`, {
        method
      })
      if (!res.ok) throw new Error('Failed to generate blueprint')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blueprint', chapterId] })
    }
  })

  const confirmMutation = useMutation({
    mutationFn: async () => {
      if (!chapterId) return
      const res = await fetch(`http://127.0.0.1:8000/chapters/${chapterId}/blueprint/confirm`, {
        method: 'POST'
      })
      if (!res.ok) throw new Error('Failed to confirm blueprint')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blueprint', chapterId] })
    }
  })

  const assistMutation = useMutation({
    mutationFn: async ({ message, history }: { message: string; history: any[] }) => {
      if (!chapterId) return
      const res = await fetch(`http://127.0.0.1:8000/chapters/${chapterId}/blueprint/assist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history })
      })
      if (!res.ok) throw new Error('Failed to run assist')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['blueprint', chapterId] })
      queryClient.invalidateQueries({ queryKey: ['blueprintMarkdown', chapterId] })
    }
  })

  return {
    blueprintData,
    isLoading,
    generateBlueprint: (isRegenerate: boolean = false) => generateMutation.mutate(isRegenerate),
    isGenerating: generateMutation.isPending,
    confirmBlueprint: () => confirmMutation.mutate(),
    isConfirming: confirmMutation.isPending,
    blueprintAssist: assistMutation.mutateAsync,
    isAssisting: assistMutation.isPending
  }
}
