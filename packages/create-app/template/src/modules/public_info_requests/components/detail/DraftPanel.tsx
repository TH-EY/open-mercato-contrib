"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Download, EyeOff, Pencil, Check, Sparkles } from 'lucide-react'
import { downloadFile, getJson } from '../api'
import { LETTER_TYPES } from '../labels'
import type { CaseDetail, DraftParagraph } from './types'

type Props = {
  detail: CaseDetail
  run: (action: string, payload?: Record<string, unknown>, successMessage?: string) => Promise<unknown>
  pending: string | null
}

type Mark = CaseDetail['marks'][number]
type Department = { id: string; name: string; kind: string }

const NEXT_STATE: Record<Mark['state'], Mark['state']> = { suggested: 'accepted', accepted: 'rejected', rejected: 'suggested', kept: 'suggested' }

function markClass(state: Mark['state']): string {
  if (state === 'accepted') return 'rounded-sm bg-foreground text-foreground'
  if (state === 'rejected' || state === 'kept') return 'underline decoration-dotted decoration-status-success-icon'
  return 'rounded-sm bg-muted outline outline-1 outline-dashed outline-muted-foreground'
}

function MarkedText({ text, marks, onToggle }: { text: string; marks: Mark[]; onToggle: (mark: Mark) => void }) {
  const t = useT()
  const sorted = [...marks].sort((left, right) => left.start - right.start)
  const parts: React.ReactNode[] = []
  let cursor = 0
  sorted.forEach((mark) => {
    if (mark.start < cursor || mark.end > text.length) return
    if (mark.start > cursor) parts.push(text.slice(cursor, mark.start))
    parts.push(
      <span
        key={mark.id}
        role="button"
        tabIndex={0}
        title={`${t(`public_info_requests.pii.${mark.category}`, mark.category)} — ${t(`public_info_requests.markState.${mark.state}`, mark.state)}`}
        data-testid="udip-mark"
        data-state={mark.state}
        className={`cursor-pointer px-0.5 ${markClass(mark.state)}`}
        onClick={() => onToggle(mark)}
        onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(mark) } }}
      >
        {text.slice(mark.start, mark.end)}
      </span>,
    )
    cursor = mark.end
  })
  parts.push(text.slice(cursor))
  return <>{parts}</>
}

