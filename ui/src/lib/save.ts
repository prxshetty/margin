import type { ActiveDoc } from '../stores/projectStore'
import { API_BASE } from './api'

export interface SaveTarget {
  url: string
  body: Record<string, unknown>
}

export function getSaveEndpoint(
  doc: ActiveDoc,
  chapterId: string | null,
  mode?: string,
  beatIndex?: number
): SaveTarget | null {
  if (!doc) return null

  if (doc.type === 'scene') {
    if (mode === 'content') {
      return { url: `${API_BASE}/scenes/${doc.sceneId}/content`, body: { content: '' } }
    } else if (mode === 'beats' && beatIndex !== undefined) {
      return { url: `${API_BASE}/scenes/${doc.sceneId}/beats/${beatIndex + 1}`, body: { beat: '' } }
    }
    return null
  }

  if (doc.type === 'character') {
    return { url: `${API_BASE}/characters/${doc.slug}/content`, body: { content: '' } }
  }

  if (doc.type === 'style') {
    return { url: `${API_BASE}/styles/${doc.id}/content`, body: { content: '' } }
  }

  if (doc.type === 'outline') {
    return { url: `${API_BASE}/chapters/${chapterId}/content`, body: { content: '' } }
  }

  if (doc.type === 'blueprint') {
    return { url: `${API_BASE}/chapters/${chapterId}/blueprint/markdown`, body: { content: '' } }
  }

  return null
}
