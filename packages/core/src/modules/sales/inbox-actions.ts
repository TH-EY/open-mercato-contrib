import type { InboxActionDefinition, InboxActionExecutionContext } from '@open-mercato/shared/modules/inbox-actions'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { toUnitLookupKey } from '@open-mercato/shared/lib/units/unitCodes'
import { orderPayloadSchema, updateOrderPayloadSchema, updateShipmentPayloadSchema } from '../inbox_ops/data/validators'
import type { OrderPayload, UpdateOrderPayload, UpdateShipmentPayload } from '../inbox_ops/data/validators'
import {
  asHelperContext,
  ExecutionError,
  executeCommand,
  buildSourceMetadata,
  resolveOrderByReference,
  resolveFirstChannelId,
  resolveEffectiveDocumentKind,
  resolveShipmentStatusEntryId,
  resolveCustomerEntityIdByEmail,
  resolveEntityClass,
  normalizeAddressSnapshot,
  parseDateToken,
  parseNumberToken,
  loadOrderLineItems,
  matchLineItemByName,
} from '../inbox_ops/lib/executionHelpers'
import type { ExecutionHelperContext } from '../inbox_ops/lib/executionHelpers'

type OrderLineItem = OrderPayload['lineItems'][number]

const UOM_ERROR_MESSAGES: Record<string, string> = {
  'uom.unit_not_found': 'A line unit of measure is not in the units dictionary. Add the unit to the dictionary or change the line unit.',
  'uom.conversion_not_found': "A line unit of measure has no conversion to its product's base unit. Add a unit conversion to the product or change the line unit.",
  'uom.default_unit_missing': 'A line product has no base unit of measure. Set the base unit on the product or remove the line unit.',
}

async function loadProductBaseUnits(
  hCtx: ExecutionHelperContext,
  lines: OrderLineItem[],
): Promise<Map<string, string | null>> {
  const baseUnits = new Map<string, string | null>()
  const productIds = Array.from(new Set(
    lines
      .filter((line) => line.productId && line.quantityUnit)
      .map((line) => line.productId as string),
  ))
  const CatalogProductClass = productIds.length > 0 ? resolveEntityClass(hCtx, 'CatalogProduct') : null
  if (!CatalogProductClass) return baseUnits

  const scope = { tenantId: hCtx.tenantId, organizationId: hCtx.organizationId }
  const products = await findWithDecryption(
    hCtx.em,
    CatalogProductClass,
    { id: { $in: productIds }, ...scope, deletedAt: null },
    undefined,
    scope,
  )
  for (const product of products) {
    baseUnits.set(product.id, toUnitLookupKey(product.defaultUnit))
  }
  return baseUnits
}

function resolveSalesLineUnit(line: OrderLineItem, productBaseUnits: Map<string, string | null>): string | undefined {
  if (!line.quantityUnit) return undefined
  if (line.productId && productBaseUnits.get(line.productId) === null) return undefined
  return line.quantityUnit
}

