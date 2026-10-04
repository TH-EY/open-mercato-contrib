# Execution plan — unit of measure and per-line confidence on inbox_ops order line items

**Branch:** `feat/inbox-ops-line-item-unit-confidence` · **Base:** `develop`
**Source doc:** none — additive change; `SPEC-037` §8 is updated in Phase 4.

## 🎯 Goal

Let an order line extracted by `inbox_ops` (`create_order` / `create_quote`) carry the unit of measure stated in the email and the model's confidence for that line, check the unit against the tenant's unit dictionary, show both on the proposal, and pass the unit to the sales line created on accept — so "10 t" of a product sold in bags is no longer silently turned into 10 bags.

## Scope

- `inbox_ops/data/validators.ts` — `orderPayloadSchema.lineItems[]` gains optional `quantityUnit` (string, max 25, like `sales` `linePricingSchema.quantityUnit`) and optional `confidence` (number in [0, 1]).
- `sales/inbox-actions.ts` — prompt schema and rules for both fields; `executeCreateDocumentAction` forwards `quantityUnit` to the sales line.
- `inbox_ops/lib/unitLookup.ts` (new) — reads the tenant's unit dictionary (`Dictionary` / `DictionaryEntry` resolved from DI, keys `unit` / `units` / `measurement_units`) and matches a unit against it.
- `inbox_ops/lib/extractionPrompt.ts` — optional appended `units` parameter rendered as a units-of-measure section.
- `inbox_ops/subscribers/extractionWorker.ts` — loads units, normalizes each line's unit (canonical code when recognized, as written otherwise, `unit` alias) and confidence (numeric strings coerced, invalid dropped), raises a `quantity_mismatch` discrepancy for an unrecognized unit.
- `inbox_ops/components/proposals/ActionCard.tsx` — unit after the quantity, per-line confidence column, discrepancy description; i18n in all five `inbox_ops` locales.
- Edit path — `sales/components/documents/SalesDocumentForm.tsx` inbox prefill and the quote-line POST in `sales/backend/sales/documents/create/page.tsx` keep the unit.
- `SPEC-037` §8 snippet and changelog; unit tests per step; integration test `TC-INBOX-011`.

## Non-goals

- Auto-accepting actions above a confidence threshold — this change only stores and shows the signal.
- Checking the unit against the matched product's base unit and conversions at extraction time — the sales command already enforces it on accept (`uom.conversion_not_found`).
- Units in `update_order.quantityChanges` and in auto-generated `create_product` actions; converting quantities between units; seeding new units.
- Any change to `extractionOutputSchema` (the provider-side schema) — line items travel inside the `payloadJson` string.
- DB migrations — sales lines already have `quantity_unit` / `normalized_unit`.

## Decisions

- `quantityUnit` holds the canonical dictionary code (`canonicalizeUnitCode` from `@open-mercato/shared/lib/units/unitCodes`) when the unit is recognized; an unrecognized unit is kept as written, so the reviewer sees what the email said, and gets a `quantity_mismatch` discrepancy with severity `error` (accepting it would fail with `uom.unit_not_found`) and description key `inbox_ops.discrepancy.desc.unit_not_recognized`.
- When the unit dictionary cannot be read (dictionary entities not resolvable, query failure), units are kept as written and no unit discrepancy is raised; a tenant without a unit dictionary is treated as having no units, matching `sales`.
- Invalid per-line confidence never blocks acceptance: the worker drops it before storing; the schema stays strict for edited payloads.

## Risks

- A stored payload whose lines already carry `quantityUnit` / `confidence` with a different shape would fail validation on accept. No prompt has asked for these keys before, so this is not expected in practice.
- Lines with a recognized unit that the matched product cannot convert from now fail on accept with the sales error instead of silently using the product's default unit — intended, and visible as the action's execution error.

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Payload contract and execution

- [x] 1.1 Add optional `quantityUnit` and `confidence` to `orderPayloadSchema` line items, with validator tests — fe2641399
- [x] 1.2 Describe both fields in the `create_order` prompt schema and rules and forward `quantityUnit` to sales lines, with execution tests — 10f476fcc

### Phase 2: Extraction

- [x] 2.1 Add `lib/unitLookup.ts` reading the tenant unit dictionary, with unit tests — d4362c8a1
- [x] 2.2 Render tenant units in the extraction system prompt, with prompt tests — 36a2038a1
- [x] 2.3 Normalize line units and confidence in the extraction worker and flag unrecognized units, with worker tests — 706fdcde7

### Phase 3: Proposal UI and edit path

- [x] 3.1 Show unit and per-line confidence in the order preview, add the discrepancy copy in all locales, with component tests — f8c9f349f
- [x] 3.2 Keep the unit when an order action is edited in the sales document form — de77ec0b0

### Phase 4: Docs and integration coverage

- [ ] 4.1 Update `SPEC-037` §8 and its changelog
- [ ] 4.2 Add integration test `TC-INBOX-011` accepting an order action with a unit

### Phase 5: Validation

- [ ] 5.1 Run the full validation gate
