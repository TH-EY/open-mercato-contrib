"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Label } from '@open-mercato/ui/primitives/label'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Alert, AlertDescription } from '@open-mercato/ui/primitives/alert'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { formatDate, getJson, postJson } from './api'

type Settings = {
  deadlineMode: 'calendar' | 'working'
  internalDueOffsetWorkingDays: number
  clarificationDays: number
  similarityThreshold: number
  similarityWindowMonths: number
  holidays: Array<{ date: string; name: string }>
  assistant: { configured: boolean; provider: string | null; model: string | null; offline: boolean; ocr: string }
}

export default function SettingsPanel() {
  const t = useT()
  const [settings, setSettings] = React.useState<Settings | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: 'public-info-settings',
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const context = React.useMemo(() => ({ formId: 'public-info-settings', resourceKind: 'public_info_requests.settings', retryLastMutation }), [retryLastMutation])

  React.useEffect(() => {
    getJson<Settings>('/settings').then(setSettings).catch((error: unknown) => flash(error instanceof Error ? error.message : String(error), 'error'))
  }, [])

  if (!settings) return <LoadingMessage label={t('public_info_requests.common.loading', 'Loading…')} />

  const save = async () => {
    const payload = {
      deadlineMode: settings.deadlineMode,
      internalDueOffsetWorkingDays: Number(settings.internalDueOffsetWorkingDays),
      clarificationDays: Number(settings.clarificationDays),
      similarityThreshold: Number(settings.similarityThreshold),
      similarityWindowMonths: Number(settings.similarityWindowMonths),
    }
    try {
      await runMutation({ operation: () => postJson('/settings', payload, 'PUT'), context, mutationPayload: payload })
      flash(t('public_info_requests.settings.saved', 'Settings saved.'), 'success')
    } catch (error) {
      flash(error instanceof Error ? error.message : String(error), 'error')
    }
  }

  return (
    <div className="space-y-4" data-testid="udip-settings">
      <h1 className="text-xl font-semibold sm:text-2xl">{t('public_info_requests.settings.title', 'Deadlines and assistant')}</h1>
      <div className="grid gap-4 lg:grid-cols-[7fr_3fr]">
        <div className="space-y-4 rounded-lg border bg-card p-4">
          <div className="space-y-1">
            <Label>{t('public_info_requests.settings.deadlineMode', 'Counting the 14-day deadline')}</Label>
            <Select value={settings.deadlineMode} onValueChange={(value) => setSettings({ ...settings, deadlineMode: value as Settings['deadlineMode'] })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="calendar">{t('public_info_requests.settings.calendar', '14 calendar days from receipt (art. 13 UDIP, recommended)')}</SelectItem>
                <SelectItem value="working">{t('public_info_requests.settings.working', '14 working days')}</SelectItem>
              </SelectContent>
            </Select>
            {settings.deadlineMode === 'working' ? <Alert status="warning"><AlertDescription>{t('public_info_requests.settings.workingWarning', 'Working days produce later deadlines than the statute allows.')}</AlertDescription></Alert> : null}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <div className="space-y-1"><Label htmlFor="s-offset">{t('public_info_requests.settings.offset', 'Department deadline (working days before the statutory one)')}</Label><Input id="s-offset" type="number" value={settings.internalDueOffsetWorkingDays} onChange={(event) => setSettings({ ...settings, internalDueOffsetWorkingDays: Number(event.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor="s-clar">{t('public_info_requests.settings.clarificationDays', 'Days for clarification')}</Label><Input id="s-clar" type="number" value={settings.clarificationDays} onChange={(event) => setSettings({ ...settings, clarificationDays: Number(event.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor="s-thr">{t('public_info_requests.settings.threshold', 'Similarity threshold (0–1)')}</Label><Input id="s-thr" type="number" step="0.05" value={settings.similarityThreshold} onChange={(event) => setSettings({ ...settings, similarityThreshold: Number(event.target.value) })} /></div>
            <div className="space-y-1"><Label htmlFor="s-win">{t('public_info_requests.settings.window', 'Archive window (months)')}</Label><Input id="s-win" type="number" value={settings.similarityWindowMonths} onChange={(event) => setSettings({ ...settings, similarityWindowMonths: Number(event.target.value) })} /></div>
          </div>
          <div className="flex justify-end"><Button type="button" onClick={() => { void save() }}>{t('public_info_requests.common.save', 'Save')}</Button></div>
        </div>
        <div className="space-y-4">
          <div className="space-y-2 rounded-lg border bg-card p-4 text-sm">
            <div className="font-medium">{t('public_info_requests.settings.assistant', 'Assistant environment')}</div>
            <StatusBadge variant={settings.assistant.offline ? 'success' : 'warning'}>{settings.assistant.offline ? t('public_info_requests.settings.offline', 'Offline / local') : t('public_info_requests.settings.online', 'External provider')}</StatusBadge>
            <div className="text-xs text-muted-foreground">{t('public_info_requests.settings.provider', 'Model')}: {settings.assistant.configured ? `${settings.assistant.provider ?? '—'} ${settings.assistant.model ?? ''}` : t('public_info_requests.settings.deterministic', 'not configured — deterministic mode (rules, keywords, templates)')}</div>
            <div className="text-xs text-muted-foreground">OCR: {settings.assistant.ocr}</div>
          </div>
          <div className="space-y-1 rounded-lg border bg-card p-4 text-xs">
            <div className="text-sm font-medium">{t('public_info_requests.settings.holidays', 'Public holidays')}</div>
            {settings.holidays.map((holiday) => <div key={holiday.date}>{formatDate(holiday.date)} — {holiday.name}</div>)}
          </div>
        </div>
      </div>
    </div>
  )
}