async function executeDocumentCreate<TResult>(
  hCtx: ExecutionHelperContext,
  commandId: string,
  input: Record<string, unknown>,
): Promise<TResult> {
  try {
    return await executeCommand<Record<string, unknown>, TResult>(hCtx, commandId, input)
  } catch (err) {
    const code = isCrudHttpError(err) && typeof err.body?.error === 'string' ? err.body.error : null
    if (code && code.startsWith('uom.')) {
      const message = UOM_ERROR_MESSAGES[code] ?? 'A line unit of measure cannot be applied.'
      throw new ExecutionError(`${message} (${code})`, 400)
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// create_order
// ---------------------------------------------------------------------------

async function executeCreateDocumentAction(
  action: { id: string; proposalId: string; payload: unknown },
  ctx: InboxActionExecutionContext,
  kind: 'order' | 'quote',
): Promise<{ createdEntityId?: string | null; createdEntityType?: string | null }> {
  const hCtx = asHelperContext(ctx)
  const payload = action.payload as OrderPayload

  let resolvedChannelId: string | undefined = payload.channelId
  if (!resolvedChannelId) {
    resolvedChannelId = (await resolveFirstChannelId(hCtx)) ?? undefined
    if (!resolvedChannelId) {
      throw new ExecutionError('No sales channel available. Create a channel first or set channelId in the payload.', 400)
    }
  }

  const currencyCode = payload.currencyCode.trim().toUpperCase()
  const productBaseUnits = await loadProductBaseUnits(hCtx, payload.lineItems)
  const lines = payload.lineItems.map((line, index) => {
    const quantity = parseNumberToken(line.quantity, `lineItems[${index}].quantity`)
    const unitPrice = line.unitPrice
      ? parseNumberToken(line.unitPrice, `lineItems[${index}].unitPrice`)
      : undefined

    const mappedLine: Record<string, unknown> = {
      lineNumber: index + 1,
      kind: line.kind ?? (line.productId ? 'product' : 'service'),
      name: line.productName,
      description: line.description,
      quantity,
      currencyCode,
    }

    if (line.productId) mappedLine.productId = line.productId
    if (line.variantId) mappedLine.productVariantId = line.variantId
    const quantityUnit = resolveSalesLineUnit(line, productBaseUnits)
    if (quantityUnit) mappedLine.quantityUnit = quantityUnit
    if (unitPrice !== undefined) mappedLine.unitPriceNet = unitPrice
    if (line.sku || line.catalogPrice) {
      mappedLine.catalogSnapshot = {
        sku: line.sku ?? null,
        catalogPrice: line.catalogPrice ?? null,
      }
    }

    return mappedLine
  })

  const metadata = buildSourceMetadata(action.id, action.proposalId)

  let resolvedCustomerEntityId = payload.customerEntityId
  if (!resolvedCustomerEntityId && payload.customerEmail) {
    resolvedCustomerEntityId = (await resolveCustomerEntityIdByEmail(hCtx, payload.customerEmail)) ?? undefined
  }

  const createInput: Record<string, unknown> = {
    organizationId: hCtx.organizationId,
    tenantId: hCtx.tenantId,
    customerEntityId: resolvedCustomerEntityId,
    customerReference: payload.customerReference,
    channelId: resolvedChannelId,
    currencyCode,
    taxRateId: payload.taxRateId,
    comments: payload.notes,
    metadata,
    lines,
  }

  if (!resolvedCustomerEntityId) {
    createInput.customerSnapshot = {
      displayName: payload.customerName,
      ...(payload.customerEmail && { primaryEmail: payload.customerEmail }),
    }
  }

  const normalizedBilling = payload.billingAddress
    ? normalizeAddressSnapshot(payload.billingAddress)
    : undefined
  const normalizedShipping = payload.shippingAddress
    ? normalizeAddressSnapshot(payload.shippingAddress)
    : undefined

  if (normalizedShipping || normalizedBilling) {
    createInput.shippingAddressSnapshot = normalizedShipping ?? normalizedBilling
    createInput.billingAddressSnapshot = normalizedBilling ?? normalizedShipping
  } else if (payload.billingAddressId || payload.shippingAddressId) {
    createInput.billingAddressId = payload.billingAddressId ?? payload.shippingAddressId
    createInput.shippingAddressId = payload.shippingAddressId ?? payload.billingAddressId
  }

  const requestedDeliveryAt = parseDateToken(payload.requestedDeliveryDate ?? undefined)
  if (requestedDeliveryAt) {
    createInput.expectedDeliveryAt = requestedDeliveryAt
  }

  const effectiveKind = kind === 'order'
    ? await resolveEffectiveDocumentKind(hCtx, resolvedChannelId)
    : kind

  if (effectiveKind === 'order') {
    const result = await executeDocumentCreate<{ orderId?: string }>(hCtx, 'sales.orders.create', createInput)
    if (!result.orderId) {
      throw new ExecutionError('Order creation did not return an order ID', 500)
    }
    return { createdEntityId: result.orderId, createdEntityType: 'sales_order' }
  }

  const result = await executeDocumentCreate<{ quoteId?: string }>(hCtx, 'sales.quotes.create', createInput)
  if (!result.quoteId) {
    throw new ExecutionError('Quote creation did not return a quote ID', 500)
  }
  return { createdEntityId: result.quoteId, createdEntityType: 'sales_quote' }
}

// ---------------------------------------------------------------------------
// update_order
// ---------------------------------------------------------------------------

async function executeUpdateOrderAction(
  action: { id: string; proposalId: string; payload: unknown },
  ctx: InboxActionExecutionContext,
): Promise<{ createdEntityId?: string | null; createdEntityType?: string | null }> {
  const hCtx = asHelperContext(ctx)
  const payload = action.payload as UpdateOrderPayload

  const order = await resolveOrderByReference(hCtx, payload.orderId, payload.orderNumber)

  const updateInput: Record<string, unknown> = {
    id: order.id,
    organizationId: hCtx.organizationId,
    tenantId: hCtx.tenantId,
  }

  const newDeliveryDate = parseDateToken(payload.deliveryDateChange?.newDate)
  if (newDeliveryDate) {
    updateInput.expectedDeliveryAt = newDeliveryDate
  }

  const noteLines = payload.noteAdditions?.map((note) => note.trim()).filter((note) => note.length > 0) ?? []
  if (noteLines.length > 0) {
    const mergedNotes = [order.comments ?? null, ...noteLines].filter(Boolean).join('\n')
    updateInput.comments = mergedNotes
  }

  if (Object.keys(updateInput).length > 3) {
    await executeCommand<Record<string, unknown>, { orderId?: string }>(
      hCtx,
      'sales.orders.update',
      updateInput,
    )
  }

  const quantityChanges = payload.quantityChanges ?? []
  const orderLines = quantityChanges.length > 0 && quantityChanges.some((qc) => !qc.lineItemId)
    ? await loadOrderLineItems(hCtx, order.id)
    : []

  for (const quantityChange of quantityChanges) {
    let lineItemId = quantityChange.lineItemId
    if (!lineItemId) {
      const matched = matchLineItemByName(orderLines, quantityChange.lineItemName)
      if (matched) {
        lineItemId = matched
      } else {
        const availableNames = orderLines.map((l) => l.name).filter(Boolean).join(', ')
        throw new ExecutionError(
          `Cannot resolve line item "${quantityChange.lineItemName}". Available line items: ${availableNames || 'none'}`,
          400,
        )
      }
    }

    await executeCommand<{ body: Record<string, unknown> }, { orderId?: string; lineId?: string }>(
      hCtx,
      'sales.orders.lines.upsert',
      {
        body: {
          id: lineItemId,
          orderId: order.id,
          organizationId: hCtx.organizationId,
          tenantId: hCtx.tenantId,
          quantity: parseNumberToken(quantityChange.newQuantity, 'quantityChanges.newQuantity'),
          currencyCode: order.currencyCode,
        },
      },
    )
  }

  return { createdEntityId: order.id, createdEntityType: 'sales_order' }
}

// ---------------------------------------------------------------------------
// update_shipment
// ---------------------------------------------------------------------------

async function executeUpdateShipmentAction(
  action: { id: string; proposalId: string; payload: unknown },
  ctx: InboxActionExecutionContext,
): Promise<{ createdEntityId?: string | null; createdEntityType?: string | null }> {
  const hCtx = asHelperContext(ctx)
  const payload = action.payload as UpdateShipmentPayload

  const order = await resolveOrderByReference(hCtx, payload.orderId, payload.orderNumber)

  const SalesShipmentClass = resolveEntityClass(hCtx, 'SalesShipment')
  if (!SalesShipmentClass) {
    throw new ExecutionError('Sales module entities not available', 503)
  }

  const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')

  const shipment = await findOneWithDecryption(
    hCtx.em,
    SalesShipmentClass,
    {
      order: order.id,
      tenantId: hCtx.tenantId,
      organizationId: hCtx.organizationId,
      deletedAt: null,
    },
    { orderBy: { createdAt: 'DESC' } },
    { tenantId: hCtx.tenantId, organizationId: hCtx.organizationId },
  )

  if (!shipment) {
    throw new ExecutionError('No shipment found for the referenced order', 404)
  }

  const statusEntryId = await resolveShipmentStatusEntryId(hCtx, payload.statusLabel)
  if (!statusEntryId) {
    throw new ExecutionError(`Shipment status "${payload.statusLabel}" not found`, 400)
  }

  const updateInput: Record<string, unknown> = {
    id: shipment.id,
    orderId: order.id,
    organizationId: hCtx.organizationId,
    tenantId: hCtx.tenantId,
    statusEntryId,
  }

  if (payload.trackingNumbers) updateInput.trackingNumbers = payload.trackingNumbers
  if (payload.carrierName) updateInput.carrierName = payload.carrierName
  if (payload.notes) updateInput.notes = payload.notes

  const shippedAt = parseDateToken(payload.shippedAt)
  const deliveredAt = parseDateToken(payload.deliveredAt)
  if (shippedAt) updateInput.shippedAt = shippedAt
  if (deliveredAt) updateInput.deliveredAt = deliveredAt

  await executeCommand<Record<string, unknown>, { shipmentId?: string }>(
    hCtx,
    'sales.shipments.update',
    updateInput,
  )

  return { createdEntityId: shipment.id, createdEntityType: 'sales_shipment' }
}

// ---------------------------------------------------------------------------
// Exported action definitions
// ---------------------------------------------------------------------------

export const inboxActions: InboxActionDefinition[] = [
  {
    type: 'create_order',
    requiredFeature: 'sales.orders.manage',
    payloadSchema: orderPayloadSchema,
    label: 'Create Sales Order',
    promptSchema: `create_order / create_quote payload:
{ customerName: string, customerEmail?: string, customerEntityId?: uuid, channelId?: uuid, currencyCode: string (3-letter ISO), taxRateId?: uuid, lineItems: [{ productName: string (REQUIRED), productId?: uuid, variantId?: uuid, sku?: string, quantity: string, quantityUnit?: string (unit of measure code), unitPrice?: string, kind?: "product"|"service", description?: string, confidence?: number (0.0-1.0) }], requestedDeliveryDate?: string, notes?: string, customerReference?: string (customer's own PO number or reference code — only set if explicitly stated in the email, do NOT use the email subject), shippingAddress?: { line1?: string, line2?: string, city?: string, state?: string, postalCode?: string, country?: string, company?: string, contactName?: string }, billingAddress?: { line1?: string, line2?: string, city?: string, state?: string, postalCode?: string, country?: string, company?: string, contactName?: string } }`,
    promptRules: [
      'ALWAYS propose a create_order or create_quote action when the customer expresses interest in buying, even if some product names are uncertain or not in the catalog. Use the best product name available; the system will flag unmatched products as discrepancies. Do NOT replace an order with a draft_reply asking for clarification — propose both if needed.',
      'Use create_order when the customer has clearly confirmed they want to proceed (e.g., "let\'s go ahead", "please process", "confirmed"). Use create_quote when the customer is still inquiring, requesting pricing, asking for a proposal, or negotiating (e.g., "could you send a quote", "what would it cost", "we\'re interested in", "can you offer"). When in doubt, prefer create_quote.',
      'For create_order / create_quote: each line item MUST have "productName" (the product name goes here, NOT in "description"). Include currencyCode and customerName.',
      'For create_order / create_quote: extract shippingAddress and billingAddress as structured objects when addresses are mentioned. Parse street, city, postal code, country from the text. Do NOT put address data in notes.',
      'For create_order / create_quote: when a line states a unit of measure (e.g. "pcs", "kg", "m²", "bags", "t"), set "quantityUnit" to the matching code from the units of measure list; if no listed code matches, set it to the unit exactly as written. Omit "quantityUnit" when no unit is stated. Never convert the quantity into another unit.',
      'For create_order / create_quote: set "confidence" on every line item in [0.0, 1.0] — how certain you are that its product, quantity and unit are read correctly.',
    ],
    execute: (action, ctx) => executeCreateDocumentAction(action, ctx, 'order'),
  },
  {
    type: 'create_quote',
    requiredFeature: 'sales.quotes.manage',
    payloadSchema: orderPayloadSchema,
    label: 'Create Quote',
    promptSchema: '(shared with create_order)',
    execute: (action, ctx) => executeCreateDocumentAction(action, ctx, 'quote'),
  },
  {
    type: 'update_order',
    requiredFeature: 'sales.orders.manage',
    payloadSchema: updateOrderPayloadSchema,
    label: 'Update Order',
    promptSchema: `update_order payload:
{ orderId?: uuid, orderNumber?: string, quantityChanges?: [{ lineItemName: string, lineItemId?: uuid, oldQuantity?: string, newQuantity: string }], deliveryDateChange?: { oldDate?: string, newDate: string }, noteAdditions?: string[] }`,
    execute: executeUpdateOrderAction,
  },
  {
    type: 'update_shipment',
    requiredFeature: 'sales.shipments.manage',
    payloadSchema: updateShipmentPayloadSchema,
    label: 'Update Shipment',
    promptSchema: `update_shipment payload:
{ orderId?: uuid, orderNumber?: string, trackingNumbers?: string[], carrierName?: string, statusLabel: string, shippedAt?: string, deliveredAt?: string, estimatedDelivery?: string, notes?: string }`,
    promptRules: ['For update_shipment: use statusLabel text only.'],
    execute: executeUpdateShipmentAction,
  },
]

export default inboxActions
