import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, User, HelpCircle } from 'lucide-react'

export default function Characters() {
  const queryClient = useQueryClient()
  const [editingChar, setEditingChar] = useState<any>(null)
  const [viewMode, setViewMode] = useState<'form' | 'json'>('form')
  
  const { data: characters, isLoading } = useQuery({
    queryKey: ['characters'],
    queryFn: async () => {
      const res = await fetch('http://127.0.0.1:8000/characters/')
      if (!res.ok) throw new Error('Failed to fetch')
      return res.json()
    }
  })

  const saveMutation = useMutation({
    mutationFn: async (char: any) => {
      const isNew = !char.id
      const method = isNew ? 'POST' : 'PUT'
      const url = `http://127.0.0.1:8000/characters/${isNew ? '' : char.slug}`
      
      // Ensure data is structured correctly before saving
      let finalData = char.data
      if (viewMode === 'form' && typeof char.data !== 'string') {
        finalData = {
          description: char.data.description || '',
          traits: typeof char.data.traits === 'string' 
            ? char.data.traits.split(',').map((s: string) => s.trim()).filter(Boolean)
            : (char.data.traits || []),
          goals: typeof char.data.goals === 'string'
            ? char.data.goals.split('\n').map((s: string) => s.trim()).filter(Boolean)
            : (char.data.goals || []),
          flaws: typeof char.data.flaws === 'string'
            ? char.data.flaws.split('\n').map((s: string) => s.trim()).filter(Boolean)
            : (char.data.flaws || []),
          current_state: char.data.current_state || ''
        }
      } else if (typeof char.data === 'string') {
        try {
          finalData = JSON.parse(char.data)
        } catch (e) {
          throw new Error('Invalid JSON data format')
        }
      }

      const payload = {
        ...char,
        data: finalData
      }
      
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      if (!res.ok) throw new Error('Failed to save character')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['characters'] })
      setEditingChar(null)
    }
  })

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    saveMutation.mutate(editingChar)
  }

  const handleSelectCharacter = (char: any) => {
    // Standardize object structure for editing
    const rawData = char.data || {}
    setEditingChar({
      ...char,
      data: {
        description: rawData.description || '',
        traits: Array.isArray(rawData.traits) ? rawData.traits.join(', ') : (rawData.traits || ''),
        goals: Array.isArray(rawData.goals) ? rawData.goals.join('\n') : (rawData.goals || ''),
        flaws: Array.isArray(rawData.flaws) ? rawData.flaws.join('\n') : (rawData.flaws || ''),
        current_state: rawData.current_state || ''
      }
    })
    setViewMode('form')
  }

  const handleCreateNew = () => {
    setEditingChar({
      name: '',
      slug: '',
      data: {
        description: '',
        traits: '',
        goals: '',
        flaws: '',
        current_state: ''
      }
    })
    setViewMode('form')
  }

  return (
    <div className="max-w-6xl mx-auto p-8 flex gap-8">
      {/* Sidebar List */}
      <div className="w-1/3 flex flex-col gap-6">
        <div>
          <Link to="/" className="inline-flex items-center text-sm font-medium text-slate-500 hover:text-slate-900 mb-6 transition-colors">
            <ArrowLeft className="w-4 h-4 mr-2" /> Back to Dashboard
          </Link>
          <div className="flex items-center justify-between">
            <h1 className="text-2xl font-bold text-slate-900">Characters</h1>
            <button 
              onClick={handleCreateNew}
              className="px-3 py-1.5 bg-blue-600 text-white rounded shadow-sm text-sm font-medium hover:bg-blue-700 flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-4 h-4" /> Add Character
            </button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-slate-500 text-sm">Loading characters...</p>
        ) : (
          <div className="flex flex-col gap-2">
            {characters?.length === 0 && (
              <p className="text-sm text-slate-400 italic">No characters added yet.</p>
            )}
            {characters?.map((char: any) => (
              <button
                key={char.id}
                onClick={() => handleSelectCharacter(char)}
                className={`p-4 text-left rounded-lg border transition-all duration-200 flex items-center gap-3 ${editingChar?.id === char.id ? 'border-blue-500 bg-blue-50/50 shadow-sm' : 'border-slate-200 bg-white hover:border-blue-300'}`}
              >
                <div className="p-2 bg-slate-100 rounded-md text-slate-500">
                  <User className="w-5 h-5" />
                </div>
                <div className="truncate">
                  <div className="font-semibold text-slate-950">{char.name}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">@{char.slug}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Main Editing Panel */}
      <div className="flex-1">
        {editingChar ? (
          <form onSubmit={handleSubmit} className="bg-white p-8 rounded-xl border border-slate-200 shadow-sm flex flex-col gap-6">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div>
                <h2 className="text-xl font-bold text-slate-900">{editingChar.id ? 'Edit Character Profile' : 'Create Character Profile'}</h2>
                <p className="text-xs text-slate-400 mt-1">Configure character metadata used in generation prompts.</p>
              </div>
              <div className="flex border border-slate-200 rounded-lg p-0.5 bg-slate-50">
                <button
                  type="button"
                  onClick={() => setViewMode('form')}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${viewMode === 'form' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-950'}`}
                >
                  Form
                </button>
                <button
                  type="button"
                  onClick={() => {
                    // Convert form data to raw JSON string for view
                    if (viewMode === 'form') {
                      const finalData = {
                        description: editingChar.data.description || '',
                        traits: typeof editingChar.data.traits === 'string'
                          ? editingChar.data.traits.split(',').map((s: string) => s.trim()).filter(Boolean)
                          : (editingChar.data.traits || []),
                        goals: typeof editingChar.data.goals === 'string'
                          ? editingChar.data.goals.split('\n').map((s: string) => s.trim()).filter(Boolean)
                          : (editingChar.data.goals || []),
                        flaws: typeof editingChar.data.flaws === 'string'
                          ? editingChar.data.flaws.split('\n').map((s: string) => s.trim()).filter(Boolean)
                          : (editingChar.data.flaws || []),
                        current_state: editingChar.data.current_state || ''
                      }
                      setEditingChar({ ...editingChar, data: JSON.stringify(finalData, null, 2) })
                    }
                    setViewMode('json')
                  }}
                  className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${viewMode === 'json' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-950'}`}
                >
                  JSON Source
                </button>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Full Name</label>
                <input 
                  type="text" required
                  placeholder="e.g., Elara Vance"
                  value={editingChar.name}
                  onChange={e => {
                    const name = e.target.value
                    const newState = { ...editingChar, name }
                    if (!editingChar.id) {
                      const firstWord = name.trim().split(' ')[0] || ''
                      newState.slug = firstWord.toLowerCase().replace(/[^a-z0-9_-]/g, '')
                    }
                    setEditingChar(newState)
                  }}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                />
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <label className="block text-sm font-semibold text-slate-700">Filename Slug</label>
                  <div className="group relative">
                    <HelpCircle className="w-4 h-4 text-slate-400 cursor-help" />
                    <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 w-64 bg-slate-900 text-white text-xs rounded p-2 opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity leading-relaxed z-50">
                      The lowercase reference key matching legacy yaml files (e.g. "elara" for elara.yaml). Prompts use this slug to reference the character.
                    </div>
                  </div>
                </div>
                <input 
                  type="text" required disabled={!!editingChar.id}
                  placeholder="e.g., elara"
                  value={editingChar.slug}
                  onChange={e => setEditingChar({...editingChar, slug: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '')})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none disabled:bg-slate-50 disabled:text-slate-400 font-mono text-sm"
                />
              </div>
            </div>

            {viewMode === 'form' ? (
              <div className="flex flex-col gap-5">
                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Description</label>
                  <textarea 
                    rows={3}
                    placeholder="Provide a general summary of the character personality and archetype..."
                    value={editingChar.data.description || ''}
                    onChange={e => setEditingChar({...editingChar, data: {...editingChar.data, description: e.target.value}})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm leading-relaxed"
                  />
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Traits <span className="text-xs font-normal text-slate-400">(Comma separated)</span></label>
                  <input 
                    type="text"
                    placeholder="e.g., Intense, Guarded, Observant, Passionate"
                    value={editingChar.data.traits || ''}
                    onChange={e => setEditingChar({...editingChar, data: {...editingChar.data, traits: e.target.value}})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Goals <span className="text-xs font-normal text-slate-400">(One per line)</span></label>
                    <textarea 
                      rows={4}
                      placeholder="e.g.&#10;Achieve artistic recognition&#10;Maintain emotional control"
                      value={editingChar.data.goals || ''}
                      onChange={e => setEditingChar({...editingChar, data: {...editingChar.data, goals: e.target.value}})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm leading-relaxed"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-slate-700 mb-1">Flaws <span className="text-xs font-normal text-slate-400">(One per line)</span></label>
                    <textarea 
                      rows={4}
                      placeholder="e.g.&#10;Prone to self-sabotage&#10;Inability to accept help"
                      value={editingChar.data.flaws || ''}
                      onChange={e => setEditingChar({...editingChar, data: {...editingChar.data, flaws: e.target.value}})}
                      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm leading-relaxed"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-semibold text-slate-700 mb-1">Current State</label>
                  <textarea 
                    rows={2}
                    placeholder="Describe their situation at the start of the chapter..."
                    value={editingChar.data.current_state || ''}
                    onChange={e => setEditingChar({...editingChar, data: {...editingChar.data, current_state: e.target.value}})}
                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none text-sm leading-relaxed"
                  />
                </div>
              </div>
            ) : (
              <div>
                <label className="block text-sm font-semibold text-slate-700 mb-1">Raw JSON Schema</label>
                <textarea 
                  rows={14}
                  value={editingChar.data}
                  onChange={e => setEditingChar({...editingChar, data: e.target.value})}
                  className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none font-mono text-sm leading-relaxed"
                />
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4 pt-4 border-t border-slate-100">
              <button type="button" onClick={() => setEditingChar(null)} className="px-4 py-2 border border-slate-200 rounded-lg font-medium hover:bg-slate-50 transition-colors">Cancel</button>
              <button type="submit" disabled={saveMutation.isPending} className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium shadow-sm transition-colors">
                {saveMutation.isPending ? 'Saving...' : 'Save Profile'}
              </button>
            </div>
          </form>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 border-2 border-dashed border-slate-200 rounded-xl bg-slate-50/50 p-12 text-center min-h-[450px]">
            <User className="w-12 h-12 text-slate-300 mb-3" />
            <h3 className="font-semibold text-slate-700">Select or Create a Character</h3>
            <p className="text-sm text-slate-500 max-w-sm mt-1">Choose an existing profile from the sidebar to view traits, or create a new character to expand your story universe.</p>
          </div>
        )}
      </div>
    </div>
  )
}
