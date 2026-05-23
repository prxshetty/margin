import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Lock } from 'lucide-react'

export default function Styles() {
  const queryClient = useQueryClient()
  const [editingStyle, setEditingStyle] = useState<any>(null)
  
  const { data: styles, isLoading } = useQuery({
    queryKey: ['styles'],
    queryFn: async () => {
      const res = await fetch('http://127.0.0.1:8000/styles/')
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    }
  })

  const saveMutation = useMutation({
    mutationFn: async (style: any) => {
      const isNew = !style.id
      const method = isNew ? 'POST' : 'PUT'
      const url = `http://127.0.0.1:8000/styles/${isNew ? '' : style.id}`
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(style)
      })
      if (!res.ok) throw new Error('Failed to save style')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['styles'] })
      setEditingStyle(null)
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`http://127.0.0.1:8000/styles/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed to delete')
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['styles'] })
      setEditingStyle(null)
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(editingStyle)
  }

  const systemStyles = styles?.filter((s: any) => s.is_system) || []
  const customStyles = styles?.filter((s: any) => !s.is_system) || []

  return (
    <div className="max-w-6xl mx-auto p-8 flex gap-8">
      {/* List */}
      <div className="w-1/3 flex flex-col gap-8">
        <div>
          <Link to="/" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-900">Styles</h1>
            <button 
              onClick={() => setEditingStyle({ name: '', description: '', output_size: 'balanced', agent_sections: { narration: '', dialogue: '', writer: '' } })}
              className="px-3 py-1.5 bg-slate-900 text-white rounded shadow-sm text-sm font-medium hover:bg-slate-800 flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Create New Style
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-slate-500">Loading...</p>
        ) : (
          <>
            <div>
              <h2 className="text-sm font-bold text-slate-400 uppercase tracking-wider mb-3">System Styles (built-in)</h2>
              <div className="flex flex-col gap-2">
                {systemStyles.map((style: any) => (
                  <button
                    key={style.id}
                    onClick={() => setEditingStyle(style)}
                    className={`p-3 text-left rounded-lg border transition-colors flex items-center justify-between ${editingStyle?.id === style.id ? 'border-slate-400 bg-slate-100' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                  >
                    <span className="font-semibold text-slate-700">{style.name}</span>
                    <Lock className="w-4 h-4 text-slate-400" />
                  </button>
                ))}
              </div>
            </div>
            
            <div>
              <h2 className="text-sm font-bold text-blue-500 uppercase tracking-wider mb-3">My Styles (custom)</h2>
              <div className="flex flex-col gap-2">
                {customStyles.length === 0 ? <p className="text-sm text-slate-400 italic">No custom styles yet.</p> : null}
                {customStyles.map((style: any) => (
                  <button
                    key={style.id}
                    onClick={() => setEditingStyle(style)}
                    className={`p-3 text-left rounded-lg border transition-colors flex items-center justify-between ${editingStyle?.id === style.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white hover:border-blue-300'}`}
                  >
                    <span className="font-semibold text-slate-900">{style.name}</span>
                  </button>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {/* Editor */}
      <div className="flex-1">
        {editingStyle ? (
          <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <h2 className="text-xl font-bold flex items-center gap-2">
                {editingStyle.is_system && <Lock className="w-5 h-5 text-slate-400" />}
                {editingStyle.id ? (editingStyle.is_system ? 'View System Style' : 'Edit Custom Style') : 'Create New Style'}
              </h2>
              {editingStyle.id && !editingStyle.is_system && (
                <button type="button" onClick={() => deleteMutation.mutate(editingStyle.id)} className="text-red-500 hover:text-red-700 text-sm font-medium">Delete Style</button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold mb-1">Style Name</label>
                <input 
                  type="text" required disabled={!!editingStyle.id}
                  value={editingStyle.name}
                  onChange={e => setEditingStyle({...editingStyle, name: e.target.value})}
                  className="w-full px-3 py-2 border rounded disabled:bg-slate-50 disabled:text-slate-500"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-1">Output Size</label>
                <select 
                  value={editingStyle.output_size}
                  onChange={e => setEditingStyle({...editingStyle, output_size: e.target.value})}
                  disabled={editingStyle.is_system}
                  className="w-full px-3 py-2 border rounded disabled:bg-slate-50"
                >
                  <option value="concise">Concise</option>
                  <option value="balanced">Balanced</option>
                  <option value="expansive">Expansive</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-semibold mb-1">Description</label>
              <input 
                type="text" required disabled={editingStyle.is_system}
                value={editingStyle.description}
                onChange={e => setEditingStyle({...editingStyle, description: e.target.value})}
                className="w-full px-3 py-2 border rounded disabled:bg-slate-50"
              />
            </div>

            <div className="mt-4">
              <h3 className="font-bold text-slate-900 mb-2">Agent Pipeline</h3>
              <p className="text-sm text-slate-500 mb-4">Each section you fill in activates that agent. Empty = agent won't run.</p>

              <div className="space-y-4">
                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-semibold text-sm">Narration Guidelines</div>
                  <div className="p-4">
                    <textarea 
                      rows={4} disabled={editingStyle.is_system}
                      value={editingStyle.agent_sections?.narration || ''}
                      onChange={e => setEditingStyle({...editingStyle, agent_sections: {...editingStyle.agent_sections, narration: e.target.value}})}
                      placeholder="Guidelines for atmosphere, sensory detail, camera movement..."
                      className="w-full px-3 py-2 border rounded text-sm disabled:bg-slate-50"
                    />
                  </div>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-semibold text-sm">Dialogue Guidelines</div>
                  <div className="p-4">
                    <textarea 
                      rows={4} disabled={editingStyle.is_system}
                      value={editingStyle.agent_sections?.dialogue || ''}
                      onChange={e => setEditingStyle({...editingStyle, agent_sections: {...editingStyle.agent_sections, dialogue: e.target.value}})}
                      placeholder="Guidelines for character voice, subtext..."
                      className="w-full px-3 py-2 border rounded text-sm disabled:bg-slate-50"
                    />
                  </div>
                </div>

                <div className="border border-slate-200 rounded-lg overflow-hidden border-blue-200">
                  <div className="bg-blue-50 px-4 py-2 border-b border-blue-200 font-semibold text-sm text-blue-900">Writer Guidelines (Required)</div>
                  <div className="p-4">
                    <textarea 
                      rows={4} required disabled={editingStyle.is_system}
                      value={editingStyle.agent_sections?.writer || ''}
                      onChange={e => setEditingStyle({...editingStyle, agent_sections: {...editingStyle.agent_sections, writer: e.target.value}})}
                      placeholder="How the writer merges drafts..."
                      className="w-full px-3 py-2 border rounded text-sm disabled:bg-slate-50"
                    />
                  </div>
                </div>
              </div>
            </div>

            {!editingStyle.is_system && (
              <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setEditingStyle(null)} className="px-4 py-2 border rounded font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saveMutation.isPending} className="px-6 py-2 bg-slate-900 text-white rounded font-medium shadow-sm hover:bg-slate-800">
                  Save Style
                </button>
              </div>
            )}
          </form>
        ) : (
          <div className="h-full flex items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50">
            Select a style to view or edit
          </div>
        )}
      </div>
    </div>
  )
}
