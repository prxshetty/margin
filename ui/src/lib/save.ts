import type { ActiveDoc } from '../stores/projectStore'
import { API_BASE } from './api'

export interface SaveTarget {
  url: string
  bodyKey: string
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
      return { url: `${API_BASE}/scenes/${doc.sceneId}/content`, bodyKey: 'content' }
    } else if (mode === 'beats' && beatIndex !== undefined) {
      return { url: `${API_BASE}/scenes/${doc.sceneId}/beats/${beatIndex + 1}`, bodyKey: 'beat' }
    }
    return null
  }

  if (doc.type === 'character') {
    return { url: `${API_BASE}/characters/${doc.slug}/content`, bodyKey: 'content' }
  }

  if (doc.type === 'style') {
    return { url: `${API_BASE}/styles/${doc.id}/content`, bodyKey: 'content' }
  }

  if (doc.type === 'outline') {
    return { url: `${API_BASE}/chapters/${chapterId}/content`, bodyKey: 'content' }
  }

  if (doc.type === 'blueprint') {
    return { url: `${API_BASE}/chapters/${chapterId}/blueprint/markdown`, bodyKey: 'content' }
  }

  return null
}
