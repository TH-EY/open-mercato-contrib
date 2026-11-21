"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Spinner } from '@open-mercato/ui/primitives/spinner'
import { FileUploadArea } from '@open-mercato/ui/primitives/file-upload'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Upload } from 'lucide-react'
import { formatDate, todayIsoLocal, uploadDocument, type UploadedDocument } from '../api'
import type { CaseDetail } from './types'

type Props = {
  detail: CaseDetail
  run: (action: string, payload?: Record<string, unknown>, successMessage?: string) => Promise<unknown>
  pending: string | null
}

const REPLY_KINDS = ['answered', 'partial', 'not_held', 'protected'] as const

export default function RepliesPanel({ detail, run, pending }: Props) {
  const t = useT()
  const [queryId, setQueryId] = React.useState<string | null>(null)
  const [uploaded, setUploaded] = React.useState<UploadedDocument[]>([])
  const [replyKind, setReplyKind] = React.useState<string>('answered')
  const [receivedAt, setReceivedAt] = React.useState(todayIsoLocal())
  const [uploading, setUploading] = React.useState(false)
  const query = detail.queries.find((candidate) => candidate.id === queryId) ?? null

  const close = () => {
    setQueryId(null)
    setUploaded([])
    setReplyKind('answered')
  }

  const handleFiles = async (files: File[]) => {
    if (!query) return
    setUploading(true)
    try {
      const results: UploadedDocument[] = []
      for (const file of files) results.push(await uploadDocument(file, detail.request.id, 'reply', query.id))
      setUploaded((current) => [...current, ...results])
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setUploading(false)
    }
  }

  const save = async () => {
    if (!query) return
    const result = await run('record-reply', { queryId: query.id, replyKind, receivedAt, replyAttachmentIds: uploaded.map((document) => document.id) }, t('public_info_requests.replies.saved', 'Department reply recorded.'))
    if (result) close()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      void save()
    }
  }

  const replyDocuments = detail.documents.filter((document) => document.kind === 'reply')

  return (
    <div className="space-y-4" data-testid="udip-replies">
      {detail.queries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('public_info_requests.replies.noQueries', 'Accept the routing proposal first — departments will appear here.')}</p>
      ) : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('public_info_requests.replies.department', 'Department')}</TableHead>
                <TableHead>{t('public_info_requests.replies.questions', 'Questions')}</TableHead>
                <TableHead>{t('public_info_requests.replies.sent', 'Sent')}</TableHead>
                <TableHead>{t('public_info_requests.replies.internalDue', 'Internal deadline')}</TableHead>
                <TableHead>{t('public_info_requests.replies.status', 'Status')}</TableHead>
                <TableHead className="text-right" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.queries.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="font-medium">{item.departmentName}</TableCell>
                  <TableCell>{item.pointPositions.join(', ')}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(item.sentAt)}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(item.internalDueDate)}</TableCell>
                  <TableCell>
                    {item.receivedAt
                      ? <StatusBadge variant={item.replyKind === 'answered' ? 'success' : 'warning'}>{t(`public_info_requests.replyKind.${item.replyKind ?? 'answered'}`, item.replyKind ?? '')} · {formatDate(item.receivedAt)}</StatusBadge>
                      : <StatusBadge variant={item.internalDueDate && item.internalDueDate < todayIsoLocal() ? 'error' : 'warning'}>{t('public_info_requests.replies.waiting', 'waiting')}</StatusBadge>}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button type="button" size="sm" variant="outline" onClick={() => setQueryId(item.id)}><Upload className="size-4" />{t('public_info_requests.replies.upload', 'Upload reply')}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {replyDocuments.length > 0 ? (
        <div className="space-y-2">
          <h3 className="text-sm font-medium">{t('public_info_requests.replies.documents', 'Received documents')}</h3>
          {replyDocuments.map((document) => (
            <details key={document.id} className="rounded-lg border bg-card p-3">
              <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                <span className="font-medium">{document.fileName}</span>
                <StatusBadge variant={document.extractedText ? 'success' : 'warning'}>{t(`public_info_requests.textSource.${document.textSource}`, document.textSource)}</StatusBadge>
              </summary>
              <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{document.extractedText ?? t('public_info_requests.replies.noText', 'No text extracted.')}</pre>
            </details>
          ))}
        </div>
      ) : null}

      <Dialog open={Boolean(query)} onOpenChange={(open) => { if (!open) close() }}>
        <DialogContent onKeyDown={onKeyDown}>
          <DialogHeader>
            <DialogTitle>{t('public_info_requests.replies.dialogTitle', 'Department reply')} — {query?.departmentName}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <FileUploadArea
              accept="application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/png,image/jpeg,text/plain,.docx,.txt,.eml"
              onFilesSelected={(files) => { void handleFiles(files) }}
              heading={t('public_info_requests.replies.drop', 'Drop the department reply (PDF, DOCX, scan)')}
            />
            {uploading ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner size="sm" />{t('public_info_requests.create.processing', 'Reading the document…')}</div> : null}
            {uploaded.map((document) => (
              <div key={document.id} className="flex items-center justify-between gap-2 text-sm">
                <span>{document.fileName}</span>
                <StatusBadge variant={document.extractedText ? 'success' : 'warning'}>{t(`public_info_requests.textSource.${document.textSource}`, document.textSource)}</StatusBadge>
              </div>
            ))}
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label>{t('public_info_requests.replies.kind', 'Type of reply')}</Label>
                <Select value={replyKind} onValueChange={setReplyKind}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{REPLY_KINDS.map((value) => <SelectItem key={value} value={value}>{t(`public_info_requests.replyKind.${value}`, value)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label htmlFor="udip-reply-date">{t('public_info_requests.replies.receivedAt', 'Received on')}</Label>
                <Input id="udip-reply-date" type="date" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>{t('public_info_requests.common.cancel', 'Cancel')}</Button>
            <Button type="button" disabled={pending === 'record-reply' || uploading} onClick={() => { void save() }}>{t('public_info_requests.replies.save', 'Save reply')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
