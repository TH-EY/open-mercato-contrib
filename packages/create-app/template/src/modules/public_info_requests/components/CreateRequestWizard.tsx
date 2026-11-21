"use client"
import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { Alert, AlertDescription, AlertTitle } from '@open-mercato/ui/primitives/alert'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { StepIndicator } from '@open-mercato/ui/primitives/step-indicator'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { FileUploadArea } from '@open-mercato/ui/primitives/file-upload'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import Link from 'next/link'
import { ExternalLink, Trash2, Plus } from 'lucide-react'
import { caseAction, deleteDocument, formatDate, getJson, postJson, todayIsoLocal, uploadDocument, type UploadedDocument } from './api'
import { CHANNELS, DELIVERY_FORMS, REQUESTER_KINDS } from './labels'

type IntakeResponse = {
  suggestions: {
    requesterName: string | null
    requesterKind: string
    requesterAddress: string | null
    requesterContact: string | null
    deliveryForm: string
    letterDate: string | null
    subjectSummary: string
    points: string[]
  }
  generatedBy: 'ai' | 'heuristic'
  text: string
  textSource: string
  ocrConfidence: number | null
  unreadable: boolean
}

type DeadlinePreview = { statutoryDueDate: string; shiftedFrom: string | null; explanation: string; maxExtensionDate: string; internalDueDate: string }

type SimilarMatch = {
  requestId: string
  caseNumber: string
  receivedAt: string
  subjectSummary: string
  similarity: number | null
  coveredPoints: number[]
  departments: string[]
  finalLetterType: string | null
  answerExcerpt: string
  sharedTerms: string[]
}

type FormState = {
  requesterName: string
  requesterKind: string
  requesterAddress: string
  requesterContact: string
  deliveryForm: string
  caseNumber: string
  receivedAt: string
  letterDate: string
  subjectSummary: string
  points: string[]
}

