"use client"
import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { caseAction } from '../api'

export function useCaseMutation(requestId: string, onDone: () => Promise<void> | void) {
  const t = useT()
  const [pending, setPending] = React.useState<string | null>(null)
  const { runMutation, retryLastMutation } = useGuardedMutation<{ formId: string; resourceKind: string; retryLastMutation: () => Promise<boolean> }>({
    contextId: `public-info-request-${requestId}`,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })
  const context = React.useMemo(
    () => ({ formId: `public-info-request-${requestId}`, resourceKind: 'public_info_requests.request', retryLastMutation }),
    [requestId, retryLastMutation],
  )
  const run = React.useCallback(
    async <T = Record<string, unknown>>(action: string, payload: Record<string, unknown> = {}, successMessage?: string): Promise<T | null> => {
      setPending(action)
      try {
        const result = await runMutation({
          operation: () => caseAction<T>(requestId, action, payload),
          context,
          mutationPayload: { action, ...payload },
        })
        if (successMessage) flash(successMessage, 'success')
        await onDone()
        return result
      } catch (error) {
        flash(error instanceof Error ? error.message : String(error), 'error')
        return null
      } finally {
        setPending(null)
      }
    },
    [requestId, runMutation, context, onDone],
  )
  return { run, pending }
}
