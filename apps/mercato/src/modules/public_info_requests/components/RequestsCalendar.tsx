"use client"
import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { Button } from '@open-mercato/ui/primitives/button'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { SearchInput } from '@open-mercato/ui/primitives/search-input'
import { SwitchField } from '@open-mercato/ui/primitives/switch-field'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@open-mercato/ui/primitives/table'
import { Avatar } from '@open-mercato/ui/primitives/avatar'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { ScheduleView, type ScheduleItem, type ScheduleRange, type ScheduleViewMode } from '@open-mercato/ui/backend/schedule'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { caseAction, formatDate, getJson, todayIsoLocal, type RequestListItem } from './api'
import { STATUS_FALLBACK, STATUS_VARIANT, TONE_ROW_CLASS, TONE_VARIANT } from './labels'

type ListResponse = { items: RequestListItem[]; total: number }
type CalendarResponse = { items: Array<{ id: string; caseNumber: string; caseSeq: number; subjectSummary: string; currentDueDate: string; deadlineTone: RequestListItem['deadlineTone']; assigneeInitials: string | null }> }

const STATUS_FILTERS = ['all', 'new', 'sent_to_departments', 'extended', 'awaiting_clarification', 'in_preparation', 'prepared', 'sent', 'left_unprocessed', 'archived']

function monthRange(anchor: Date): ScheduleRange {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 23, 59, 59)
  return { start, end }
}