export default function DraftPanel({ detail, run, pending }: Props) {
  const t = useT()
  const requestId = detail.request.id
  const draft = detail.drafts[0] ?? null
  const [letterType, setLetterType] = React.useState<string>(draft?.letterType ?? (detail.queries.some((query) => query.departmentKind === 'external' || query.departmentKind === 'municipal_unit') && detail.queries.length === 1 ? 'not_held_referral' : 'answer'))
  const [departments, setDepartments] = React.useState<Department[]>([])
  const [referralId, setReferralId] = React.useState<string>('')
  const [question, setQuestion] = React.useState('')
  const [extensionDate, setExtensionDate] = React.useState(detail.request.maxExtensionDate)
  const [extensionReason, setExtensionReason] = React.useState('konieczność przeprowadzenia całościowej kwerendy')
  const [bipUrl, setBipUrl] = React.useState('https://bip.um.bydgoszcz.pl/')
  const [editing, setEditing] = React.useState<Record<string, string>>({})

  React.useEffect(() => {
    getJson<{ items: Department[] }>('/departments?pageSize=100')
      .then((response) => {
        setDepartments(response.items)
        const separate = detail.queries.find((query) => query.departmentKind === 'external' || query.departmentKind === 'municipal_unit')
        if (separate) setReferralId(separate.departmentId)
      })
      .catch(() => setDepartments([]))
  }, [detail.queries])

  const draftLetterType = draft?.letterType
  React.useEffect(() => {
    if (draftLetterType) setLetterType(draftLetterType)
  }, [draftLetterType])

  const generate = async () => {
    const options: Record<string, unknown> = {}
    if (letterType === 'not_held_referral' && referralId) options.referralDepartmentId = referralId
    if (letterType === 'clarification_request') options.clarificationQuestion = question || t('public_info_requests.draft.defaultQuestion', 'Prosimy o doprecyzowanie, o jakie dokładnie dokumenty chodzi.')
    if (letterType === 'extension_notice') { options.extensionDueDate = extensionDate; options.extensionReason = extensionReason }
    if (letterType === 'bip_referral') options.bipUrl = bipUrl
    const baseOn = detail.request.similarChoice?.action === 'start_from_answer' || (letterType === 'answer' && detail.documents.every((document) => document.kind !== 'reply') && detail.request.similarChoice?.matchedRequestId)
      ? 'archive_answer'
      : undefined
    await run('drafts', { letterType, options, ...(baseOn ? { baseOn } : {}) }, t('public_info_requests.draft.generated', 'Draft generated — check the flagged paragraphs.'))
  }

  const saveParagraphs = async (paragraphs: DraftParagraph[], extra: Record<string, unknown> = {}) => {
    if (!draft) return
    await run('draft-update', { draftId: draft.id, paragraphs, ...extra }, t('public_info_requests.draft.saved', 'Draft saved.'))
    setEditing({})
  }

  const saveEdits = async () => {
    if (!draft) return
    const paragraphs = draft.paragraphs.map((paragraph) => (editing[paragraph.id] !== undefined ? { ...paragraph, text: editing[paragraph.id] } : paragraph))
    await saveParagraphs(paragraphs)
  }

  const confirmParagraph = async (paragraph: DraftParagraph) => {
    if (!draft) return
    await run('draft-update', { draftId: draft.id, confirmParagraphIds: [paragraph.id] }, t('public_info_requests.draft.confirmed', 'Paragraph confirmed.'))
  }

  const toggleMark = async (mark: Mark) => {
    await run('mark-decide', { markId: mark.id, state: NEXT_STATE[mark.state] })
  }

  const exportLetter = async (format: 'docx' | 'pdf' | 'txt') => {
    if (!draft) return
    try {
      await downloadFile(`/requests/${requestId}/export?format=${format}&draftId=${draft.id}`, `odpowiedz.${format}`)
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const exportDocument = async (documentId: string, fileName: string) => {
    try {
      await downloadFile(`/requests/${requestId}/export?format=docx&documentId=${documentId}`, `${fileName}_zanonimizowany.docx`)
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  const draftMarks = draft ? detail.marks.filter((mark) => mark.draftId === draft.id) : []
  const attachmentMarks = detail.marks.filter((mark) => mark.targetKind === 'attachment')
  const undecided = [...draftMarks, ...attachmentMarks].filter((mark) => mark.state === 'suggested').length
  const prepared = draft?.status === 'ready' || draft?.status === 'exported'
  const blocking = draft ? draft.paragraphs.filter((paragraph) => paragraph.flags.length > 0 && !paragraph.confirmedBy).length : 0
  const replyDocuments = detail.documents.filter((document) => document.kind === 'reply' && document.extractedText)

  return (
    <div className="space-y-4" data-testid="udip-draft">
      <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-4">
        <div className="space-y-1">
          <Label>{t('public_info_requests.draft.letterType', 'Letter type')}</Label>
          <Select value={letterType} onValueChange={setLetterType}>
            <SelectTrigger className="w-72"><SelectValue /></SelectTrigger>
            <SelectContent>{LETTER_TYPES.map((value) => <SelectItem key={value} value={value}>{t(`public_info_requests.letterType.${value}`, value)}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        {letterType === 'not_held_referral' ? (
          <div className="space-y-1">
            <Label>{t('public_info_requests.draft.referral', 'Entity holding the information')}</Label>
            <Select value={referralId} onValueChange={setReferralId}>
              <SelectTrigger className="w-80"><SelectValue placeholder={t('public_info_requests.draft.chooseEntity', 'Choose…')} /></SelectTrigger>
              <SelectContent>{departments.filter((department) => department.kind === 'external' || department.kind === 'municipal_unit').map((department) => <SelectItem key={department.id} value={department.id}>{department.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        ) : null}
        {letterType === 'clarification_request' ? (
          <div className="min-w-80 flex-1 space-y-1">
            <Label htmlFor="udip-question">{t('public_info_requests.draft.question', 'What should the requester clarify?')}</Label>
            <Input id="udip-question" value={question} onChange={(event) => setQuestion(event.target.value)} />
          </div>
        ) : null}
        {letterType === 'extension_notice' ? (
          <>
            <div className="space-y-1">
              <Label htmlFor="udip-ext-date">{t('public_info_requests.draft.extensionDate', 'New deadline')}</Label>
              <Input id="udip-ext-date" type="date" value={extensionDate} max={detail.request.maxExtensionDate} onChange={(event) => setExtensionDate(event.target.value)} />
            </div>
            <div className="min-w-72 flex-1 space-y-1">
              <Label htmlFor="udip-ext-reason">{t('public_info_requests.draft.extensionReason', 'Reason')}</Label>
              <Input id="udip-ext-reason" value={extensionReason} onChange={(event) => setExtensionReason(event.target.value)} />
            </div>
          </>
        ) : null}
        {letterType === 'bip_referral' ? (
          <div className="min-w-80 flex-1 space-y-1">
            <Label htmlFor="udip-bip">{t('public_info_requests.draft.bipUrl', 'BIP address')}</Label>
            <Input id="udip-bip" value={bipUrl} onChange={(event) => setBipUrl(event.target.value)} />
          </div>
        ) : null}
        <Button type="button" disabled={pending === 'drafts'} onClick={() => { void generate() }}>
          {pending === 'drafts' ? <Spinner size="sm" /> : <Sparkles className="size-4" />}{draft ? t('public_info_requests.draft.regenerate', 'Generate new version') : t('public_info_requests.draft.generate', 'Generate draft')}
        </Button>
      </div>

      {!draft ? (
        <p className="text-sm text-muted-foreground">{t('public_info_requests.draft.none', 'No draft yet. Upload department replies first, or choose another letter type.')}</p>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-3 rounded-lg border bg-card p-6" data-testid="udip-letter">
            <div className="flex justify-between border-b pb-3 text-sm">
              <div><div className="font-semibold">URZĄD MIASTA BYDGOSZCZY</div><div className="text-xs text-muted-foreground">Biuro Komunikacji Społecznej</div></div>
              <div className="text-right font-mono text-xs text-muted-foreground">{detail.request.caseNumber}<br />v{draft.version} · {t(`public_info_requests.draftStatus.${draft.status}`, draft.status)}</div>
            </div>
            {draft.paragraphs.map((paragraph) => {
              const isEditing = editing[paragraph.id] !== undefined
              const flagged = paragraph.flags.length > 0 && !paragraph.confirmedBy
              const tone = paragraph.flags.includes('gap') ? 'bg-status-error-bg' : flagged ? 'bg-status-warning-bg' : ''
              return (
                <div key={paragraph.id} className={`group rounded-md p-2 ${tone}`} data-testid="udip-paragraph" data-flags={paragraph.flags.join(',')}>
                  {isEditing ? (
                    <Textarea rows={Math.max(3, Math.ceil(editing[paragraph.id].length / 90))} value={editing[paragraph.id]} onChange={(event) => setEditing((current) => ({ ...current, [paragraph.id]: event.target.value }))} />
                  ) : (
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">
                      {paragraph.text
                        ? <MarkedText text={paragraph.text} marks={draftMarks.filter((mark) => mark.paragraphId === paragraph.id)} onToggle={(mark) => { void toggleMark(mark) }} />
                        : <span className="italic text-muted-foreground">{t('public_info_requests.draft.gap', 'Missing information for question {position}', { position: paragraph.pointPosition ?? '' })}</span>}
                    </p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    {paragraph.sources.map((source, index) => <span key={index} className="rounded-sm border bg-muted px-1.5 py-0.5 font-mono text-muted-foreground" title={source.quote}>{detail.documents.find((document) => document.id === source.attachmentId)?.fileName ?? t('public_info_requests.draft.archiveSource', 'knowledge base')}</span>)}
                    {paragraph.flags.map((flag) => <StatusBadge key={flag} variant={flag === 'gap' || flag === 'number_mismatch' ? 'error' : 'warning'}>{t(`public_info_requests.flag.${flag}`, flag)}{flag === 'number_mismatch' && paragraph.mismatchTokens?.length ? `: ${paragraph.mismatchTokens.join(', ')}` : ''}</StatusBadge>)}
                    {paragraph.confirmedBy ? <StatusBadge variant="success">{t('public_info_requests.draft.confirmedBadge', 'confirmed')}</StatusBadge> : null}
                    {paragraph.kind !== 'closing' ? (
                      <span className="ml-auto flex gap-1 opacity-70 group-hover:opacity-100">
                        {!isEditing ? <Button type="button" size="sm" variant="ghost" onClick={() => setEditing((current) => ({ ...current, [paragraph.id]: paragraph.text }))}><Pencil className="size-3" />{t('public_info_requests.draft.edit', 'Edit')}</Button> : null}
                        {flagged ? <Button type="button" size="sm" variant="ghost" onClick={() => { void confirmParagraph(paragraph) }}><Check className="size-3" />{t('public_info_requests.draft.confirm', 'I confirm')}</Button> : null}
                      </span>
                    ) : null}
                  </div>
                </div>
              )
            })}
            {Object.keys(editing).length > 0 ? (
              <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setEditing({})}>{t('public_info_requests.common.cancel', 'Cancel')}</Button>
                <Button type="button" disabled={pending === 'draft-update'} onClick={() => { void saveEdits() }}>{t('public_info_requests.draft.saveEdits', 'Save changes')}</Button>
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <div className="text-sm font-medium">{t('public_info_requests.draft.checks', 'Draft checks')}</div>
              <div className="text-xs text-muted-foreground">{t('public_info_requests.draft.flagged', 'Paragraphs needing attention')}: <strong>{blocking}</strong></div>
              <div className="text-xs text-muted-foreground">{t('public_info_requests.draft.generatedBy', 'Generated by')}: {draft.generatedBy === 'ai' ? t('public_info_requests.draft.byAi', 'assistant') : t('public_info_requests.draft.byTemplate', 'template + department replies')}</div>
              {draft.status !== 'ready' && draft.status !== 'exported' ? (
                <Button type="button" size="sm" disabled={blocking > 0 || pending === 'draft-update'} onClick={() => { void saveParagraphs(draft.paragraphs, { status: 'ready' }) }}>{t('public_info_requests.draft.markReady', 'Mark as prepared')}</Button>
              ) : <StatusBadge variant="success">{t(`public_info_requests.draftStatus.${draft.status}`, draft.status)}</StatusBadge>}
            </div>
            <div className="space-y-2 rounded-lg border bg-card p-4" data-testid="udip-anonymisation">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">{t('public_info_requests.pii.title', 'Anonymisation')}</div>
                <Button type="button" size="sm" variant="outline" disabled={pending === 'pii-detect'} onClick={() => { void run('pii-detect', { draftId: draft.id, includeAttachments: true }, t('public_info_requests.pii.detected', 'Personal data suggestions ready.')) }}>
                  <EyeOff className="size-4" />{t('public_info_requests.pii.detect', 'Detect personal data')}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <span className={`px-1 ${markClass('suggested')}`}>{t('public_info_requests.pii.legendSuggested', 'grey = suggestion')}</span>
                <span className="px-1"><span className={markClass('accepted')}>████</span> {t('public_info_requests.pii.legendAccepted', 'black = will be removed')}</span>
                <span className={`px-1 ${markClass('rejected')}`}>{t('public_info_requests.pii.legendRejected', 'underlined = stays visible')}</span>
              </div>
              <div className="text-xs text-muted-foreground">{t('public_info_requests.pii.hint', 'Click a highlighted fragment to accept or reject it.')}</div>
              {undecided > 0 ? <Alert status="warning"><AlertDescription>{t('public_info_requests.pii.undecided', '{count} suggestions not decided — export is blocked.', { count: undecided })}</AlertDescription></Alert> : null}
              {undecided > 0 ? (
                <Button type="button" size="sm" variant="ghost" disabled={pending === 'mark-decide'} onClick={() => { void run('mark-decide', { markIds: [...draftMarks, ...attachmentMarks].filter((mark) => mark.state === 'suggested').map((mark) => mark.id), state: 'accepted' }) }}>{t('public_info_requests.pii.acceptAll', 'Accept all suggestions')}</Button>
              ) : null}
            </div>
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <div className="text-sm font-medium">{t('public_info_requests.export.title', 'Export')}</div>
              <div className="flex flex-wrap gap-2">
                {(['docx', 'pdf', 'txt'] as const).map((format) => (
                  <Button key={format} type="button" size="sm" variant="outline" disabled={undecided > 0 || !prepared} onClick={() => { void exportLetter(format) }}><Download className="size-4" />{format.toUpperCase()}</Button>
                ))}
              </div>
              {!prepared ? <div className="text-xs text-muted-foreground">{t('public_info_requests.export.needsPrepared', 'Run the personal data check and mark the draft as prepared to export it.')}</div> : null}
              <div className="text-xs text-muted-foreground">{t('public_info_requests.export.noSend', 'Download and send it yourself — the system never sends anything.')}</div>
            </div>
          </div>
        </div>
      )}

      {replyDocuments.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('public_info_requests.pii.attachments', 'Department replies — anonymisation of attachments')}</h3>
          {replyDocuments.map((document) => {
            const marks = attachmentMarks.filter((mark) => mark.documentId === document.id)
            return (
              <details key={document.id} className="rounded-lg border bg-card p-3" open={marks.length > 0}>
                <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="font-medium">{document.fileName}</span>
                  <span className="flex items-center gap-2">
                    <StatusBadge variant={marks.some((mark) => mark.state === 'suggested') ? 'warning' : 'neutral'}>{marks.length} {t('public_info_requests.pii.marks', 'marks')}</StatusBadge>
                    <Button type="button" size="sm" variant="outline" disabled={marks.some((mark) => mark.state === 'suggested')} onClick={(event) => { event.preventDefault(); void exportDocument(document.id, document.fileName.replace(/\.[^.]+$/, '')) }}><Download className="size-4" />{t('public_info_requests.export.redacted', 'Redacted DOCX')}</Button>
                  </span>
                </summary>
                <p className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap text-xs leading-relaxed">
                  <MarkedText text={document.extractedText ?? ''} marks={marks} onToggle={(mark) => { void toggleMark(mark) }} />
                </p>
              </details>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
