import { test, expect, type APIRequestContext } from '@playwright/test';
import { getAuthToken, apiRequest } from '@open-mercato/core/modules/core/__integration__/helpers/api';
import { readJsonSafe } from '@open-mercato/core/modules/core/__integration__/helpers/crmFixtures';
import {
  submitTextExtraction,
  waitForEmailProcessed,
  deleteInboxEmail,
  fetchProposalDetail,
  type InboxProposalActionDetail,
} from '@open-mercato/core/modules/core/__integration__/helpers/inboxFixtures';
import { deleteSalesEntityIfExists } from '@open-mercato/core/modules/core/__integration__/helpers/salesFixtures';

/**
 * TC-INBOX-011: Order line unit of measure and confidence
 *
 * An order/quote action's line items carry an optional unit of measure and
 * confidence. The edit route validates both, the proposal API returns them, and
 * accepting the action creates sales lines with the unit stored in
 * `quantity_unit`. The line items are set through the edit route so the
 * assertions do not depend on what the model extracted.
 *
 * Extraction requires a configured LLM provider. When none is available, or the
 * model proposes no order/quote action, the test is skipped, matching TC-INBOX-003.
 */

type JsonRecord = Record<string, unknown>;

function readItems(body: unknown): JsonRecord[] {
  if (Array.isArray(body)) return body as JsonRecord[];
  if (body && typeof body === 'object' && Array.isArray((body as { items?: unknown }).items)) {
    return (body as { items: JsonRecord[] }).items;
  }
  return [];
}

async function createChannel(request: APIRequestContext, token: string, name: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/sales/channels', {
    token,
    data: { name, code: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), isActive: true },
  });
  expect(response.ok(), `Failed to create channel ${name}: ${response.status()}`).toBeTruthy();
  const body = await readJsonSafe<{ id?: string }>(response);
  expect(body?.id, `No id returned when creating channel ${name}`).toBeTruthy();
  return body!.id as string;
}

function findOrderAction(actions: InboxProposalActionDetail[]): InboxProposalActionDetail | null {
  return actions.find((action) =>
    action.status === 'pending' && (action.actionType === 'create_order' || action.actionType === 'create_quote'),
  ) ?? null;
}

