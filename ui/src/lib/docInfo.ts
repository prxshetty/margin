import type { ActiveDoc } from '../stores/projectStore'

export function getDocInfo(
  activeDoc: ActiveDoc,
  activeSceneId?: string | null
): { docType: string; docId: string } {
  if (!activeDoc) return { docType: '', docId: '' }

  switch (activeDoc.type) {
    case 'scene':
      return { docType: 'scene', docId: activeSceneId || activeDoc.sceneId || '' }
    case 'character':
      return { docType: 'character', docId: activeDoc.slug || '' }
    default:
      return { docType: activeDoc.type, docId: activeDoc.id || '' }
  }
}

export function getDocPath(
  activeDoc: ActiveDoc,
  activeSceneId?: string | null,
  chapterId?: string | null
): string {
  if (!activeDoc) return ''

  switch (activeDoc.type) {
    case 'scene':
      return `scenes/${activeSceneId || activeDoc.sceneId}`
    case 'character':
      return `characters/${activeDoc.slug}`
    case 'style':
      return `styles/${activeDoc.id}`
    case 'blueprint':
      return `chapters/${chapterId || activeDoc.id}/blueprint`
    case 'outline':
      return `chapters/${chapterId || activeDoc.id}/outline`
    case 'chapter':
      return `chapters/${chapterId || activeDoc.id}/chapter`
    default:
      return ''
  }
}
