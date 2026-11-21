import { apiCall, readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { raiseCrudError } from '@open-mercato/ui/backend/utils/serverErrors'

export const API_BASE = '/api/public_info_requests'

export async function getJson<T>(path: string): Promise<T> {
  return readApiResultOrThrow<T>(`${API_BASE}${path}`)
}

export async function postJson<T = Record<string, unknown>>(path: string, body: unknown, method = 'POST'): Promise<T> {
  const response = await apiCall<T>(`${API_BASE}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
  if (!response.ok) await raiseCrudError(response.response)
  return (response.result ?? ({} as T)) as T
}

export type AssigneeOption = { id: string; name: string; initials: string }
export type AssigneesResponse = { items: AssigneeOption[]; currentUserId: string | null }

export const UNASSIGNED_VALUE = '__unassigned__'

export async function caseAction<T = Record<string, unknown>>(requestId: string, action: string, body: unknown = {}): Promise<T> {
  return postJson<T>(`/requests/${requestId}/${action}`, body)
}

export async function uploadDocument(file: File, requestId: string, kind: 'request' | 'reply' | 'clarification' | 'other', departmentQueryId?: string | null) {
  const form = new FormData()
  form.set('file', file)
  form.set('requestId', requestId)
  form.set('kind', kind)
  if (departmentQueryId) form.set('departmentQueryId', departmentQueryId)
  const response = await apiCall<UploadedDocument>(`${API_BASE}/documents`, { method: 'POST', body: form })
  if (!response.ok) await raiseCrudError(response.response)
  return response.result as UploadedDocument
}

export async function deleteDocument(documentId: string): Promise<void> {
  const response = await apiCall<{ ok: boolean }>(`${API_BASE}/documents?id=${encodeURIComponent(documentId)}`, { method: 'DELETE' })
  if (!response.ok) await raiseCrudError(response.response)
}

export async function downloadFile(
  path: string,
  fallbackName: string,
  options: { onLoadingChange?: (loading: boolean) => void } = {},
): Promise<void> {
  options.onLoadingChange?.(true)
  try {
    const response = await apiCall<null>(`${API_BASE}${path}`, { method: 'GET' }, { parse: async () => null })
    if (!response.ok) await raiseCrudError(response.response)
    const blob = await response.response.blob()
    const disposition = response.response.headers.get('content-disposition') ?? ''
    const match = /filename="([^"]+)"/.exec(disposition)
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = match?.[1] ?? fallbackName
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  } finally {
    options.onLoadingChange?.(false)
  }
}

export type UploadedDocument = {
  id: string
  requestId: string
  attachmentId: string | null
  kind: string
  fileName: string
  textSource: string
  ocrConfidence: number | null
  extractedText: string | null
}

export type DeadlineTone = 'overdue' | 'today' | 'tomorrow' | 'paused' | 'normal' | 'done'

export type RequestListItem = {
  id: string
  caseNumber: string
  caseSeq: number
  requesterName: string | null
  subjectSummary: string
  receivedAt: string | null
  currentDueDate: string | null
  statutoryDueDate: string | null
  dueShiftedFrom: string | null
  respondedAt: string | null
  status: string
  daysRemaining: number | null
  deadlineTone: DeadlineTone
  assigneeInitials: string | null
  assigneeName: string | null
  extendedAt: string | null
  clarificationDueDate: string | null
  source: string
  updatedAt: string | null
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const [year, month, day] = value.slice(0, 10).split('-')
  return year && month && day ? `${day}.${month}.${year}` : value
}

export function todayIsoLocal(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}
