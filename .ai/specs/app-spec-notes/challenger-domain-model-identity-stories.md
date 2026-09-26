# DDD Challenger — App Spec: Xero Integration (§ 1, 2, 5, 6)

Reviewed: /workspace/.ai/specs/2026-09-26-app-spec-xero-integration.md, initial draft.

## CRITICAL

1. **`xeroTenantId` naming collision.** The glossary (§1.3) claims Xero's org concept is deliberately never called "tenant" elsewhere in the spec, but the actual field name `xeroTenantId` on `IntegrationCredentials` collides with OM's own `tenantId` column on the same row. **Fixed:** renamed to `xeroOrganisationId` throughout.

2. **Tax-number fallback matching is largely unreachable.** `xero_tax_number` is a field this integration introduces — it cannot exist on any Company created before Phase 1 ships, so the fallback can only match Companies a prior Xero sync already created (which don't need the fallback). **Fixed:** added an explicit limitation note in § 6.1 and a new Open Question (#7) recommending admin setup guidance to pre-populate the field on legacy Companies.

3. **Permanent disconnect + no-unlock read-only lock is a dead end.** § 6.2's read-only guard keyed off mapping existence alone meant a tenant permanently disconnecting Xero would leave every synced invoice locked read-only forever, with no override (US-3.2). Not surfaced in the Cross-Story Impact Matrix. **Fixed:** guard now also checks `IntegrationState.isEnabled`; disconnecting releases the lock. Added to US-1.2, US-3.2, § 6.2, and the Cross-Story Impact Matrix.

## WARNING

4. **"Xero-sourced field" term covered two different mechanisms** (record-level runtime guard for Invoices vs. field-level code-review-only convention for Companies). **Fixed:** split into "Xero-sourced record" and "Xero-owned field" in the glossary.

5. **Cross-Story Impact Matrix missed the disconnect-mid-run race** (credentials cleared while a run is still mid-page → ambiguous failure). **Fixed:** added a matrix row; disconnect now explicitly cancels in-flight runs before clearing credentials.

6. **`XeroInvoiceCustomerLink` atomicity was asserted ("same command-level unit of work") without a named mechanism**, and is actually impossible as a single DB transaction across two modules' writes. **Fixed:** replaced with an explicit sequential-write-plus-compensation design (create invoice, create link, compensate with a delete on link failure), safe under `data_sync`'s replay-safety contract.

## OK

Identity model (§2) — clean, both personas correctly internal-only. Archived/GDPR/voided handling (§6.4) — correctly avoids overwriting with blanks. `InvoiceID`-only matching (§6.1) — correctly reasons through the DB-unique-constraint collision risk. Failure paths in US-1.1/US-3.1 — genuinely specified with explicit post-failure state.

All CRITICAL and WARNING findings were fixed in the spec on 2026-09-26 (same day). See the spec's Changelog for the consolidated list of edits.
