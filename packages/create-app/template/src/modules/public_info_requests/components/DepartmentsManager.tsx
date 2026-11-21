"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { getJson, postJson } from './api'

type Department = {
  id: string
  name: string
  symbol: string
  kind: string
  competenceScope: string
  keywords: string[]
  contractCodes: string[]
  contactHint: string | null
  isActive: boolean
  updatedAt: string | null
}

type Draft = Omit<Department, 'id' | 'updatedAt' | 'keywords' | 'contractCodes'> & { id?: string; updatedAt?: string | null; keywords: string; contractCodes: string }

const KINDS = ['department', 'office', 'municipal_unit', 'external'] as const

const empty: Draft = { name: '', symbol: '', kind: 'department', competenceScope: '', keywords: '', contractCodes: '', contactHint: '', isActive: true }

export default function DepartmentsManager() {
  const t = useT()
  const [items, setItems] = React.useState<Department[] | null>(null)
  const [draft, setDraft] = React.useState<Draft | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: 'public-info-departments',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const context = React.useMemo(() => ({ formId: 'public-info-departments', resourceKind: 'public_info_requests.department', retryLastMutation }), [retryLastMutation])

  const load = React.useCallback(async () => {
    const response = await getJson<{ items: Department[] }>('/departments?pageSize=100')
    setItems(response.items)
  }, [])

  React.useEffect(() => { void load() }, [load])

  const save = async () => {
    if (!draft) return
    const payload = {
      ...(draft.id ? { id: draft.id } : {}),
      name: draft.name,
      symbol: draft.symbol,
      kind: draft.kind,
      competenceScope: draft.competenceScope,
      keywords: draft.keywords.split(',').map((value) => value.trim()).filter(Boolean),
      contractCodes: draft.contractCodes.split(',').map((value) => value.trim()).filter(Boolean),
      contactHint: draft.contactHint || null,
      isActive: draft.isActive,
    }
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(draft.updatedAt ? buildOptimisticLockHeader(draft.updatedAt) : {}, () => postJson('/departments', payload, draft.id ? 'PUT' : 'POST')),
        context,
        mutationPayload: payload,
      })
      flash(t('public_info_requests.departments.saved', 'Department saved.'), 'success')
      setDraft(null)
      await load()
    } catch (error) {
      if (!surfaceRecordConflict(error, t)) flash(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <div className="space-y-4" data-testid="udip-departments">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold sm:text-2xl">{t('public_info_requests.departments.title', 'Departments and competence scopes')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('public_info_requests.departments.subtitle', 'Routing proposals use these scopes, keywords and contract codes.')}</p>
        </div>
        <Button type="button" onClick={() => setDraft(empty)}>{t('public_info_requests.departments.add', 'Add department')}</Button>
      </div>
      {!items ? <LoadingMessage label={t('public_info_requests.common.loading', 'Loading…')} /> : (
        <div className="rounded-lg border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('public_info_requests.departments.name', 'Name')}</TableHead>
                <TableHead>{t('public_info_requests.departments.symbol', 'Symbol')}</TableHead>
                <TableHead>{t('public_info_requests.departments.kind', 'Type')}</TableHead>
                <TableHead>{t('public_info_requests.departments.scope', 'Scope')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => (
                <TableRow key={item.id} className="cursor-pointer" onClick={() => setDraft({ ...item, keywords: item.keywords.join(', '), contractCodes: item.contractCodes.join(', '), contactHint: item.contactHint ?? '' })}>
                  <TableCell className="font-medium">{item.name}</TableCell>
                  <TableCell className="font-mono text-xs">{item.symbol}</TableCell>
                  <TableCell><StatusBadge variant={item.kind === 'external' || item.kind === 'municipal_unit' ? 'warning' : 'neutral'}>{t(`public_info_requests.departmentKind.${item.kind}`, item.kind)}</StatusBadge></TableCell>
                  <TableCell className="max-w-xl truncate text-xs text-muted-foreground">{item.competenceScope}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <Dialog open={draft !== null} onOpenChange={(open) => { if (!open) setDraft(null) }}>
        <DialogContent onKeyDown={(event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); void save() } }}>
          <DialogHeader><DialogTitle>{draft?.id ? t('public_info_requests.departments.edit', 'Edit department') : t('public_info_requests.departments.add', 'Add department')}</DialogTitle></DialogHeader>
          {draft ? (
            <div className="space-y-3">
              <div className="grid gap-3 md:grid-cols-[1fr_8rem]">
                <div className="space-y-1"><Label htmlFor="d-name">{t('public_info_requests.departments.name', 'Name')}</Label><Input id="d-name" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></div>
                <div className="space-y-1"><Label htmlFor="d-symbol">{t('public_info_requests.departments.symbol', 'Symbol')}</Label><Input id="d-symbol" value={draft.symbol} onChange={(event) => setDraft({ ...draft, symbol: event.target.value })} /></div>
              </div>
              <div className="space-y-1">
                <Label>{t('public_info_requests.departments.kind', 'Type')}</Label>
                <Select value={draft.kind} onValueChange={(value) => setDraft({ ...draft, kind: value })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{KINDS.map((value) => <SelectItem key={value} value={value}>{t(`public_info_requests.departmentKind.${value}`, value)}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label htmlFor="d-scope">{t('public_info_requests.departments.scope', 'Scope')}</Label><Textarea id="d-scope" rows={3} value={draft.competenceScope} onChange={(event) => setDraft({ ...draft, competenceScope: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="d-keywords">{t('public_info_requests.departments.keywords', 'Keywords (comma separated)')}</Label><Textarea id="d-keywords" rows={3} value={draft.keywords} onChange={(event) => setDraft({ ...draft, keywords: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="d-codes">{t('public_info_requests.departments.codes', 'Contract codes (e.g. WGK, TT)')}</Label><Input id="d-codes" value={draft.contractCodes} onChange={(event) => setDraft({ ...draft, contractCodes: event.target.value })} /></div>
              <div className="space-y-1"><Label htmlFor="d-contact">{t('public_info_requests.departments.contact', 'Contact (for referral letters)')}</Label><Input id="d-contact" value={draft.contactHint ?? ''} onChange={(event) => setDraft({ ...draft, contactHint: event.target.value })} /></div>
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDraft(null)}>{t('public_info_requests.common.cancel', 'Cancel')}</Button>
            <Button type="button" onClick={() => { void save() }}>{t('public_info_requests.common.save', 'Save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
