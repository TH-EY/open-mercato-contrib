"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Checkbox } from '@open-mercato/ui/primitives/checkbox'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Copy } from 'lucide-react'
import { getJson, todayIsoLocal } from '../api'
import type { CaseDetail } from './types'

type Proposal = {
  departmentId: string
  departmentName: string
  departmentKind: string
  pointPositions: number[]
  scopeText: string
  confidence: number
  sources: Array<{ kind: string; ref: string; label: string }>
  internalDueDate: string | null
}

type Suggestion = { proposals: Proposal[]; flags: Array<{ kind: string; message: string; departmentId?: string }>; generatedBy: 'ai' | 'keywords' }

type Note = { queryId: string; departmentName: string; contactHint: string | null; subject: string; bodyText: string; sentAt: string | null }

type Props = {
  detail: CaseDetail
  run: (action: string, payload?: Record<string, unknown>, successMessage?: string) => Promise<unknown>
  pending: string | null
}

export default function RoutingPanel({ detail, run, pending }: Props) {
  const t = useT()
  const requestId = detail.request.id
  const [suggestion, setSuggestion] = React.useState<Suggestion | null>(null)
  const [selected, setSelected] = React.useState<Record<string, boolean>>({})
  const [scopes, setScopes] = React.useState<Record<string, string>>({})
  const [loading, setLoading] = React.useState(false)
  const [notes, setNotes] = React.useState<Note[] | null>(null)
  const [sentAt, setSentAt] = React.useState(todayIsoLocal())
  const hasQueries = detail.queries.length > 0

  const loadSuggestion = React.useCallback(async () => {
    setLoading(true)
    try {
      const result = await getJson<Suggestion>(`/requests/${requestId}/routing-suggest`)
      setSuggestion(result)
      setSelected(Object.fromEntries(result.proposals.map((proposal) => [proposal.departmentId, proposal.confidence >= 0.25])))
      setScopes(Object.fromEntries(result.proposals.map((proposal) => [proposal.departmentId, proposal.scopeText])))
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setLoading(false)
    }
  }, [requestId])

  const loadNotes = React.useCallback(async () => {
    const result = await getJson<{ notes: Note[] }>(`/requests/${requestId}/routing-notes`)
    setNotes(result.notes)
  }, [requestId])

  React.useEffect(() => {
    if (hasQueries) void loadNotes()
    else void loadSuggestion()
  }, [hasQueries, loadNotes, loadSuggestion, detail.queries.length])

  const accept = async () => {
    if (!suggestion) return
    const queries = suggestion.proposals
      .filter((proposal) => selected[proposal.departmentId])
      .map((proposal) => ({
        departmentId: proposal.departmentId,
        pointPositions: proposal.pointPositions,
        scopeText: scopes[proposal.departmentId] ?? proposal.scopeText,
        internalDueDate: proposal.internalDueDate,
        confidence: proposal.confidence,
        sources: proposal.sources,
      }))
    if (queries.length === 0) {
      flash(t('public_info_requests.routing.noneSelected', 'Select at least one department.'), 'error')
      return
    }
    await run('routing-accept', { queries }, t('public_info_requests.routing.accepted', 'Routing accepted — notes are ready to copy.'))
  }

  const copy = async (note: Note) => {
    await navigator.clipboard.writeText(`${note.subject}\n\n${note.bodyText}`)
    flash(t('public_info_requests.routing.copied', 'Note copied to clipboard.'), 'success')
  }

  if (hasQueries) {
    const unsent = detail.queries.filter((query) => !query.sentAt)
    return (
      <div className="space-y-4" data-testid="udip-routing-notes">
        <Alert status="information">
          <AlertDescription>{t('public_info_requests.routing.noSend', 'The system never sends anything. Copy each note into your own mailbox, send it, then record the date below.')}</AlertDescription>
        </Alert>
        {!notes ? <LoadingMessage label={t('public_info_requests.common.loading', 'Loading…')} /> : notes.map((note) => (
          <div key={note.queryId} className="space-y-2 rounded-lg border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="font-medium">{note.departmentName}</div>
              <div className="flex items-center gap-2">
                {note.sentAt ? <StatusBadge variant="success">{t('public_info_requests.routing.sentOn', 'sent')} {note.sentAt}</StatusBadge> : <StatusBadge variant="warning">{t('public_info_requests.routing.notSent', 'not sent yet')}</StatusBadge>}
                <Button type="button" variant="outline" size="sm" onClick={() => { void copy(note) }}><Copy className="size-4" />{t('public_info_requests.routing.copy', 'Copy text')}</Button>
              </div>
            </div>
            {note.contactHint ? <div className="text-xs text-muted-foreground">{note.contactHint}</div> : null}
            <div className="text-sm font-medium">{note.subject}</div>
            <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">{note.bodyText}</pre>
          </div>
        ))}
        {unsent.length > 0 ? (
          <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
            <div className="space-y-1">
              <Label htmlFor="udip-sent-at">{t('public_info_requests.routing.sentDate', 'Sent on')}</Label>
              <Input id="udip-sent-at" type="date" value={sentAt} onChange={(event) => setSentAt(event.target.value)} />
            </div>
            <Button type="button" disabled={pending === 'notes-mark-sent'} onClick={() => { void run('notes-mark-sent', { ids: unsent.map((query) => query.id), sentAt }, t('public_info_requests.routing.markedSent', 'Recorded as sent.')) }}>
              {t('public_info_requests.routing.markSent', 'Mark notes as sent')} ({unsent.length})
            </Button>
          </div>
        ) : null}
      </div>
    )
  }

  if (loading || !suggestion) return <LoadingMessage label={t('public_info_requests.routing.loading', 'Preparing the routing proposal…')} />

  return (
    <div className="space-y-4" data-testid="udip-routing">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm text-muted-foreground">
          {suggestion.generatedBy === 'ai' ? t('public_info_requests.routing.byAi', 'Proposal by the assistant (local model).') : t('public_info_requests.routing.byKeywords', 'Proposal from department scopes, keywords and similar cases.')}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={() => { void loadSuggestion() }}>{t('public_info_requests.routing.regenerate', 'Regenerate')}</Button>
      </div>
      {suggestion.flags.map((flag, index) => (
        <Alert key={index} status={flag.kind === 'separate_entity' ? 'warning' : 'information'}>
          <AlertTitle>{t(`public_info_requests.routing.flag.${flag.kind}`, flag.kind)}</AlertTitle>
          <AlertDescription>{flag.message}</AlertDescription>
        </Alert>
      ))}
      {suggestion.proposals.length === 0 ? <p className="text-sm text-muted-foreground">{t('public_info_requests.routing.empty', 'No department matched — add the routing manually in the departments list.')}</p> : null}
      {suggestion.proposals.map((proposal) => (
        <div key={proposal.departmentId} className={`space-y-2 rounded-lg border bg-card p-4 ${selected[proposal.departmentId] ? '' : 'opacity-70'}`} data-testid="udip-routing-proposal">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label className="flex items-center gap-2 font-medium">
              <Checkbox checked={Boolean(selected[proposal.departmentId])} onCheckedChange={(value) => setSelected((current) => ({ ...current, [proposal.departmentId]: value === true }))} />
              {proposal.departmentName}
              {proposal.departmentKind === 'municipal_unit' || proposal.departmentKind === 'external' ? <StatusBadge variant="warning">{t(`public_info_requests.departmentKind.${proposal.departmentKind}`, proposal.departmentKind)}</StatusBadge> : null}
            </label>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{t('public_info_requests.routing.questions', 'Questions')}: {proposal.pointPositions.join(', ')}</span>
              <StatusBadge variant={proposal.confidence >= 0.6 ? 'success' : proposal.confidence >= 0.35 ? 'warning' : 'neutral'}>{Math.round(proposal.confidence * 100)}%</StatusBadge>
            </div>
          </div>
          <Textarea rows={3} value={scopes[proposal.departmentId] ?? ''} onChange={(event) => setScopes((current) => ({ ...current, [proposal.departmentId]: event.target.value }))} />
          <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
            <span>{t('public_info_requests.routing.why', 'Why')}:</span>
            {proposal.sources.map((source, index) => <span key={index} className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono">{source.label}</span>)}
            {proposal.internalDueDate ? <span>· {t('public_info_requests.routing.internalDue', 'department deadline')} {proposal.internalDueDate}</span> : null}
          </div>
        </div>
      ))}
      <div className="flex justify-end">
        <Button type="button" disabled={pending === 'routing-accept'} onClick={() => { void accept() }}>
          {pending === 'routing-accept' ? <Spinner size="sm" /> : null}{t('public_info_requests.routing.accept', 'Accept and prepare notes')}
        </Button>
      </div>
    </div>
  )
}
