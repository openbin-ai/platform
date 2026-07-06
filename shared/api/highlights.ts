// Highlights board (evidence board) types shared by openapk-frontend and
// openbin-frontend. Mirrors ai.openapk.core.highlights.dto.{HighlightResponse,
// CreateHighlightRequest, UpdateHighlightRequest}; keep field names byte-equal.

export type HighlightType = 'FUNCTION' | 'FILE' | 'VISUAL'

/** One Highlights-board card (GET /api/projects/{id}/highlights). */
export type Highlight = {
  id: string
  type: HighlightType
  /** function name/addr or file path; null for VISUAL. */
  targetRef: string | null
  /** shared media filename (annotated screenshot); null if text-only. */
  mediaKey: string | null
  tag: string | null
  note: string | null
  position: number
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

export type CreateHighlightRequest = {
  type: HighlightType
  targetRef?: string | null
  mediaKey?: string | null
  tag?: string | null
  note?: string | null
}

export type UpdateHighlightRequest = {
  tag?: string | null
  note?: string | null
  position?: number | null
}

/** Human label + accent per anchor type, for chips/badges. */
export const HIGHLIGHT_TYPE_META: Record<
  HighlightType,
  { label: string; icon: string; accent: string }
> = {
  FUNCTION: { label: 'Function', icon: 'ƒ', accent: 'text-purple-300 border-purple-700/60 bg-purple-950/30' },
  FILE: { label: 'File', icon: '📄', accent: 'text-sky-300 border-sky-700/60 bg-sky-950/30' },
  VISUAL: { label: 'Visual', icon: '🖼', accent: 'text-amber-300 border-amber-700/60 bg-amber-950/30' },
}

/**
 * Pull the stored media key (filename) out of a media URL like
 * "/api/projects/<id>/media/<uuid>.png" — that key is what
 * CreateHighlightRequest.mediaKey and GET .../media/{name} expect. Strips any
 * query string. Returns null when the URL has no usable trailing segment.
 */
export function mediaKeyFromUrl(url: string): string | null {
  const seg = url.split('?')[0].split('/').filter(Boolean).pop()
  return seg && seg.length > 0 ? seg : null
}

/** Build the authenticated media URL for a stored highlight media key. */
export function mediaUrl(projectId: string, mediaKey: string): string {
  return `/api/projects/${projectId}/media/${mediaKey}`
}