function isoOf(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export default function RequestsCalendar() {
  const t = useT()
  const router = useRouter()
  const scopeVersion = useOrganizationScopeVersion()
  const currentYear = new Date().getFullYear()
  const [view, setView] = React.useState<'list' | 'month'>('list')
  const [year, setYear] = React.useState(String(currentYear))
  const [status, setStatus] = React.useState('all')
  const [search, setSearch] = React.useState('')
  const [mine, setMine] = React.useState(false)
  const [unassigned, setUnassigned] = React.useState(false)
  const [reloadKey, setReloadKey] = React.useState(0)
  const [claiming, setClaiming] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: 'public-info-requests-calendar',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const mutationContext = React.useMemo(
    () => ({ formId: 'public-info-requests-calendar', resourceKind: 'public_info_requests.request', retryLastMutation }),
    [retryLastMutation],
  )

  const claim = async (item: RequestListItem) => {
    setClaiming(item.id)
    try {
      await runMutation({
        operation: () => caseAction(item.id, 'claim', { expectedUpdatedAt: item.updatedAt }),
        context: mutationContext,
        mutationPayload: { action: 'claim', requestId: item.id },
      })
      flash(t('public_info_requests.assignee.claimed', 'You are now the officer for this request.'), 'success')
      setReloadKey((value) => value + 1)
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setClaiming(null)
    }
  }
  const [showClosed, setShowClosed] = React.useState(false)
  const [items, setItems] = React.useState<RequestListItem[]>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [scheduleRange, setScheduleRange] = React.useState<ScheduleRange>(() => monthRange(new Date()))
  const [scheduleView, setScheduleView] = React.useState<ScheduleViewMode>('month')
  const [calendarItems, setCalendarItems] = React.useState<ScheduleItem[]>([])
  const today = todayIsoLocal()

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ pageSize: '100', sortField: 'currentDueDate', sortDir: 'asc', year, source: 'manual', today })
    if (status !== 'all') params.set('status', status)
    else if (!showClosed) params.set('hideClosed', 'true')
    if (search.trim()) params.set('q', search.trim())
    if (mine) params.set('mine', 'true')
    else if (unassigned) params.set('unassigned', 'true')
    getJson<ListResponse>(`/requests?${params.toString()}`)
      .then((response) => {
        if (!cancelled) setItems(response.items ?? [])
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [year, status, search, mine, unassigned, showClosed, scopeVersion, today, reloadKey])

  React.useEffect(() => {
    if (view !== 'month') return
    let cancelled = false
    const from = isoOf(scheduleRange.start)
    const to = isoOf(scheduleRange.end)
    getJson<CalendarResponse>(`/calendar?from=${from}&to=${to}&today=${today}`)
      .then((response) => {
        if (cancelled) return
        setCalendarItems(
          response.items.map((item) => {
            const [y, m, d] = item.currentDueDate.split('-').map(Number)
            return {
              id: item.id,
              kind: 'event',
              title: `${item.caseSeq} · ${item.subjectSummary}${item.assigneeInitials ? ` (${item.assigneeInitials})` : ''}`,
              startsAt: new Date(y, m - 1, d, 9, 0),
              endsAt: new Date(y, m - 1, d, 10, 0),
              status: item.deadlineTone === 'overdue' || item.deadlineTone === 'today' ? 'cancelled' : item.deadlineTone === 'tomorrow' ? 'negotiation' : item.deadlineTone === 'done' ? 'confirmed' : 'draft',
              linkHref: `/backend/public_info_requests/${item.id}`,
              linkLabel: item.caseNumber,
            } satisfies ScheduleItem
          }),
        )
      })
      .catch(() => {
        if (!cancelled) setCalendarItems([])
      })
    return () => {
      cancelled = true
    }
  }, [view, scheduleRange, scopeVersion, today])

  const counts = React.useMemo(() => ({
    overdue: items.filter((item) => item.deadlineTone === 'overdue').length,
    today: items.filter((item) => item.deadlineTone === 'today').length,
    tomorrow: items.filter((item) => item.deadlineTone === 'tomorrow').length,
    open: items.filter((item) => item.deadlineTone !== 'done').length,
  }), [items])

  const remainingLabel = (item: RequestListItem) => {
    if (item.deadlineTone === 'done') return t('public_info_requests.calendar.done', 'done')
    if (item.deadlineTone === 'paused') return t('public_info_requests.calendar.paused', 'paused')
    if (item.deadlineTone === 'today') return t('public_info_requests.calendar.today', 'today')
    if (item.deadlineTone === 'tomorrow') return t('public_info_requests.calendar.tomorrow', 'tomorrow')
    return item.daysRemaining === null ? '—' : String(item.daysRemaining)
  }

  const years = [currentYear + 1, currentYear, currentYear - 1, currentYear - 2]

  return (
    <div className="space-y-4" data-testid="udip-calendar">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold leading-tight sm:text-2xl">{t('public_info_requests.calendar.title', 'Public-information requests')}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{t('public_info_requests.calendar.subtitle', 'Ordered by the deadline in force — the most urgent first.')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl value={view} onValueChange={(value) => setView(value as 'list' | 'month')} aria-label={t('public_info_requests.calendar.view', 'View')}>
            <SegmentedControlItem value="list">{t('public_info_requests.calendar.viewList', 'List')}</SegmentedControlItem>
            <SegmentedControlItem value="month">{t('public_info_requests.calendar.viewMonth', 'Month')}</SegmentedControlItem>
          </SegmentedControl>
          <Button asChild>
            <Link href="/backend/public_info_requests/create">{t('public_info_requests.calendar.register', 'Register request')}</Link>
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {([
          ['overdue', t('public_info_requests.calendar.kpi.overdue', 'Overdue'), 'error'],
          ['today', t('public_info_requests.calendar.kpi.today', 'Due today'), 'error'],
          ['tomorrow', t('public_info_requests.calendar.kpi.tomorrow', 'Due tomorrow'), 'warning'],
          ['open', t('public_info_requests.calendar.kpi.open', 'Open requests'), 'neutral'],
        ] as const).map(([key, label, variant]) => (
          <div key={key} className="rounded-lg border bg-card px-4 py-3">
            <div className="text-xs text-muted-foreground">{label}</div>
            <div className="mt-1 flex items-center gap-2">
              <span className="text-2xl font-semibold tabular-nums">{counts[key]}</span>
              {key !== 'open' && counts[key] > 0 ? <StatusBadge variant={variant} dot>{label}</StatusBadge> : null}
            </div>
          </div>
        ))}
      </div>

      {view === 'month' ? (
        <div className="rounded-lg border bg-card p-3">
          <ScheduleView
            items={calendarItems}
            view={scheduleView}
            range={scheduleRange}
            onRangeChange={setScheduleRange}
            onViewChange={setScheduleView}
            onItemClick={(item) => router.push(`/backend/public_info_requests/${item.id}`)}
          />
        </div>
      ) : (
        <div className="rounded-lg border bg-card">
          <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
            <div className="w-72 max-w-full">
              <SearchInput value={search} onChange={setSearch} placeholder={t('public_info_requests.calendar.search', 'Case number or subject…')} />
            </div>
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-32" aria-label={t('public_info_requests.calendar.year', 'Year')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {years.map((value) => <SelectItem key={value} value={String(value)}>{value}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="w-60" aria-label={t('public_info_requests.calendar.statusFilter', 'Status')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATUS_FILTERS.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === 'all' ? t('public_info_requests.calendar.allStatuses', 'All statuses') : t(`public_info_requests.status.${value}`, STATUS_FALLBACK[value])}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <SwitchField checked={mine} onCheckedChange={(value) => { setMine(value); if (value) setUnassigned(false) }} label={t('public_info_requests.calendar.mine', 'Only mine')} />
            <SwitchField checked={unassigned} onCheckedChange={(value) => { setUnassigned(value); if (value) setMine(false) }} label={t('public_info_requests.calendar.unassigned', 'Only unassigned')} />
            <SwitchField checked={showClosed} onCheckedChange={setShowClosed} label={t('public_info_requests.calendar.showClosed', 'Show answered')} />
          </div>
          <div className="flex flex-wrap gap-4 border-b px-4 py-2 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm bg-status-error-bg border border-status-error-border" />{t('public_info_requests.calendar.legend.urgent', 'overdue / due today')}</span>
            <span className="inline-flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm bg-status-warning-bg border border-status-warning-border" />{t('public_info_requests.calendar.legend.tomorrow', 'due tomorrow')}</span>
            <span className="inline-flex items-center gap-2"><span className="inline-block h-3 w-3 rounded-sm bg-status-info-bg border border-status-info-border" />{t('public_info_requests.calendar.legend.paused', 'clock paused (clarification)')}</span>
          </div>
          {loading ? (
            <div className="p-6"><LoadingMessage label={t('public_info_requests.common.loading', 'Loading…')} /></div>
          ) : error ? (
            <div className="p-6"><ErrorMessage label={error} /></div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 p-10 text-center">
              <p className="text-sm font-medium">{t('public_info_requests.calendar.empty', 'No requests match the criteria.')}</p>
              <Button asChild variant="outline">
                <Link href="/backend/public_info_requests/create">{t('public_info_requests.calendar.register', 'Register request')}</Link>
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12 text-right">{t('public_info_requests.calendar.col.lp', 'No.')}</TableHead>
                  <TableHead>{t('public_info_requests.calendar.col.caseNumber', 'Case number')}</TableHead>
                  <TableHead>{t('public_info_requests.calendar.col.requester', 'Requester')}</TableHead>
                  <TableHead>{t('public_info_requests.calendar.col.subject', 'Subject')}</TableHead>
                  <TableHead>{t('public_info_requests.calendar.col.received', 'Received')}</TableHead>
                  <TableHead>{t('public_info_requests.calendar.col.due', 'Deadline')}</TableHead>
                  <TableHead>{t('public_info_requests.calendar.col.remaining', 'Days left')}</TableHead>
                  <TableHead>{t('public_info_requests.calendar.col.status', 'Status')}</TableHead>
                  <TableHead>{t('public_info_requests.calendar.col.assignee', 'Officer')}</TableHead>
                  <TableHead>{t('public_info_requests.calendar.col.responded', 'Answered')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((item, index) => (
                  <TableRow
                    key={item.id}
                    data-tone={item.deadlineTone}
                    className={`cursor-pointer ${TONE_ROW_CLASS[item.deadlineTone]}`}
                    onClick={() => router.push(`/backend/public_info_requests/${item.id}`)}
                  >
                    <TableCell className="text-right tabular-nums">{index + 1}</TableCell>
                    <TableCell className="whitespace-nowrap font-mono text-xs">{item.caseNumber}</TableCell>
                    <TableCell className="max-w-48 truncate">{item.requesterName ?? '—'}</TableCell>
                    <TableCell className="max-w-72 truncate" title={item.subjectSummary}>{item.subjectSummary}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDate(item.receivedAt)}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {item.deadlineTone === 'paused' && item.clarificationDueDate
                        ? `${t('public_info_requests.calendar.replyBy', 'reply by')} ${formatDate(item.clarificationDueDate)}`
                        : formatDate(item.currentDueDate)}
                      {item.dueShiftedFrom ? <span className="ml-1 text-xs text-muted-foreground" title={t('public_info_requests.calendar.shifted', 'Moved off a weekend or public holiday (KPA art. 57 §4)')}>↷</span> : null}
                    </TableCell>
                    <TableCell><StatusBadge variant={TONE_VARIANT[item.deadlineTone]}>{remainingLabel(item)}</StatusBadge></TableCell>
                    <TableCell>
                      <StatusBadge variant={STATUS_VARIANT[item.status] ?? 'neutral'} dot>
                        {t(`public_info_requests.status.${item.status}`, STATUS_FALLBACK[item.status] ?? item.status)}
                        {item.status === 'extended' ? ' ↗' : ''}
                      </StatusBadge>
                    </TableCell>
                    <TableCell>
                      {item.assigneeInitials ? (
                        <span title={item.assigneeName ?? undefined}><Avatar label={item.assigneeName ?? item.assigneeInitials} size="sm" /></span>
                      ) : item.status === 'sent' || item.status === 'left_unprocessed' ? '—' : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={claiming === item.id}
                          onClick={(event) => { event.stopPropagation(); void claim(item) }}
                        >
                          {t('public_info_requests.assignee.claim', 'Claim')}
                        </Button>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatDate(item.respondedAt)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
