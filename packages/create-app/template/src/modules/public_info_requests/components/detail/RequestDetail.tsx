"use client"
import * as React from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Archive, ArchiveRestore, ChevronLeft, Clock, PauseCircle, Send } from 'lucide-react'
import { formatDate, getJson, todayIsoLocal, UNASSIGNED_VALUE, type AssigneesResponse } from '../api'
import { STATUS_FALLBACK, STATUS_VARIANT, TONE_VARIANT } from '../labels'
import { useCaseMutation } from './useCaseMutation'
import RoutingPanel from './RoutingPanel'
import RepliesPanel from './RepliesPanel'
import DraftPanel from './DraftPanel'
import type { CaseDetail } from './types'

type DialogKind = 'extend' | 'clarification' | 'clarificationReply' | 'markSent' | 'archive' | null

const STATUS_TRACK = ['new', 'sent_to_departments', 'in_preparation', 'prepared', 'sent'] as const

export default function RequestDetail({ id }: { id: string }) {
  const t = useT()
  const searchParams = useSearchParams()
  const [detail, setDetail] = React.useState<CaseDetail | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [tab, setTab] = React.useState<string>(searchParams?.get('tab') ?? 'overview')
  const [dialog, setDialog] = React.useState<DialogKind>(null)
  const [form, setForm] = React.useState<Record<string, string>>({})
  const [archive, setArchive] = React.useState(true)

  const load = React.useCallback(async () => {
    try {
      setDetail(await getJson<CaseDetail>(`/requests/${id}/detail`))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [id])

  React.useEffect(() => { void load() }, [load])
  const { run, pending } = useCaseMutation(id, load, detail?.request.updatedAt)
  const [assignees, setAssignees] = React.useState<AssigneesResponse>({ items: [], currentUserId: null })

  React.useEffect(() => {
    let cancelled = false
    getJson<AssigneesResponse>('/assignees')
      .then((response) => { if (!cancelled) setAssignees(response) })
      .catch(() => { if (!cancelled) setAssignees({ items: [], currentUserId: null }) })
    return () => { cancelled = true }
  }, [])

  if (error) return <ErrorMessage label={error} />
  if (!detail) return <LoadingMessage label={t('public_info_requests.common.loading', 'Loading…')} />

  const request = detail.request
  const archived = request.status === 'archived'
  const closed = request.status === 'sent' || request.status === 'left_unprocessed' || archived
  const archiveEvent = archived ? detail.events.find((event) => event.kind === 'archived') ?? null : null
  const archiveReason = archiveEvent?.payload && typeof archiveEvent.payload.reason === 'string' ? archiveEvent.payload.reason : null
  const latestDraft = detail.drafts[0] ?? null
  const latestDraftPrepared = latestDraft?.status === 'ready' || latestDraft?.status === 'exported'

  const openDialog = (kind: DialogKind) => {
    const today = todayIsoLocal()
    if (kind === 'extend') setForm({ newDueDate: request.maxExtensionDate, reason: 'Konieczność przeprowadzenia całościowej kwerendy' })
    if (kind === 'clarification') setForm({ sentAt: today, deliveredAt: today })
    if (kind === 'clarificationReply') setForm({ receivedAt: today })
    if (kind === 'markSent') setForm({ respondedAt: today, channel: request.deliveryForm === 'post' ? 'post' : 'email' })
    if (kind === 'archive') setForm({ reason: '' })
    setDialog(kind)
  }

  const submitDialog = async () => {
    let result: unknown = null
    if (dialog === 'extend') result = await run('extend', { newDueDate: form.newDueDate, reason: form.reason }, t('public_info_requests.actions.extended', 'Deadline extended — generate the extension notice in the Draft tab.'))
    if (dialog === 'clarification') result = await run('request-clarification', { sentAt: form.sentAt, deliveredAt: form.deliveredAt || null }, t('public_info_requests.actions.clarificationRequested', 'Clock paused until the requester clarifies.'))
    if (dialog === 'clarificationReply') result = await run('register-clarification', { receivedAt: form.receivedAt }, t('public_info_requests.actions.clarificationReceived', 'Clarification registered — new deadline set.'))
    if (dialog === 'markSent') result = await run('mark-sent', { respondedAt: form.respondedAt, channel: form.channel, addToArchive: archive, draftId: latestDraft?.id }, t('public_info_requests.actions.markedSent', 'Answer recorded as sent and added to the archive.'))
    if (dialog === 'archive') {
      if (!form.reason?.trim()) {
        flash(t('public_info_requests.actions.archiveReasonRequired', 'Give the reason for archiving.'), 'error')
        return
      }
      result = await run('archive', { reason: form.reason.trim() }, t('public_info_requests.actions.archived', 'Request archived — it is no longer used for matching or search.'))
    }
    if (result) setDialog(null)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void submitDialog()
    }
  }

  const statusIndex = STATUS_TRACK.indexOf(request.status as (typeof STATUS_TRACK)[number])

  return (
    <div className="space-y-5" data-testid="udip-detail">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <Link href="/backend/public_info_requests" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ChevronLeft className="size-4" />{t('public_info_requests.detail.back', 'Calendar')}</Link>
          <h1 className="text-xl font-semibold sm:text-2xl"><span className="font-mono">{request.caseNumber}</span> — {request.subjectSummary}</h1>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge variant={STATUS_VARIANT[request.status] ?? 'neutral'} dot>{t(`public_info_requests.status.${request.status}`, STATUS_FALLBACK[request.status] ?? request.status)}</StatusBadge>
            {request.source === 'import' ? <StatusBadge variant="neutral">{t('public_info_requests.detail.archived', 'knowledge base')}</StatusBadge> : null}
          </div>
        </div>
        {!closed && request.source !== 'import' ? (
          <div className="flex flex-wrap gap-2">
            {request.status === 'awaiting_clarification' ? (
              <Button type="button" variant="outline" onClick={() => openDialog('clarificationReply')}>{t('public_info_requests.actions.registerClarification', 'Register clarification')}</Button>
            ) : (
              <Button type="button" variant="outline" onClick={() => openDialog('clarification')}><PauseCircle className="size-4" />{t('public_info_requests.actions.requestClarification', 'Request clarification')}</Button>
            )}
            <Button type="button" variant="outline" disabled={request.status === 'extended' || request.status === 'awaiting_clarification'} onClick={() => openDialog('extend')}><Clock className="size-4" />{t('public_info_requests.actions.extend', 'Extend deadline')}</Button>
            <Button type="button" disabled={!latestDraftPrepared} title={latestDraftPrepared ? undefined : t('public_info_requests.export.needsPrepared', 'Run the personal data check and mark the draft as prepared to export it.')} onClick={() => openDialog('markSent')}><Send className="size-4" />{t('public_info_requests.actions.markSent', 'Record as sent')}</Button>
            <Button type="button" variant="ghost" onClick={() => openDialog('archive')}><Archive className="size-4" />{t('public_info_requests.actions.archive', 'Archive')}</Button>
          </div>
        ) : null}
        {archived ? (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={pending === 'restore'} onClick={() => { void run('restore', {}, t('public_info_requests.actions.restored', 'Request restored.')) }}>
              <ArchiveRestore className="size-4" />{t('public_info_requests.actions.restore', 'Restore')}
            </Button>
          </div>
        ) : null}
      </div>

      {archived ? (
        <Alert status="warning" data-testid="udip-archived-banner">
          <AlertTitle>{t('public_info_requests.detail.archivedTitle', 'This request is archived')}</AlertTitle>
          <AlertDescription>
            {t('public_info_requests.detail.archivedBody', 'It is not shown in the calendar and is never used for matching or search.')}
            {archiveReason ? ` ${t('public_info_requests.actions.archiveReason', 'Reason')}: ${archiveReason}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <div className="flex gap-1">
          {STATUS_TRACK.map((status, index) => (
            <div key={status} className="flex flex-1 flex-col gap-1 text-xs">
              <span className={`h-1.5 rounded-full ${archived ? 'bg-muted' : index < statusIndex || closed ? 'bg-status-success-icon' : index === statusIndex ? 'bg-accent-indigo' : 'bg-muted'}`} />
              <span className={index === statusIndex ? 'font-semibold' : 'text-muted-foreground'}>{t(`public_info_requests.status.${status}`, STATUS_FALLBACK[status])}</span>
            </div>
          ))}
        </div>
        <div className="rounded-lg border bg-card px-4 py-2" data-testid="udip-countdown">
          {request.status === 'awaiting_clarification' ? (
            <div className="text-sm"><StatusBadge variant="info">{t('public_info_requests.detail.paused', 'Clock paused')}</StatusBadge> {t('public_info_requests.detail.replyBy', 'reply by')} <strong>{formatDate(request.clarificationDueDate)}</strong></div>
          ) : archived ? (
            <div className="text-sm"><StatusBadge variant="neutral">{t('public_info_requests.status.archived', 'Archived (withdrawn)')}</StatusBadge>{archiveEvent ? ` ${new Date(archiveEvent.occurredAt).toLocaleDateString()}` : ''}</div>
          ) : closed ? (
            <div className="text-sm">{t('public_info_requests.detail.answeredOn', 'Answered on')} <strong>{formatDate(request.respondedAt)}</strong></div>
          ) : (
            <div className="flex items-center gap-2 text-sm">
              <StatusBadge variant={TONE_VARIANT[request.deadlineTone]}>{request.daysRemaining < 0 ? t('public_info_requests.detail.overdueBy', 'overdue by {days} d', { days: -request.daysRemaining }) : t('public_info_requests.detail.daysLeft', '{days} days left', { days: request.daysRemaining })}</StatusBadge>
              <span>{t('public_info_requests.detail.deadline', 'deadline')} <strong>{formatDate(request.currentDueDate)}</strong>{request.extendedAt ? ` (${t('public_info_requests.detail.extendedFrom', 'extended from')} ${formatDate(request.statutoryDueDate)})` : ''}</span>
            </div>
          )}
        </div>
      </div>

      {request.deadlineTone === 'overdue' && !closed ? (
        <Alert status="error">
          <AlertTitle>{t('public_info_requests.detail.overdueTitle', 'The statutory deadline has passed')}</AlertTitle>
          <AlertDescription>{t('public_info_requests.detail.overdueBody', 'An extension notice can no longer be sent (art. 13 ust. 2 requires notifying before the deadline). Send a reminder to the department or a partial answer.')}</AlertDescription>
        </Alert>
      ) : null}

      <Tabs value={tab} onValueChange={setTab} variant="underline">
        <TabsList aria-label={t('public_info_requests.detail.tabs', 'Case sections')}>
          <TabsTrigger value="overview">{t('public_info_requests.detail.tab.overview', 'Overview')}</TabsTrigger>
          <TabsTrigger value="routing">{t('public_info_requests.detail.tab.routing', 'Routing')}</TabsTrigger>
          <TabsTrigger value="replies" count={detail.queries.filter((query) => query.receivedAt).length}>{t('public_info_requests.detail.tab.replies', 'Department replies')}</TabsTrigger>
          <TabsTrigger value="draft">{t('public_info_requests.detail.tab.draft', 'Draft and anonymisation')}</TabsTrigger>
          <TabsTrigger value="history">{t('public_info_requests.detail.tab.history', 'History')}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <div className="mt-4 grid gap-4 lg:grid-cols-[7fr_3fr]">
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-medium">{t('public_info_requests.detail.points', 'Questions of the request')}</h2>
              <ol className="space-y-2">
                {detail.points.map((point) => (
                  <li key={point.id} className="flex gap-2 text-sm">
                    <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">{point.position}</span>
                    <span>{point.text}</span>
                  </li>
                ))}
              </ol>
              {request.bodyText ? (
                <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{t('public_info_requests.detail.fullText', 'Full text of the request')}</summary><pre className="mt-2 whitespace-pre-wrap text-xs">{request.bodyText}</pre></details>
              ) : null}
              <div className="space-y-1 pt-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('public_info_requests.detail.documents', 'Documents')}</h3>
                {detail.documents.map((document) => (
                  <div key={document.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <span>{document.fileName}</span>
                    <StatusBadge variant="neutral">{t(`public_info_requests.documentKind.${document.kind}`, document.kind)}</StatusBadge>
                    <StatusBadge variant={document.extractedText ? 'success' : 'warning'}>{t(`public_info_requests.textSource.${document.textSource}`, document.textSource)}{document.ocrConfidence != null ? ` ${Math.round(document.ocrConfidence * 100)}%` : ''}</StatusBadge>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-2 rounded-lg border bg-card p-4 text-sm">
              <h2 className="text-sm font-medium">{t('public_info_requests.detail.details', 'Details')}</h2>
              <dl className="grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">{t('public_info_requests.field.requesterName', 'Name / organisation')}</dt><dd>{request.requesterName}</dd>
                <dt className="text-muted-foreground">{t('public_info_requests.field.contact', 'E-mail / phone')}</dt><dd>{request.requesterContact ?? '—'}</dd>
                <dt className="text-muted-foreground">{t('public_info_requests.field.deliveryForm', 'Form of providing the information')}</dt><dd>{t(`public_info_requests.deliveryForm.${request.deliveryForm}`, request.deliveryForm)}</dd>
                <dt className="text-muted-foreground">{t('public_info_requests.create.channel', 'Channel')}</dt><dd>{t(`public_info_requests.channel.${request.channel}`, request.channel)}</dd>
                <dt className="text-muted-foreground">{t('public_info_requests.field.receivedAt', 'Date of receipt')}</dt><dd>{formatDate(request.receivedAt)}</dd>
                <dt className="text-muted-foreground">{t('public_info_requests.create.deadline', 'Statutory deadline')}</dt><dd>{formatDate(request.statutoryDueDate)}{request.dueShiftedFrom ? ` (↷ ${formatDate(request.dueShiftedFrom)})` : ''}</dd>
                <dt className="text-muted-foreground">{t('public_info_requests.create.maxExtension', 'Latest after extension')}</dt><dd>{formatDate(request.maxExtensionDate)}</dd>
                <dt className="self-center text-muted-foreground">{t('public_info_requests.calendar.col.assignee', 'Officer')}</dt>
                <dd className="flex flex-wrap items-center gap-2" data-testid="udip-detail-assignee">
                  <Select
                    value={request.assigneeUserId ?? UNASSIGNED_VALUE}
                    disabled={pending === 'assign' || archived}
                    onValueChange={(value) => {
                      void run('assign', { assigneeUserId: value === UNASSIGNED_VALUE ? null : value }, t('public_info_requests.assignee.assigned', 'Officer changed.'))
                    }}
                  >
                    <SelectTrigger className="h-8 w-auto min-w-48" aria-label={t('public_info_requests.assignee.change', 'Change officer')}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED_VALUE}>{t('public_info_requests.assignee.unassigned', 'Unassigned')}</SelectItem>
                      {request.assigneeUserId && !assignees.items.some((option) => option.id === request.assigneeUserId) ? (
                        <SelectItem value={request.assigneeUserId}>{request.assigneeName ?? request.assigneeUserId}</SelectItem>
                      ) : null}
                      {assignees.items.map((option) => (
                        <SelectItem key={option.id} value={option.id}>
                          {option.name}{option.id === assignees.currentUserId ? ` (${t('public_info_requests.assignee.me', 'me')})` : ''}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!request.assigneeUserId && !archived ? (
                    <Button type="button" size="sm" disabled={pending === 'claim'} onClick={() => { void run('claim', {}, t('public_info_requests.assignee.claimed', 'You are now the officer for this request.')) }}>
                      {t('public_info_requests.assignee.claim', 'Claim')}
                    </Button>
                  ) : null}
                </dd>
              </dl>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="routing"><div className="mt-4"><RoutingPanel detail={detail} run={run} pending={pending} /></div></TabsContent>
        <TabsContent value="replies"><div className="mt-4"><RepliesPanel detail={detail} run={run} pending={pending} /></div></TabsContent>
        <TabsContent value="draft"><div className="mt-4"><DraftPanel detail={detail} run={run} pending={pending} /></div></TabsContent>
        <TabsContent value="history">
          <ol className="mt-4 space-y-2">
            {detail.events.map((event) => (
              <li key={event.id} className="grid grid-cols-[10rem_1fr] gap-3 text-sm">
                <span className="tabular-nums text-muted-foreground">{new Date(event.occurredAt).toLocaleString()}</span>
                <span>
                  {event.kind === 'ai_suggestion' ? <StatusBadge variant="info">{t('public_info_requests.history.assistant', 'assistant')}</StatusBadge> : null}{' '}
                  {t(`public_info_requests.event.${event.kind}`, event.kind)}
                  {event.payload && 'to' in event.payload ? ` → ${t(`public_info_requests.status.${String(event.payload.to)}`, String(event.payload.to))}` : ''}
                  {event.actorName ? <span className="text-muted-foreground"> · {event.actorName}</span> : null}
                </span>
              </li>
            ))}
          </ol>
        </TabsContent>
      </Tabs>

      <Dialog open={dialog !== null} onOpenChange={(open) => { if (!open) setDialog(null) }}>
        <DialogContent onKeyDown={onKeyDown}>
          <DialogHeader>
            <DialogTitle>
              {dialog === 'extend' ? t('public_info_requests.actions.extendTitle', 'Extend the deadline (art. 13 ust. 2)') : null}
              {dialog === 'clarification' ? t('public_info_requests.actions.clarificationTitle', 'Request clarification') : null}
              {dialog === 'clarificationReply' ? t('public_info_requests.actions.clarificationReplyTitle', 'Register the clarification') : null}
              {dialog === 'markSent' ? t('public_info_requests.actions.markSentTitle', 'Record the answer as sent') : null}
              {dialog === 'archive' ? t('public_info_requests.actions.archiveTitle', 'Archive the request') : null}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {dialog === 'extend' ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="udip-ext">{t('public_info_requests.draft.extensionDate', 'New deadline')}</Label>
                  <Input id="udip-ext" type="date" max={request.maxExtensionDate} value={form.newDueDate ?? ''} onChange={(event) => setForm((current) => ({ ...current, newDueDate: event.target.value }))} />
                  <p className="text-xs text-muted-foreground">{t('public_info_requests.actions.extendHint', 'At most {date} (two months from receipt).', { date: formatDate(request.maxExtensionDate) })}</p>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="udip-ext-r">{t('public_info_requests.draft.extensionReason', 'Reason')}</Label>
                  <Input id="udip-ext-r" value={form.reason ?? ''} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
                </div>
              </>
            ) : null}
            {dialog === 'clarification' ? (
              <>
                <div className="space-y-1">
                  <Label htmlFor="udip-cl-s">{t('public_info_requests.actions.sentAt', 'Request sent on')}</Label>
                  <Input id="udip-cl-s" type="date" value={form.sentAt ?? ''} onChange={(event) => setForm((current) => ({ ...current, sentAt: event.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="udip-cl-d">{t('public_info_requests.actions.deliveredAt', 'Delivered on (7 days count from delivery)')}</Label>
                  <Input id="udip-cl-d" type="date" value={form.deliveredAt ?? ''} onChange={(event) => setForm((current) => ({ ...current, deliveredAt: event.target.value }))} />
                </div>
              </>
            ) : null}
            {dialog === 'archive' ? (
              <>
                <p className="text-sm text-muted-foreground">{t('public_info_requests.actions.archiveHint', 'Use this for requests registered by mistake or duplicates. The case number stays reserved, the request leaves the calendar and is not used for matching or search. You can restore it later.')}</p>
                <div className="space-y-1">
                  <Label htmlFor="udip-archive-reason">{t('public_info_requests.actions.archiveReason', 'Reason')}</Label>
                  <Input id="udip-archive-reason" autoFocus value={form.reason ?? ''} placeholder={t('public_info_requests.actions.archivePlaceholder', 'e.g. registered by mistake, duplicate of another case')} onChange={(event) => setForm((current) => ({ ...current, reason: event.target.value }))} />
                </div>
              </>
            ) : null}
            {dialog === 'clarificationReply' ? (
              <div className="space-y-1">
                <Label htmlFor="udip-cl-r">{t('public_info_requests.actions.clarificationReceivedAt', 'Clarification received on')}</Label>
                <Input id="udip-cl-r" type="date" value={form.receivedAt ?? ''} onChange={(event) => setForm((current) => ({ ...current, receivedAt: event.target.value }))} />
              </div>
            ) : null}
            {dialog === 'markSent' ? (
              <>
                {!latestDraft ? <Alert status="warning"><AlertDescription>{t('public_info_requests.actions.noDraft', 'There is no draft letter yet.')}</AlertDescription></Alert> : null}
                <div className="space-y-1">
                  <Label htmlFor="udip-ms-d">{t('public_info_requests.actions.respondedAt', 'Date the answer was sent')}</Label>
                  <Input id="udip-ms-d" type="date" value={form.respondedAt ?? ''} onChange={(event) => setForm((current) => ({ ...current, respondedAt: event.target.value }))} />
                </div>
                <div className="space-y-1">
                  <Label>{t('public_info_requests.actions.channel', 'Channel')}</Label>
                  <Select value={form.channel ?? 'email'} onValueChange={(value) => setForm((current) => ({ ...current, channel: value }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{['email', 'epuap', 'post', 'in_person'].map((value) => <SelectItem key={value} value={value}>{t(`public_info_requests.channel.${value}`, value)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <SwitchField checked={archive} onCheckedChange={setArchive} label={t('public_info_requests.actions.addToArchive', 'Add an anonymised copy to the archive')} />
                <p className="text-xs text-muted-foreground">{t('public_info_requests.export.noSend', 'Download and send it yourself — the system never sends anything.')}</p>
              </>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>{t('public_info_requests.common.cancel', 'Cancel')}</Button>
            <Button type="button" disabled={pending !== null} onClick={() => { void submitDialog() }}>{t('public_info_requests.common.save', 'Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
