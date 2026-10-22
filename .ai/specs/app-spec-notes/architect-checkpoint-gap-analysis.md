# Architect Checkpoint — App Spec: Xero Integration (§ 3, 3.5, 4, 4.5)

Reviewed: /workspace/.ai/specs/2026-09-26-app-spec-xero-integration.md, initial draft. Verified directly against the repository, not the spec's own claims.

## Platform-claim verification

| Claim | Verdict | Evidence |
|---|---|---|
| (a) No generic OAuth flow exists anywhere except bespoke Gmail/`communication_channels` | **WRONG (overstated)** — the route layer genuinely is bespoke, but `oauth-token.ts` (`requestOAuthToken`, `tokenResponseToExpiresAt`) and `oauth-state.ts` (`createOAuthState`/`encryptOAuthState`/`decryptOAuthState`/`verifyOAuthState`) are already generic and already imported cross-package by `channel-gmail` today | `packages/channel-gmail/src/modules/channel_gmail/lib/oauth.ts` imports `communication_channels/lib/oauth-token.ts` directly; both packages declare `@open-mercato/core: workspace:*`; no cross-module import ban applies (only core→enterprise is banned) |
| (b) `SalesInvoice` has no Company/Person link without an Order | **CONFIRMED** | `packages/core/src/modules/sales/data/entities.ts:1391-1466` — only `order?: SalesOrder \| null`; `invoiceCreateSchema.orderId` optional at `data/validators.ts:903` |
| (c) `CustomerCompanyProfile` has no tax-ID/VAT field | **CONFIRMED** | `packages/core/src/modules/customers/data/entities.ts:254-299` — full column list has no tax/VAT/registration field; none seeded in `ce.ts`/`setup.ts` either |
| (d) `SalesInvoice` amounts already caller-asserted, not recalculated | **CONFIRMED** | `packages/core/src/modules/sales/commands/documents.ts:9088-9095` (create) and `:9342` (update) write amounts straight from parsed input; no `salesCalculationService.calculateDocumentTotals` call in the invoice create/update path (unlike quotes/orders, which do call it) |

## Missed capability

The generic, importable `oauth-state.ts`/`oauth-token.ts` helpers reduce WF1's OAuth gap — the state/nonce and token-exchange portions are reuse-by-import (as `channel-gmail` already does), not new/ported code. The spec's original framing (§0.2.1, §4 WF1, §4.5) treated all of `communication_channels`' OAuth code as non-reusable; only the `ChannelAdapter`-typed route layer and refresh-coalescing logic actually are.

## Overengineering

Same finding, viewed from the estimation side — WF1's commit count was inflated by treating already-importable helpers as new work. No other gap in § 4 looked inflated: `XeroInvoiceCustomerLink` (no existing generic link table found), the tax-number custom field, and the invoice read-only mutation guard (no existing generic "external-source read-only" guard in `data_sync`) all appear genuinely new and reasonably scoped.

## Resolution

All findings were incorporated into the spec on 2026-09-26 (same day): § 0.2.1, § 4 WF1's gap matrix, § 4.5's module architecture and toolkit-extraction framing, and Open Question #4 were all corrected to reflect that `oauth-state.ts`/`oauth-token.ts` are import-ready today. See the spec's Changelog for the consolidated list of edits.