function newId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}`
}

export default function CreateRequestWizard() {
  const t = useT()
  const router = useRouter()
  const [step, setStep] = React.useState(0)
  const [requestId] = React.useState(newId)
  const [channel, setChannel] = React.useState<string>('email')
  const [documents, setDocuments] = React.useState<UploadedDocument[]>([])
  const [text, setText] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [intake, setIntake] = React.useState<IntakeResponse | null>(null)
  const [form, setForm] = React.useState<FormState | null>(null)
  const [deadline, setDeadline] = React.useState<DeadlinePreview | null>(null)
  const [similar, setSimilar] = React.useState<{ matches: SimilarMatch[]; searched: number } | null>(null)
  const [choice, setChoice] = React.useState<{ matchId: string | null; action: string }>({ matchId: null, action: 'none' })
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: 'public-info-request-create',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({ formId: 'public-info-request-create', resourceKind: 'public_info_requests.request', retryLastMutation }),
    [retryLastMutation],
  )

  const applyDocuments = (next: UploadedDocument[]) => {
    setDocuments(next)
    setText(next.map((item) => item.extractedText?.trim() ?? '').filter(Boolean).join('\n\n'))
  }

  const handleFiles = async (files: File[]) => {
    if (files.length === 0) return
    setBusy(true)
    let next = documents
    try {
      for (const file of files) {
        const uploaded = await runMutation({
          operation: () => uploadDocument(file, requestId, 'request'),
          context: mutationContext,
          mutationPayload: { action: 'upload', fileName: file.name },
        })
        next = [...next, uploaded]
        applyDocuments(next)
      }
    } catch (error) {
      flash(error instanceof Error ? error.message : t('public_info_requests.create.uploadFailed', 'Upload failed'), 'error')
    } finally {
      setBusy(false)
    }
  }

  const removeDocument = async (documentId: string) => {
    setBusy(true)
    try {
      await runMutation({
        operation: () => deleteDocument(documentId),
        context: mutationContext,
        mutationPayload: { action: 'remove-document', documentId },
      })
      applyDocuments(documents.filter((item) => item.id !== documentId))
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const goToDetails = async () => {
    setBusy(true)
    try {
      const response = await postJson<IntakeResponse>('/intake', {
        ...(documents.length > 0 ? { attachmentIds: documents.map((item) => item.id) } : {}),
        text: text.trim() ? text : undefined,
        channel,
      })
      setIntake(response)
      const year = new Date().getFullYear()
      const next = await getJson<{ caseNumber: string }>(`/case-number?year=${year}`)
      const suggestions = response.suggestions
      setForm({
        requesterName: suggestions.requesterName ?? '',
        requesterKind: suggestions.requesterKind || 'person',
        requesterAddress: suggestions.requesterAddress ?? '',
        requesterContact: suggestions.requesterContact ?? '',
        deliveryForm: suggestions.deliveryForm || 'email',
        caseNumber: next.caseNumber,
        receivedAt: todayIsoLocal(),
        letterDate: suggestions.letterDate ?? '',
        subjectSummary: suggestions.subjectSummary ?? '',
        points: suggestions.points.length > 0 ? suggestions.points : [''],
      })
      setStep(1)
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  React.useEffect(() => {
    if (!form?.receivedAt || !/^\d{4}-\d{2}-\d{2}$/.test(form.receivedAt)) return
    let cancelled = false
    postJson<DeadlinePreview>('/deadline-preview', { receivedAt: form.receivedAt })
      .then((preview) => { if (!cancelled) setDeadline(preview) })
      .catch(() => { if (!cancelled) setDeadline(null) })
    return () => { cancelled = true }
  }, [form?.receivedAt])

  const update = (patch: Partial<FormState>) => setForm((current) => (current ? { ...current, ...patch } : current))

  const register = async () => {
    if (!form) return
    if (!form.requesterName.trim() || !form.subjectSummary.trim()) {
      flash(t('public_info_requests.create.missingFields', 'Requester and subject are required.'), 'error')
      return
    }
    setBusy(true)
    try {
      const payload = {
        id: requestId,
        caseNumber: form.caseNumber.trim(),
        channel,
        receivedAt: form.receivedAt,
        letterDate: form.letterDate || null,
        requesterName: form.requesterName.trim(),
        requesterKind: form.requesterKind,
        requesterAddress: form.requesterAddress.trim() || null,
        requesterContact: form.requesterContact.trim() || null,
        deliveryForm: form.deliveryForm,
        subjectSummary: form.subjectSummary.trim(),
        bodyText: text || intake?.text || null,
        points: form.points.map((point) => point.trim()).filter(Boolean).map((point, index) => ({ position: index + 1, text: point })),
      }
      await runMutation({
        operation: () => postJson('/requests', payload),
        context: mutationContext,
        mutationPayload: payload,
      })
      const result = await getJson<{ matches: SimilarMatch[]; searched: number }>(`/requests/${requestId}/similar`)
      setSimilar(result)
      if (result.matches[0]) setChoice({ matchId: result.matches[0].requestId, action: 'reuse_structure' })
      setStep(2)
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const finish = async () => {
    setBusy(true)
    try {
      const match = similar?.matches.find((candidate) => candidate.requestId === choice.matchId) ?? null
      const payload = { matchedRequestId: match?.requestId ?? null, similarity: match?.similarity ?? null, action: match ? choice.action : 'none' }
      await runMutation({
        operation: () => caseAction(requestId, 'similar-choice', payload),
        context: mutationContext,
        mutationPayload: payload,
      })
      router.push(`/backend/public_info_requests/${requestId}?tab=routing`)
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
      setBusy(false)
    }
  }

  const steps = [
    { label: t('public_info_requests.create.step.document', 'Document') },
    { label: t('public_info_requests.create.step.details', 'Data and deadline') },
    { label: t('public_info_requests.create.step.similar', 'Similar requests') },
  ].map((entry, index) => ({ ...entry, id: `step-${index}`, status: index < step ? 'complete' as const : index === step ? 'current' as const : 'pending' as const }))

  return (
    <div className="space-y-6" data-testid="udip-create">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-xl font-semibold sm:text-2xl">{t('public_info_requests.create.title', 'Register a request')}</h1>
        <StepIndicator steps={steps} />
      </div>

      {step === 0 ? (
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>{t('public_info_requests.create.channel', 'Channel the request arrived through')}</Label>
            <SegmentedControl value={channel} onValueChange={setChannel} aria-label={t('public_info_requests.create.channel', 'Channel the request arrived through')}>
              {CHANNELS.map((value) => (
                <SegmentedControlItem key={value} value={value}>{t(`public_info_requests.channel.${value}`, value)}</SegmentedControlItem>
              ))}
            </SegmentedControl>
            <p className="text-xs text-muted-foreground">{t('public_info_requests.create.noMonitoring', 'The system does not read mailboxes or ePUAP — upload what you received or type a phone request.')}</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <FileUploadArea
                accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,message/rfc822,.eml,.docx,.txt,text/plain"
                multiple
                onFilesSelected={(files) => { void handleFiles(files) }}
                heading={t('public_info_requests.create.dropHeading', 'Drop the request scan, PDF, DOCX or e-mail')}
                description={t('public_info_requests.create.dropDescription', 'Text is extracted locally; scans are read with OCR.')}
              />
              {busy && step === 0 ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" />{t('public_info_requests.create.processing', 'Reading the document…')}</div> : null}
              {documents.length > 0 ? (
                <ul className="space-y-2" data-testid="udip-intake-files">
                  {documents.map((item) => (
                    <li key={item.id} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                      <span className="flex min-w-0 flex-1 items-center gap-2">
                        <span className="min-w-0 truncate font-medium" title={item.fileName}>{item.fileName}</span>
                        <StatusBadge className="shrink-0" variant={item.extractedText && !(item.ocrConfidence != null && item.ocrConfidence < 0.6) ? 'success' : 'warning'}>
                          {t(`public_info_requests.textSource.${item.textSource}`, item.textSource)}
                          {item.ocrConfidence != null ? ` · ${Math.round(item.ocrConfidence * 100)}%` : ''}
                        </StatusBadge>
                      </span>
                      <IconButton
                        type="button"
                        variant="ghost"
                        size="sm"
                        disabled={busy}
                        aria-label={t('public_info_requests.create.removeFile', 'Remove file')}
                        title={t('public_info_requests.create.removeFile', 'Remove file')}
                        onClick={() => { void removeDocument(item.id) }}
                      >
                        <Trash2 className="size-4" />
                      </IconButton>
                    </li>
                  ))}
                </ul>
              ) : null}
              {documents.length > 1 ? <p className="text-xs text-muted-foreground">{t('public_info_requests.create.multipleFilesHint', 'Text from all files is combined on the right. Remove a file to leave it out of the request.')}</p> : null}
              {documents.some((item) => !item.extractedText || (item.ocrConfidence != null && item.ocrConfidence < 0.6)) ? (
                <Alert status="warning">
                  <AlertTitle>{t('public_info_requests.create.unreadableTitle', 'The document could not be read reliably')}</AlertTitle>
                  <AlertDescription>{t('public_info_requests.create.unreadableBody', 'It may be handwritten or blurry. Type the request text on the right — the original stays attached to the case.')}</AlertDescription>
                </Alert>
              ) : null}
            </div>
            <div className="space-y-2 rounded-lg border bg-card p-4">
              <Label htmlFor="udip-text">{t('public_info_requests.create.recognizedText', 'Recognised text (editable)')}</Label>
              <Textarea id="udip-text" rows={16} value={text} onChange={(event) => setText(event.target.value)} placeholder={t('public_info_requests.create.textPlaceholder', 'Text of the request…')} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => router.push('/backend/public_info_requests')}>{t('public_info_requests.common.cancel', 'Cancel')}</Button>
            <Button type="button" disabled={busy || (documents.length === 0 && !text.trim())} onClick={() => { void goToDetails() }}>
              {busy ? <Spinner size="sm" /> : null}{t('public_info_requests.create.next', 'Next: data and deadline')}
            </Button>
          </div>
        </div>
      ) : null}

      {step === 1 && form ? (
        <div className="grid gap-4 lg:grid-cols-[7fr_3fr]">
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-medium">{t('public_info_requests.create.requester', 'Requester')}</h2>
                <StatusBadge variant="info">{intake?.generatedBy === 'ai' ? t('public_info_requests.create.suggestedAi', 'suggested by the assistant') : t('public_info_requests.create.suggestedRules', 'suggested from the text')}</StatusBadge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="space-y-1">
                  <Label htmlFor="udip-requester">{t('public_info_requests.field.requesterName', 'Name / organisation')}</Label>
                  <Input id="udip-requester" value={form.requesterName} onChange={(event) => update({ requesterName: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>{t('public_info_requests.field.requesterKind', 'Requester type')}</Label>
                  <Select value={form.requesterKind} onValueChange={(value) => update({ requesterKind: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{REQUESTER_KINDS.map((value) => <SelectItem key={value} value={value}>{t(`public_info_requests.requesterKind.${value}`, value)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="udip-address">{t('public_info_requests.field.address', 'Correspondence address')}</Label>
                  <Input id="udip-address" value={form.requesterAddress} onChange={(event) => update({ requesterAddress: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="udip-contact">{t('public_info_requests.field.contact', 'E-mail / phone')}</Label>
                  <Input id="udip-contact" value={form.requesterContact} onChange={(event) => update({ requesterContact: event.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label>{t('public_info_requests.field.deliveryForm', 'Form of providing the information')}</Label>
                  <Select value={form.deliveryForm} onValueChange={(value) => update({ deliveryForm: value })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{DELIVERY_FORMS.map((value) => <SelectItem key={value} value={value}>{t(`public_info_requests.deliveryForm.${value}`, value)}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{t('public_info_requests.create.privacyHint', 'Requester data is visible to BKS only — it never enters the archive or the similarity index.')}</p>
            </div>
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-medium">{t('public_info_requests.create.subject', 'Subject of the request')}</h2>
              <div className="space-y-1">
                <Label htmlFor="udip-subject">{t('public_info_requests.field.subjectSummary', 'Short description (for the calendar, no personal data)')}</Label>
                <Input id="udip-subject" value={form.subjectSummary} onChange={(event) => update({ subjectSummary: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>{t('public_info_requests.field.points', 'Questions')}</Label>
                {form.points.map((point, index) => (
                  <div key={index} className="flex items-start gap-2">
                    <span className="mt-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-xs font-semibold">{index + 1}</span>
                    <Textarea rows={2} value={point} onChange={(event) => update({ points: form.points.map((value, position) => (position === index ? event.target.value : value)) })} />
                    <IconButton type="button" variant="ghost" aria-label={t('public_info_requests.create.removePoint', 'Remove question')} onClick={() => update({ points: form.points.filter((_, position) => position !== index) })}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                ))}
                <Button type="button" variant="ghost" size="sm" onClick={() => update({ points: [...form.points, ''] })}><Plus className="size-4" />{t('public_info_requests.create.addPoint', 'Add question')}</Button>
              </div>
            </div>
          </div>
          <div className="space-y-4">
            <div className="space-y-3 rounded-lg border bg-card p-4">
              <h2 className="text-sm font-medium">{t('public_info_requests.create.registration', 'Registration')}</h2>
              <div className="space-y-1">
                <Label htmlFor="udip-case">{t('public_info_requests.field.caseNumber', 'Case number')}</Label>
                <Input id="udip-case" className="font-mono" value={form.caseNumber} onChange={(event) => update({ caseNumber: event.target.value })} />
                <p className="text-xs text-muted-foreground">{t('public_info_requests.create.caseHint', 'Change it if SIDAS assigned a different number.')}</p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="udip-received">{t('public_info_requests.field.receivedAt', 'Date of receipt')}</Label>
                <Input id="udip-received" type="date" value={form.receivedAt} onChange={(event) => update({ receivedAt: event.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="udip-letter">{t('public_info_requests.field.letterDate', 'Date of the letter')}</Label>
                <Input id="udip-letter" type="date" value={form.letterDate} onChange={(event) => update({ letterDate: event.target.value })} />
              </div>
            </div>
            {deadline ? (
              <div className="space-y-1 rounded-lg border bg-card p-4" data-testid="udip-deadline-preview">
                <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t('public_info_requests.create.deadline', 'Statutory deadline')}</div>
                <div className="text-2xl font-bold tabular-nums">{formatDate(deadline.statutoryDueDate)}</div>
                <div className="font-mono text-xs text-muted-foreground">{deadline.explanation}</div>
                <div className="pt-2 text-xs text-muted-foreground">{t('public_info_requests.create.maxExtension', 'Latest after extension (art. 13 ust. 2)')}: <strong>{formatDate(deadline.maxExtensionDate)}</strong></div>
                <div className="text-xs text-muted-foreground">{t('public_info_requests.create.internalDue', 'Suggested department deadline')}: <strong>{formatDate(deadline.internalDueDate)}</strong></div>
              </div>
            ) : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setStep(0)}>{t('public_info_requests.common.back', 'Back')}</Button>
              <Button type="button" disabled={busy} onClick={() => { void register() }}>{busy ? <Spinner size="sm" /> : null}{t('public_info_requests.create.register', 'Register and check similar')}</Button>
            </div>
          </div>
        </div>
      ) : null}

      {step === 2 && similar ? (
        <div className="space-y-4">
          <Alert status="information">
            <AlertDescription>
              {t('public_info_requests.similar.summary', 'Searched {searched} archived requests — {count} similar found.', { searched: similar.searched, count: similar.matches.length })}
            </AlertDescription>
          </Alert>
          {similar.matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('public_info_requests.similar.none', 'No similar requests in the archive. The assistant will propose departments from the organisation structure.')}</p>
          ) : (
            <div className="space-y-3">
              {similar.matches.map((match) => (
                <SimilarMatchCard key={match.requestId} match={match} openHref={`/backend/public_info_requests/${match.requestId}`} selected={choice.matchId === match.requestId} onSelect={() => setChoice((current) => ({ matchId: match.requestId, action: current.action === 'none' ? 'reuse_structure' : current.action }))} />
              ))}
              <div className="space-y-2 rounded-lg border bg-card p-4">
                <Label>{t('public_info_requests.similar.what', 'What should happen with the selected match?')}</Label>
                <SegmentedControl value={choice.action} onValueChange={(value) => setChoice((current) => ({ ...current, action: value }))} aria-label={t('public_info_requests.similar.what', 'What should happen with the selected match?')}>
                  <SegmentedControlItem value="reuse_structure">{t('public_info_requests.similar.reuse', 'Route + reuse structure')}</SegmentedControlItem>
                  <SegmentedControlItem value="start_from_answer">{t('public_info_requests.similar.fromAnswer', 'Start from past answer')}</SegmentedControlItem>
                  <SegmentedControlItem value="bip_referral">{t('public_info_requests.similar.bip', 'Refer to BIP')}</SegmentedControlItem>
                  <SegmentedControlItem value="none">{t('public_info_requests.similar.ignore', 'Ignore')}</SegmentedControlItem>
                </SegmentedControl>
              </div>
            </div>
          )}
          <div className="flex justify-end">
            <Button type="button" disabled={busy} onClick={() => { void finish() }}>{t('public_info_requests.similar.next', 'Next: routing proposal')}</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function SimilarMatchCard({ match, selected, onSelect, openHref }: { match: SimilarMatch; selected?: boolean; onSelect?: () => void; openHref?: string }) {
  const t = useT()
  return (
    <div className={`space-y-2 rounded-lg border bg-card p-4 ${selected ? 'border-accent-indigo ring-1 ring-accent-indigo' : ''}`} data-testid="udip-similar-match">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold">{match.caseNumber}</span>
          <span className="text-xs text-muted-foreground">{formatDate(match.receivedAt)}</span>
        </div>
        <div className="flex items-center gap-2">
          {match.similarity !== null ? <StatusBadge variant={match.similarity >= 0.6 ? 'success' : match.similarity >= 0.35 ? 'warning' : 'neutral'}>{Math.round(match.similarity * 100)}%</StatusBadge> : null}
          {openHref ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={openHref} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />{t('public_info_requests.similar.open', 'Open case')}</Link>
            </Button>
          ) : null}
          {onSelect ? <Button type="button" size="sm" variant={selected ? 'default' : 'outline'} onClick={onSelect}>{selected ? t('public_info_requests.similar.selected', 'Selected') : t('public_info_requests.similar.select', 'Select')}</Button> : null}
        </div>
      </div>
      <div className="text-sm font-medium">{match.subjectSummary}</div>
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        {match.coveredPoints.length > 0 ? <span>{t('public_info_requests.similar.covers', 'Covers questions')}: {match.coveredPoints.join(', ')}</span> : null}
        {match.departments.length > 0 ? <span>· {match.departments.join(', ')}</span> : null}
        {match.finalLetterType ? <span>· {t(`public_info_requests.letterType.${match.finalLetterType}`, match.finalLetterType)}</span> : null}
        {match.sharedTerms.length > 0 ? <span>· {t('public_info_requests.similar.terms', 'Common terms')}: {match.sharedTerms.slice(0, 5).join(', ')}</span> : null}
      </div>
      {match.answerExcerpt ? <p className="border-l-2 border-border pl-3 text-xs text-muted-foreground">„{match.answerExcerpt.slice(0, 320)}…”</p> : null}
    </div>
  )
}
