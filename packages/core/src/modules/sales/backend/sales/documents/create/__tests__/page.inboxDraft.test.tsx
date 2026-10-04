/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { act } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import CreateSalesDocumentPage from '../page'

const apiCallMock = jest.fn()
const routerPushMock = jest.fn()
let capturedOnCreated: ((params: { id: string; kind: 'order' | 'quote' }) => Promise<void>) | undefined

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: routerPushMock }),
  useSearchParams: () => new URLSearchParams('kind=quote&fromInboxAction=action-1'),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
}))

const flashMock = jest.fn()
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({
  flash: (...args: unknown[]) => flashMock(...args),
}))

jest.mock('../../../../../components/documents/SalesDocumentForm', () => ({
  SalesDocumentForm: ({ onCreated }: { onCreated: typeof capturedOnCreated }) => {
    capturedOnCreated = onCreated
    return <div data-testid="sales-document-form" />
  },
}))

describe('CreateSalesDocumentPage inbox quote draft', () => {
  beforeEach(() => {
    flashMock.mockReset()
    apiCallMock.mockReset()
    apiCallMock.mockResolvedValue({ ok: true, result: {} })
    capturedOnCreated = undefined
    sessionStorage.setItem('inbox_ops.orderDraft', JSON.stringify({
      actionId: 'action-1',
      proposalId: 'proposal-1',
      payload: {
        currencyCode: 'eur',
        lineItems: [
          { productName: 'Cement', quantity: '10', quantityUnit: 'bag' },
          { productName: 'Sand', quantity: '2' },
        ],
      },
    }))
  })

  it('creates the quote lines with the unit each inbox line carries', async () => {
    renderWithProviders(<CreateSalesDocumentPage />)
    expect(capturedOnCreated).toBeDefined()

    await act(async () => {
      await capturedOnCreated!({ id: 'quote-1', kind: 'quote' })
    })

    const lineBodies = apiCallMock.mock.calls
      .filter(([url]) => url === '/api/sales/quote-lines')
      .map(([, init]) => JSON.parse((init as { body: string }).body) as Record<string, unknown>)
    expect(lineBodies).toHaveLength(2)
    expect(lineBodies[0]).toEqual(expect.objectContaining({ quoteId: 'quote-1', name: 'Cement', quantityUnit: 'bag' }))
    expect(lineBodies[1]).not.toHaveProperty('quantityUnit')
    expect(flashMock).not.toHaveBeenCalled()
  })

  it('adds a line without its unit when the unit is rejected, and says so', async () => {
    apiCallMock.mockImplementation(async (url: string, init?: { body?: string }) => {
      const body = init?.body ? JSON.parse(init.body) as Record<string, unknown> : {}
      if (url === '/api/sales/quote-lines' && body.quantityUnit === 'bag') {
        return { ok: false, status: 400, result: { error: 'uom.unit_not_found' } }
      }
      return { ok: true, status: 200, result: {} }
    })
    renderWithProviders(<CreateSalesDocumentPage />)

    await act(async () => {
      await capturedOnCreated!({ id: 'quote-1', kind: 'quote' })
    })

    const cementBodies = apiCallMock.mock.calls
      .filter(([url]) => url === '/api/sales/quote-lines')
      .map(([, init]) => JSON.parse((init as { body: string }).body) as Record<string, unknown>)
      .filter((body) => body.name === 'Cement')
    expect(cementBodies).toHaveLength(2)
    expect(cementBodies[1]).not.toHaveProperty('quantityUnit')
    expect(flashMock).toHaveBeenCalledWith('Some lines were added without their unit of measure: Cement', 'warning')
  })
})
