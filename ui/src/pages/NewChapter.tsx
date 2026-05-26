import { useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Wand2 } from 'lucide-react'
import { API_BASE } from '../lib/api'

export default function NewChapter() {
  const [title, setTitle] = useState('')
  const [outline, setOutline] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!title.trim() || !outline.trim()) return

    setIsSubmitting(true)
    try {
      const res = await fetch(`${API_BASE}/chapters/`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, raw_outline: outline })
      })
      
      if (!res.ok) throw new Error('Failed to create chapter')
      
      const chapter = await res.json()
      
      // We will soon redirect to generation, but for now just go to workshop
      navigate(`/workshop?chapter=${chapter.id}`)
    } catch (err) {
      console.error(err)
      alert("Error creating chapter")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto p-8">
      <Link to="/" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 mb-8 transition-colors">
        <ArrowLeft className="w-4 h-4 mr-2" />
        Back to projects
      </Link>

      <h1 className="text-3xl font-bold tracking-tight text-slate-900 mb-2">New Chapter</h1>
      <p className="text-slate-500 mb-8">Drop in your rough idea, and the Blueprint agent will structure it.</p>

      <form onSubmit={handleSubmit} className="space-y-6 bg-white p-8 rounded-2xl shadow-sm border border-slate-200">
        <div>
          <label htmlFor="title" className="block text-sm font-semibold text-slate-900 mb-2">
            Chapter Title
          </label>
          <input
            id="title"
            type="text"
            required
            value={title}
            onChange={e => setTitle(e.target.value)}
            className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
            placeholder="e.g., The Shadow of the Spire"
          />
        </div>

        <div>
          <label htmlFor="outline" className="block text-sm font-semibold text-slate-900 mb-2">
            Rough Idea
          </label>
          <textarea
            id="outline"
            required
            rows={8}
            value={outline}
            onChange={e => setOutline(e.target.value)}
            className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-y"
            placeholder="What happens in this chapter? Who is involved? What's the main conflict?"
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !title.trim() || !outline.trim()}
          className="w-full py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-semibold rounded-lg shadow-sm transition-all flex items-center justify-center gap-2"
        >
          {isSubmitting ? (
            'Creating...'
          ) : (
            <>
              Generate Blueprint <Wand2 className="w-4 h-4" />
            </>
          )}
        </button>
      </form>
    </div>
  )
}
