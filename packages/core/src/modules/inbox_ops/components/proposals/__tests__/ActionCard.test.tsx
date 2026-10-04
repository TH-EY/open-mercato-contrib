/**
 * @jest-environment jsdom
 */
import * as React from 'react'
import { fireEvent, screen } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { ActionCard, useDiscrepancyDescriptions } from '../ActionCard'
import type { ActionDetail, DiscrepancyDetail } from '../types'

function makeAction(overrides: Partial<ActionDetail> = {}): ActionDetail {
  return {
    id: 'action-1',
    proposalId: 'proposal-1',
    sortOrder: 0,
    actionType: 'create_order',
    description: 'Create sales order',
    payload: {},
    status: 'pending',
    confidence: '0.95',
    ...overrides,
  }
}

function renderCard(action: ActionDetail, handlers: Partial<Record<'onAccept' | 'onReject' | 'onRetry' | 'onEdit', jest.Mock>> = {}) {
  const onAccept = handlers.onAccept ?? jest.fn()
  const onReject = handlers.onReject ?? jest.fn()
  const onRetry = handlers.onRetry ?? jest.fn()
  const onEdit = handlers.onEdit ?? jest.fn()
  renderWithProviders(
    <ActionCard
      action={action}
      discrepancies={[]}
      actionTypeLabels={{ create_order: 'Create Sales Order' }}
      onAccept={onAccept}
      onReject={onReject}
      onRetry={onRetry}
      onEdit={onEdit}
    />,
  )
  return { onAccept, onReject, onRetry, onEdit }
}

describe('ActionCard status visibility', () => {
  it('renders Accept / Edit / Reject buttons for a pending action', () => {
    renderCard(makeAction({ status: 'pending' }))
    expect(screen.getByRole('button', { name: /Accept/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument()
  })

  it('shows an "Accepted" status badge and hides all action buttons for an accepted action', () => {
    renderCard(makeAction({ status: 'accepted' }))
    expect(screen.getByText('Accepted')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Accept/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Reject/i })).not.toBeInTheDocument()
  })

  it('shows a "Processing" status badge and hides all action buttons for a processing action', () => {
    renderCard(makeAction({ status: 'processing' }))
    expect(screen.getByText('Processing')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('keeps Retry / Edit / Reject available for a failed action', () => {
    renderCard(makeAction({ status: 'failed', executionError: 'boom' }))
    expect(screen.getByRole('button', { name: /Retry/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Edit/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reject/i })).toBeInTheDocument()
  })

  it('renders no action buttons for an executed action', () => {
    renderCard(makeAction({ status: 'executed', createdEntityId: 'order-1', createdEntityType: 'sales_order' }))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('never fires an accept mutation because accepted actions expose no clickable buttons', () => {
    const { onAccept } = renderCard(makeAction({ status: 'accepted' }))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(onAccept).not.toHaveBeenCalled()
  })

  it('still lets a pending action be accepted', () => {
    const onAccept = jest.fn()
    renderCard(makeAction({ status: 'pending' }), { onAccept })
    fireEvent.click(screen.getByRole('button', { name: /Accept/i }))
    expect(onAccept).toHaveBeenCalledWith('action-1')
  })
})

describe('ActionCard order preview line units and confidence', () => {
  const orderPayload = {
    customerName: 'Acme',
    currencyCode: 'EUR',
    lineItems: [
      { productName: 'Cement', quantity: '10', quantityUnit: 'bag', unitPrice: '12', confidence: 0.92 },
      { productName: 'Sand', quantity: '2', quantityUnit: 't', confidence: 0.45 },
      { productName: 'Gravel', quantity: '1' },
    ],
  }

  it('shows each line unit after the quantity', () => {
    renderCard(makeAction({ payload: orderPayload }))
    expect(screen.getByText('10 bag')).toBeInTheDocument()
    expect(screen.getByText('2 t')).toBeInTheDocument()
  })

  it('adds a confidence column colored by the confidence thresholds', () => {
    renderCard(makeAction({ payload: orderPayload }))
    expect(screen.getByRole('columnheader', { name: 'Confidence' })).toBeInTheDocument()
    expect(screen.getByText('92%')).toHaveClass('text-status-success-text')
    expect(screen.getByText('45%')).toHaveClass('text-status-error-text')
  })

  it('hides a line confidence outside the 0-1 range', () => {
    renderCard(makeAction({
      payload: { customerName: 'Acme', currencyCode: 'EUR', lineItems: [{ productName: 'Widget', quantity: '5', confidence: 90 }] },
    }))
    expect(screen.queryByText('9000%')).not.toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Confidence' })).not.toBeInTheDocument()
  })

  it('keeps the preview of a payload without units or line confidence unchanged', () => {
    renderCard(makeAction({
      payload: { customerName: 'Acme', currencyCode: 'EUR', lineItems: [{ productName: 'Widget', quantity: '5' }] },
    }))
    expect(screen.getByRole('cell', { name: '5' })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: 'Confidence' })).not.toBeInTheDocument()
  })
})

describe('ActionCard unit discrepancy', () => {
  function CardWithResolvedDiscrepancies({ discrepancies }: { discrepancies: DiscrepancyDetail[] }) {
    const resolveDiscrepancyDescription = useDiscrepancyDescriptions()
    return (
      <ActionCard
        action={makeAction()}
        discrepancies={discrepancies}
        actionTypeLabels={{ create_order: 'Create Sales Order' }}
        onAccept={jest.fn()}
        onReject={jest.fn()}
        onRetry={jest.fn()}
        onEdit={jest.fn()}
        resolveDiscrepancyDescription={resolveDiscrepancyDescription}
      />
    )
  }

  it('describes an unrecognized unit together with the unit found in the email', () => {
    renderWithProviders(
      <CardWithResolvedDiscrepancies
        discrepancies={[{
          id: 'd-1',
          type: 'quantity_mismatch',
          severity: 'error',
          description: 'inbox_ops.discrepancy.desc.unit_not_recognized',
          foundValue: 't',
          resolved: false,
          actionId: 'action-1',
        }]}
      />,
    )
    expect(screen.getByText('Unit of measure not found in the units dictionary')).toBeInTheDocument()
    expect(screen.getByText(/Found: t$/)).toBeInTheDocument()
  })
})
