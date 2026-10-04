# Execution plan — unit of measure and per-line confidence on inbox_ops order line items

**Branch:** `feat/inbox-ops-line-item-unit-confidence` · **Base:** `develop`
**Source doc:** none — additive change; `SPEC-037` §8 is updated in Phase 4.

## 🎯 Goal

Let an order line extracted by `inbox_ops` (`create_order` / `create_quote`) carry the unit of measure stated in the email and the model's confidence for that line, check the unit against the tenant's unit dictionary, show both on the proposal, and pass the unit to the sales line created on accept — so "10 t" of a product sold in bags is no longer silently turned into 10 bags.

## Scope

- `inbox_ops/data/validators.ts` — `orderPayloadSchema.lineItems[]` gains optional `quantityUnit` (string, max 25, like `sales` `linePricingSchema.quantityUnit`) and optional `confidence` (number in [0, 1]).
- `sales/inbox-actions.ts` — prompt schema and rules for both fields; `executeCreateDocumentAction` forwards `quantityUnit` to the sales line after checking it against the line's catalog product.
- `inbox_ops/lib/unitLookup.ts` (new) — reads the tenant's unit dictionary (`Dictionary` / `DictionaryEntry` resolved from DI, keys `unit` / `units` / `measurement_units`) and matches a unit against it.
- `inbox_ops/lib/extractionPrompt.ts` — optional appended `units` parameter rendered as a units-of-measure section.
- `inbox_ops/subscribers/extractionWorker.ts` — loads units, normalizes each line's unit (canonical code when recognized, as written otherwise, `unit` alias) and confidence (numeric strings coerced, invalid dropped), raises a `quantity_mismatch` discrepancy for an unrecognized unit.
- `inbox_ops/components/proposals/ActionCard.tsx` — unit after the quantity, per-line confidence column, discrepancy description; i18n in all five `inbox_ops` locales.
- `SPEC-037` §8 snippet and changelog; unit tests per step; integration test `TC-INBOX-011`.

## Non-goals

- Auto-accepting actions above a confidence threshold — this change only stores and shows the signal.
- Re-evaluating the `unit_not_recognized` discrepancy after the unit dictionary or the action payload changes — discrepancies are not re-checked after extraction anywhere in `inbox_ops`; "Edit" (the sales document form) remains the way past it.
- Special handling of sales errors for custom lines: an unrecognized unit that reaches accept through the API fails with the sales error, like every other sales validation error raised by an inbox action.
- Carrying the unit into the "Edit" path (the prefilled sales document form): the form cannot check a unit against the product's base unit and conversions on the client, and an unchecked unit would turn a save that works today into a `uom.*` error. Units there are chosen in the line dialog from the product's own units, as before.
- Checking the unit against the matched product's base unit and conversions at extraction time — it is checked on accept, where the line's product is final (it can change after extraction, e.g. through `create_product`).
- Units in `update_order.quantityChanges` and in auto-generated `create_product` actions; converting quantities between units; seeding new units.
- Any change to `extractionOutputSchema` (the provider-side schema) — line items travel inside the `payloadJson` string.
- DB migrations — sales lines already have `quantity_unit` / `normalized_unit`.

## Decisions

- `quantityUnit` holds the canonical dictionary code (`canonicalizeUnitCode` from `@open-mercato/shared/lib/units/unitCodes`) when the unit is recognized; an unrecognized unit is kept as written, so the reviewer sees what the email said, and gets a `quantity_mismatch` discrepancy with severity `error` (accepting it would fail with `uom.unit_not_found`) and description key `inbox_ops.discrepancy.desc.unit_not_recognized`.
- When the unit dictionary cannot be read (dictionary entities not resolvable, query failure), units are kept as written and no unit discrepancy is raised. A tenant without units of measure (no unit dictionary, or one without entries) gets no line units at all and no discrepancy — `sales` would reject any unit there, and before this change units were dropped anyway.
- Invalid per-line confidence never blocks acceptance: the worker drops it before storing, and the schema reads an invalid stored value as absent, so payloads stored before this change keep validating. A blank unit is read as absent; a unit longer than 25 characters is not stored (the worker flags it) and is rejected on edit.
- On accept, a line with a catalog product passes its unit only when sales can store it for that product: the product's base unit or a unit with an active conversion is forwarded; for a product without a base unit the unit is left off (sales cannot store a unit there, and before this change no unit was sent); any other unit fails the action with a 400 that names the line, instead of a raw `uom.*` code. Custom lines forward the unit and sales validates it against the dictionary.
- The unit lookup reads every dictionary entry (sales matches against all of them); only the prompt list is capped, at 200 units.

## Risks

- A stored payload whose lines already carry `quantityUnit` / `confidence` with a different shape would fail validation on accept. No prompt has asked for these keys before, so this is not expected in practice.
- Lines with a unit that the line's product cannot convert from now fail on accept instead of silently using the product's default unit — intended; the execution error names the line and the product's base unit.

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

- [x] 4.1 Update `SPEC-037` §8 and its changelog — f200d8f0e
- [x] 4.2 Add integration test `TC-INBOX-011` accepting an order action with a unit — 9d7690046

### Phase 5: Validation

- [x] 5.1 Run the full validation gate — gate run at bee3a167a

  Local runner (no compose `app` container). `build:packages`, `generate`, `build:packages`, `i18n:check-sync`, `i18n:check-usage`, `typecheck`, `build:app` green; `test` (run with `--continue`) green in every package except one `@open-mercato/cli` test — `module-package-sources.test.ts` compares `mtimeMs` with `toBe` and fails deterministically on macOS/APFS (`…713.999` vs `…714`). The branch does not touch `packages/cli`; `@open-mercato/core`: 18,901 passed, 18 skipped. `template:sync` and ESLint on the changed files (0 errors) pass.

### Phase 6: Review follow-ups

- [x] 6.1 Check line units against the line's product on accept — d9cd59b0d
- [x] 6.2 Keep inbox quote lines whose unit is rejected, with a warning — 4cfb88c05
- [x] 6.3 Tolerate stored line confidence values and over-long units — b0b4b4af3
- [x] 6.4 Read every tenant unit and bound the prompt unit list — 8be505ba9
- [x] 6.5 Show the unit discrepancy once and ignore out-of-range line confidence — d3c670f22
- [x] 6.6 Cover catalog line units and unit conversion in `TC-INBOX-011` — 602bb109a
- [x] 6.7 Leave inbox line units out of the sales document form prefill (supersedes 3.2) — 039e6fa88
- [x] 6.8 Leave line units off for tenants without units of measure — 202d9ef30
