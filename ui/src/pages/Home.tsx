import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { BookPlus, Layout, Trash2 } from 'lucide-react'

interface Chapter {
  id: string
  title: string
  created_at: string
}

export default function Home() {
  const queryClient = useQueryClient()

  const { data: chapters, isLoading } = useQuery({
    queryKey: ['chapters'],
    queryFn: async () => {
      const res = await fetch('http://127.0.0.1:8000/chapters/')
      if (!res.ok) throw new Error('Failed to fetch chapters')
      return res.json() as Promise<Chapter[]>
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (chapterId: string) => {
      const res = await fetch(`http://127.0.0.1:8000/chapters/${chapterId}`, {
        method: 'DELETE'
      })
      if (!res.ok) throw new Error('Failed to delete chapter')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chapters'] })
    }
  })

  return (
    <div className="max-w-4xl mx-auto p-8">
      <header className="flex justify-between items-center mb-12">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
          <Layout className="w-8 h-8 text-blue-600" />
          SLM Writing Engine
        </h1>
        <div className="flex gap-4">
          <Link to="/characters" className="text-slate-600 hover:text-slate-900 font-medium">Characters</Link>
          <Link to="/styles" className="text-slate-600 hover:text-slate-900 font-medium">Styles</Link>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Link 
          to="/new"
          className="border-2 border-dashed border-slate-300 rounded-xl p-8 flex flex-col items-center justify-center text-slate-500 hover:border-blue-500 hover:text-blue-600 transition-colors h-48 bg-slate-50/50 hover:bg-blue-50/50"
        >
          <BookPlus className="w-12 h-12 mb-4" />
          <span className="font-semibold text-lg">Create New Chapter</span>
        </Link>

        {isLoading ? (
          <div className="border border-slate-200 rounded-xl p-8 flex items-center justify-center h-48 bg-white shadow-sm">
            <span className="text-slate-400">Loading chapters...</span>
          </div>
        ) : (
          chapters?.map(chapter => (
            <div
              key={chapter.id}
              className="border border-slate-200 rounded-xl p-8 flex flex-col justify-between bg-white shadow-sm hover:shadow-md transition-shadow hover:border-blue-300 h-48 group relative"
            >
              <Link to={`/workshop?chapter=${chapter.id}`} className="flex-1">
                <h2 className="text-xl font-semibold text-slate-900 group-hover:text-blue-600 mb-2">{chapter.title}</h2>
                <p className="text-slate-500 text-sm">Created {new Date(chapter.created_at).toLocaleDateString()}</p>
              </Link>

              <button
                onClick={(e) => {
                  e.preventDefault()
                  if (confirm(`Delete "${chapter.title}"? This will also remove all blueprint, acts and scenes.`)) {
                    deleteMutation.mutate(chapter.id)
                  }
                }}
                className="absolute top-4 right-4 p-1.5 text-slate-300 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors opacity-0 group-hover:opacity-100"
                title="Delete chapter"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