test.describe('TC-INBOX-011: Order line unit of measure and confidence', () => {
  let token: string;
  const createdEmailIds: string[] = [];
  const createdDocuments: Array<{ path: string; id: string }> = [];
  const createdChannelIds: string[] = [];

  test.beforeAll(async ({ request }) => {
    test.setTimeout(90000);
    token = await getAuthToken(request, 'admin');
  });

  test.afterAll(async ({ request }) => {
    for (const document of createdDocuments) {
      await deleteSalesEntityIfExists(request, token, document.path, document.id);
    }
    for (const channelId of createdChannelIds) {
      await deleteSalesEntityIfExists(request, token, '/api/sales/channels', channelId);
    }
    for (const emailId of createdEmailIds) {
      await deleteInboxEmail(request, token, emailId);
    }
  });

  test('validates, returns and executes line units and confidence', async ({ request }) => {
    test.setTimeout(90000);

    const result = await submitTextExtraction(request, token, {
      text: [
        'From: Marta Nowak <marta@nowak-budownictwo.pl>',
        'Subject: Order PO-TC011',
        '',
        'Hello,',
        'We confirm the order, please go ahead:',
        '- 12 kg Steel Wire SW-2 at $3.50 per kg',
        '- 40 m2 Floor Tiles FT-60 at $18.00 per m2',
        '',
        'Customer reference: PO-TC011',
        '',
        'Regards,',
        'Marta Nowak',
      ].join('\n'),
      title: 'TC-INBOX-011 line unit fixture',
    });

    expect(result.ok).toBe(true);
    if (result.emailId) createdEmailIds.push(result.emailId);

    const processed = await waitForEmailProcessed(request, token, result.emailId!, 45000);
    if (!processed || processed.status === 'failed' || !processed.proposalId) {
      test.skip(true, 'LLM extraction unavailable (no API key configured)');
      return;
    }

    const proposalId = processed.proposalId;
    const detail = await fetchProposalDetail(request, token, proposalId);
    const action = findOrderAction(detail?.actions ?? []);
    if (!action) {
      test.skip(true, 'Model proposed no order or quote action for the fixture');
      return;
    }
    const actionPath = `/api/inbox_ops/proposals/${proposalId}/actions/${action.id}`;

    const invalidEdit = await apiRequest(request, 'PATCH', actionPath, {
      token,
      data: { payload: { lineItems: [{ productName: 'TC-INBOX-011 Steel Wire', quantity: '12', confidence: 1.5 }] } },
    });
    expect(invalidEdit.status()).toBe(400);

    const channelId = await createChannel(request, token, `TC-INBOX-011 ${Date.now()}`);
    createdChannelIds.push(channelId);

    const lineItems = [
      { productName: 'TC-INBOX-011 Steel Wire', quantity: '12', quantityUnit: 'kg', unitPrice: '3.5', kind: 'service', confidence: 0.9 },
      { productName: 'TC-INBOX-011 Delivery', quantity: '1', unitPrice: '20', kind: 'service' },
    ];
    const editResponse = await apiRequest(request, 'PATCH', actionPath, {
      token,
      data: {
        payload: {
          customerName: 'TC-INBOX-011 Customer',
          currencyCode: 'USD',
          channelId,
          lineItems,
        },
      },
    });
    expect(editResponse.status()).toBe(200);

    const afterEdit = await fetchProposalDetail(request, token, proposalId);
    const editedAction = afterEdit?.actions.find((candidate) => candidate.id === action.id);
    const editedLines = (editedAction?.payload?.lineItems ?? []) as JsonRecord[];
    expect(editedLines[0]?.quantityUnit).toBe('kg');
    expect(editedLines[0]?.confidence).toBe(0.9);
    expect(editedLines[1]).not.toHaveProperty('quantityUnit');

    const acceptResponse = await apiRequest(request, 'POST', `${actionPath}/accept`, { token });
    const acceptBody = await readJsonSafe<{ action?: { createdEntityId?: string; createdEntityType?: string } }>(acceptResponse);
    expect(acceptResponse.status(), JSON.stringify(acceptBody)).toBe(200);
    const createdEntityId = acceptBody?.action?.createdEntityId;
    const createdEntityType = acceptBody?.action?.createdEntityType;
    expect(createdEntityId).toBeTruthy();
    expect(['sales_order', 'sales_quote']).toContain(createdEntityType);

    const isOrder = createdEntityType === 'sales_order';
    createdDocuments.push({ path: isOrder ? '/api/sales/orders' : '/api/sales/quotes', id: createdEntityId! });

    const linesPath = isOrder
      ? `/api/sales/order-lines?orderId=${encodeURIComponent(createdEntityId!)}&page=1&pageSize=50`
      : `/api/sales/quote-lines?quoteId=${encodeURIComponent(createdEntityId!)}&page=1&pageSize=50`;
    const linesResponse = await apiRequest(request, 'GET', linesPath, { token });
    expect(linesResponse.ok(), `Failed to read lines: ${linesResponse.status()}`).toBeTruthy();
    const lines = readItems(await readJsonSafe<unknown>(linesResponse));
    const wireLine = lines.find((line) => line.name === 'TC-INBOX-011 Steel Wire');
    const deliveryLine = lines.find((line) => line.name === 'TC-INBOX-011 Delivery');
    expect(wireLine, 'Steel wire line should be created').toBeTruthy();
    expect(wireLine?.quantity_unit ?? wireLine?.quantityUnit).toBe('kg');
    expect(deliveryLine?.quantity_unit ?? deliveryLine?.quantityUnit ?? null).toBeNull();
  });
});
