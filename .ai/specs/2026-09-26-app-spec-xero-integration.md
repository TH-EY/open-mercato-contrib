# App Spec: Xero Integration

> The App Spec is a business architecture document that sits above feature specs.
> It captures domain knowledge, validates cross-spec consistency, and ensures
> the app solves a real business problem using the platform correctly.
>
> This document is the SINGLE SOURCE OF TRUTH for what this app is, who it serves,
> and how it maps to the platform. Feature specs are generated from this document.
> If a spec contradicts this document, this document wins.

**Status:** Draft — pending user confirmation before decomposition into feature specs (`om-spec-writing`).
**Scope:** Import-only. Xero → Open Mercato. Nothing is written back to Xero. Accounting API only (Contacts, Invoices). No Payroll/Projects/Files.
**Package:** `@open-mercato/sync-xero`, module `sync_xero`, category `data_sync`, placed under `packages/sync-xero/src/modules/sync_xero/` — never inside `packages/core`.

---

## 0. Research notes (not a template section — provenance for the decisions below)

### 0.1 Xero API — from Claude's trained knowledge (Jan 2026 cutoff), NOT a live fetch

Live web access (`WebFetch`/`WebSearch`) was unavailable in this environment for the entire session. Everything below is written from training knowledge of Xero's public developer documentation and is believed stable (this shape has been unchanged for several years), but the exact figures should be re-verified against `developer.xero.com` before Phase 1 implementation sign-off:

**OAuth 2.0 (Authorization Code flow, "Web app" app type):**
- App registered at `developer.xero.com` yields a `Client ID` + `Client Secret` (confidential client). Redirect URI must be pre-registered exactly; Xero permits `http://localhost:<port>/...` for local development.
- Scopes needed: `openid profile email offline_access` (the last is required to receive a refresh token) plus granular accounting scopes — `accounting.contacts` (or `.read`), `accounting.transactions` (or `.read`) for Invoices. Xero replaced broad legacy scopes with these granular ones industry-wide; confirm current names at connect time.
- Flow: redirect to `https://login.xero.com/identity/connect/authorize` (`client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`) → user authenticates and picks which Xero Organisation(s) to authorize → redirect back with `code` + `state` → exchange at `https://identity.xero.com/connect/token` (Basic auth `client_id:client_secret`, `grant_type=authorization_code`).
- Token response: `access_token` (JWT, **30 minutes**), `refresh_token` (**60-day** validity, single-use — Xero issues a brand-new refresh token on every refresh and invalidates the old one; the app must persist the new one immediately or lose the ability to refresh again), `id_token`, `expires_in`.
- Refresh: `POST` the same token endpoint with `grant_type=refresh_token`. A refresh token that goes **60 days without being used**, or that the end user revokes from Xero's own "Connected apps" screen, or that dies because the user changed their Xero password, becomes permanently invalid — the tenant must go through the full authorize flow again (a **reconnect**, not a silent refresh).
- **`GET /connections`** (`https://api.xero.com/connections`, Bearer access token): returns every Xero Organisation this specific OAuth grant is authorized for — `{ id, tenantId, tenantType, tenantName, createdDateUtc, updatedDateUtc }[]`. One OAuth connection (one token pair) **can cover more than one Xero Organisation** if the user selected multiple during consent. `DELETE /connections/{id}` revokes one specific organisation from the grant.
- **Every Accounting API call requires the `Xero-tenant-id` header** set to the target Organisation's `tenantId` GUID from `/connections` — the same access token addresses every authorized organisation by varying this header; there is no per-organisation token.
- A private, single-tenant integration (what this spec assumes — one OM tenant/organization connects its own Xero Organisation with its own Client ID/Secret) is the simple case: after consent, resolve `/connections`, and if more than one Organisation comes back, the admin must pick exactly one to bind (§ Decision, Phase 1).

**Rate limits & errors:**
- **60 API calls/minute per Xero Organisation per app**, **5,000 calls/day per Organisation**, **5 concurrent requests per app per Organisation**. Exceeding returns `429` with a `Retry-After` header (seconds).
- `400` — structured validation errors (`Elements[].ValidationErrors[]`) on Contact/Invoice writes (not relevant here — import-only, no writes to Xero).
- `401` — expired/invalid token → refresh and retry once.
- `403` — insufficient scope, or the Xero Organisation's subscription doesn't have the needed feature.
- `5xx` — transient; Xero's own guidance is exponential backoff.
- These are **per-Organisation** limits — a tenant with only one connected Organisation cannot parallelize around them; a large first-sync (many thousands of contacts/invoices) can take multiple sync windows purely from the daily cap.

**Contacts (`GET /api.xro/2.0/Contacts`):** key fields — `ContactID` (GUID, Xero-assigned, immutable, the only guaranteed-unique key), `ContactStatus` (`ACTIVE`/`ARCHIVED`/`GDPRREQUEST`), `Name` (required, **not** unique — Xero allows duplicate contact names), `FirstName`/`LastName` (individuals), `EmailAddress`, `TaxNumber` (free text, format varies by country — spaces, "GB" country-prefix, etc. — not validated or guaranteed unique by Xero), `CompanyNumber` (free text registration number, also unvalidated), `ContactNumber` and `AccountNumber` (Xero's own "your external system's key for this contact" fields — unique per organisation **when set**, but blank unless an org has already used one), `Addresses[]`, `Phones[]`, `IsCustomer`/`IsSupplier` (computed booleans, true once the contact has appeared on a sales invoice / bill respectively), `ContactPersons[]`, `UpdatedDateUTC` (the incremental-sync field). Contacts are **never hard-deleted** via the API — only archived (`ContactStatus=ARCHIVED`) or GDPR-redacted (`ContactStatus=GDPRREQUEST`, which strips PII); both remain retrievable.

**Invoices (`GET /api.xro/2.0/Invoices`):** `InvoiceID` (GUID, immutable, only guaranteed-unique key), `Type` (`ACCREC` = sales invoice to a customer, `ACCPAY` = bill from a supplier), `InvoiceNumber` — for `ACCREC` this is Xero's own auto-numbered sequence (unique per organisation **under default settings**, but a user can hand-edit it and Xero does not then re-enforce global uniqueness against older/imported rows); for `ACCPAY` it is literally the **supplier's own invoice reference**, free text, **not unique at all**. `Reference` — free text, not unique, often a PO number. `Contact: { ContactID, Name }`. `Status` — `DRAFT`/`SUBMITTED`/`AUTHORISED`/`DELETED`/`VOIDED` (payment state is a separate signal — see next). `LineItems[]` (`Description`, `Quantity`, `UnitAmount`, `AccountCode`, `TaxType`, `TaxAmount`, `LineAmount`), `SubTotal`/`TotalTax`/`Total`, `CurrencyCode`, `CurrencyRate`, `Date`, `DueDate`, `AmountDue`/`AmountPaid`/`AmountCredited`, `FullyPaidOnDate`, `UpdatedDateUTC`. Only `DRAFT`/`SUBMITTED` invoices can be Xero-deleted (`Status=DELETED`); an `AUTHORISED` invoice can only be voided (`Status=VOIDED`), never deleted — both states remain retrievable via the API, never physically removed.

**Pagination & incremental sync:** list endpoints page (Xero has used 100-per-page paging historically; some endpoints accept `page`+`pageSize`). The **`If-Modified-Since` HTTP header** (a UTC datetime) is Xero's documented, cheap mechanism for incremental sync — pass the timestamp of the last successful sync and Xero returns only rows with `UpdatedDateUTC` after it. Combine with `order=UpdatedDateUTC ASC` for stable pagination while new updates land mid-walk. A `where` query-filter DSL also exists but is costlier and has its own quirks — avoid it for the primary incremental loop.

**Demo Company:** every Xero login (including a developer's own account) has access to a pre-populated "Demo Company (NZ)" sandbox organisation — same API, same base URL, no separate sandbox environment. Local development: register a Xero app with an OAuth redirect URI on `localhost`, run the consent flow, and select the Demo Company as the authorized Organisation.

**Verification checklist before Phase 1 sign-off** (things likely to drift or that deserve a live check against current docs): exact current granular scope names; exact current rate-limit numbers (60/min, 5,000/day, 5 concurrent have been stable for years but confirm); exact current page size limits per endpoint; whether `Status` still excludes an explicit "PAID" value (payment state read from `AmountDue`/`AmountPaid` instead, per the MVP design in § 6 below).

### 0.2 Open Mercato platform — read directly from the repository (authoritative, not trained knowledge)

Full findings are in `<specs-dir>/app-spec-notes/platform-research.md` (below); the load-bearing ones that shape every decision in this spec:

1. **No generic OAuth admin UI exists, but the low-level OAuth primitives are already generic AND already reused cross-package.** `packages/shared/src/modules/integrations/types.ts` declares an `oauth` credential-field type, but `packages/core/src/modules/integrations/backend/integrations/[id]/page.tsx` explicitly refuses to render it (`UNSUPPORTED_CREDENTIAL_FIELD_TYPES = new Set(['oauth', 'ssh_keypair'])`) — so a generic "Connect" UI has to be built regardless. But (per the architect checkpoint that reviewed this document, § changelog) the *lower-level* helpers the Gmail email channel uses are not bespoke: `packages/core/src/modules/communication_channels/lib/oauth-token.ts` (`requestOAuthToken`, `tokenResponseToExpiresAt`) and `lib/oauth-state.ts` (`createOAuthState`/`encryptOAuthState`/`decryptOAuthState`/`verifyOAuthState`) are fully provider-agnostic (typed on a plain `providerKey: string`, no `ChannelAdapter` dependency), and `packages/channel-gmail` already imports `oauth-token.ts` directly across the package boundary (`packages/channel-gmail/src/modules/channel_gmail/lib/oauth.ts`) — both packages declare `@open-mercato/core: workspace:*`, so this is a normal, sanctioned workspace import, not a violation of any cross-module rule (the only real import ban found is core→enterprise). **`sync_xero` should import these two helpers directly, exactly as `channel-gmail` does, rather than reimplementing them.** What genuinely has no precedent to import is the *route layer* (`ChannelAdapter`-typed initiate/callback handlers) and the credential-refresh coalescing logic (`credential-refresh.ts`, typed against `ChannelAdapter`) — those are real, non-trivial, precedented-but-not-reusable work `sync_xero` still has to write itself, modeled on `communication_channels`' route shape.
2. **`SalesInvoice` has no direct Company/Person link.** It only has an optional `order` FK; the customer relationship lives on `SalesOrder` (`customerEntityId`, `customerContactId`, `customerSnapshot`). An invoice imported from Xero has no OM Order behind it (confirmed: `orderId` is optional on `invoiceCreateSchema` — standalone invoices are already a supported shape), so there is **no built-in column to say which Company an imported invoice belongs to**. Requires a new extension entity (§ 1.4).
3. **`SalesInvoice` amounts are already caller-asserted, today, unconditionally** — `sales.invoices.create`/`.update` write `subtotalNetAmount`, `grandTotalNetAmount`, etc. straight from the request body; nothing in `salesCalculationService` recomputes them (confirmed by reading `.ai/specs/2026-09-07-sales-external-amounts-mode.md`, itself an unrelated proposed spec for *Orders* that documents this as an existing fact about Invoices to contrast against). **This means "store Xero's amounts as-is, no OM recalculation" needs zero new plumbing** — it is the existing invoice-write behavior.
4. **`CustomerCompanyProfile` has no tax-ID/VAT/registration-number column**, despite `packages/core/src/modules/customers/AGENTS.md` documenting "tax ID optional" as an intended constraint. No such field exists as a native column or a seeded custom field.
5. **`data_sync`'s `id-mapping.ts` (`ExternalIdMappingService`) and `sync_excel`'s matching logic are the direct precedent** this spec's matching/dedup design follows — see § 5.2.
6. **CRON scheduling, run history, retry, cancellation, per-item error logging, and progress reporting are 100% generic and already built** (`data_sync` module) — a Xero adapter gets all of this by implementing the `DataSyncAdapter` contract; nothing new to build there.
7. **`IntegrationState.reauthRequired` already exists as a column**, and `integrationHealthService` already runs a 15-minute health probe with persisted status/latency — reconnect-prompt UX and health checks are reuse, not new mechanism.

---

## 1. Business Context `PM`

### 1.1 Business Model

Open Mercato tenants who use Xero as their accounting system of record currently re-key Xero customers and sales invoices into Open Mercato by hand (or via the generic CSV importer) to use them in OM's CRM, sales reporting, and customer-portal workflows. The paying customer is the OM tenant (the business running its operations in OM). This integration removes the re-keying step: it does not sell Xero data, it removes friction between two systems the tenant already pays for.

**Flywheel:**
```
Xero import removes manual data entry
   -> OM's Company/Invoice data is trusted as accurate and current
   -> tenant relies more on OM's CRM/sales/portal workflows against that data
   -> tenant adopts more of OM's operational modules (sales reporting, customer portal, deals)
   -> OM becomes the tenant's "system of engagement" layered on Xero's "system of record"
   -> higher retention and expansion within the OM platform
```

### 1.2 Business Goals

**Primary goal:** eliminate manual duplicate entry of Xero Contacts and Xero Sales Invoices into Open Mercato, so a tenant's Companies and Invoices in OM reflect their real accounting records without a human re-typing them. Measurable: after the first sync, every Xero Contact that is (or becomes) a customer has exactly one corresponding OM Company (no duplicates, no manual matching); every Xero `ACCREC`/`AUTHORISED` invoice has exactly one corresponding OM Invoice within one scheduled-sync interval of being authorised in Xero.

**Secondary goal:** N/A — this is not a reference/example app (§ 9 is N/A).

**What is NOT important (explicit exclusions):**
- Writing anything back to Xero (no export, no bidirectional sync) — this is import-only.
- Real-time webhook push from Xero — poll-based incremental sync (`If-Modified-Since`) only.
- Bills (`ACCPAY`), credit notes, detailed multi-payment records, invoice PDFs/attachments, Payroll, Projects, Files — all explicitly deferred (§ 6.3, § 7).
- Currency conversion — currency code and amounts are stored exactly as Xero reports them, no FX conversion in OM.
- A configurable field-mapping UI (unlike `sync_excel`) — Phase 1 ships with a fixed, documented mapping; see § 10 Open Questions for whether this is revisited later.

### 1.3 Ubiquitous Language

| Term | Definition | Source of data | Period |
|---|---|---|---|
| Xero Organisation | One accounting entity inside Xero (what Xero's own docs sometimes loosely call "tenant" — deliberately NOT called "tenant" anywhere else in this spec to avoid colliding with OM's own Tenant concept). Identified by a `tenantId` GUID Xero returns from `/connections` and required on every Accounting API call via the `Xero-tenant-id` header. | Xero `/connections` | N/A |
| Xero Connection | The OAuth2 grant (access token + refresh token pair) issued to this integration's Client ID/Secret. One Connection can be authorized for one or more Xero Organisations, but this spec's Phase 1 binds exactly one Xero Organisation per OM tenant+organization (§ 3, WF1). | OAuth token exchange | N/A |
| OM Tenant / OM Organization | Open Mercato's own multi-tenant scoping (`tenantId`, `organizationId` on every entity). Never referred to as "tenant" when the context is Xero's side — always "Xero Organisation" there. | OM platform | N/A |
| Xero Contact | A Xero record representing a customer, supplier, or both. Maps to an OM Company (§ 1.4, § 6.4). | Xero Accounting API | N/A |
| Xero Invoice | A Xero record of type `ACCREC` (sales invoice) or `ACCPAY` (bill). Only `ACCREC` is in scope for Phase 1 (§ 6.3). Maps to an OM Invoice (`SalesInvoice`). | Xero Accounting API | N/A |
| OM Company | `CustomerEntity` (`kind='company'`) + its `CustomerCompanyProfile`, the existing customers-module entity. The Xero import target for Contacts. | OM `customers` module | N/A |
| OM Invoice | `SalesInvoice` (+ `SalesInvoiceLine[]`), the existing sales-module entity. The Xero import target for Invoices. | OM `sales` module | N/A |
| External ID mapping | A row in `SyncExternalIdMapping` (via `ExternalIdMappingService`) linking one Xero GUID (`ContactID`/`InvoiceID`) to one OM record id, keyed by `integrationId='xero'`. The authoritative repeat-run matching key once it exists. | `data_sync`/`integrations` modules | N/A |
| Xero-sourced record | A **whole record** (currently only Invoices) that this integration created — read-only in OM while the connection is active. Determined by whether an external-id mapping exists for that record AND the integration is enabled (§ 6.2), not by a stored per-record flag. Enforced at runtime by a mutation guard. | This integration | N/A |
| Xero-owned field | One **field** (currently only on Companies) that this integration is allowed to overwrite on re-sync, per the fixed table in § 6.2 — distinct from a Xero-sourced record: a Company stays fully editable, only its Xero-owned fields are subject to overwrite. Enforced by code review against this spec's § 6.2 table, not by a runtime mechanism (a real, accepted gap — see § 5 Cross-Story Impact Matrix, US-2.3 row). | This integration | N/A |
| Sync run | One `SyncRun` row — one execution of the Contacts or Invoices import for one OM tenant+organization. Existing `data_sync` concept, not new. | `data_sync` module | Per run |

### 1.4 Domain Model

**Entities touched (existing, reused as-is):**

| Entity | Module | Role in this integration |
|---|---|---|
| `IntegrationCredentials` | `integrations` | Stores Client ID/Secret + OAuth tokens + selected Xero Organisation id, under `integrationId='xero'` |
| `IntegrationState` | `integrations` | `isEnabled`, `reauthRequired`, health status — reused verbatim |
| `SyncExternalIdMapping` (via `ExternalIdMappingService`) | `integrations`/`data_sync` | `ContactID -> CustomerEntity.id` and `InvoiceID -> SalesInvoice.id`, `integrationId='xero'` |
| `SyncRun`, `SyncSchedule` | `data_sync` | Run history and CRON scheduling — reused verbatim |
| `CustomerEntity` + `CustomerCompanyProfile` | `customers` | Import target for Xero Contacts |
| `SalesInvoice` + `SalesInvoiceLine` | `sales` | Import target for Xero Invoices |

**New entities this integration introduces:**

`XeroInvoiceCustomerLink` (new table, owned by `sync_xero`, declared via the sales module's `data/extensions.ts` link mechanism per the platform's "extend via a separate entity, never mutate core entities" rule — closes the gap in § 0.2 point 2):

| Field | Type | Multi-value | Required |
|---|---|---|---|
| `id` | uuid (pk) | no | system-set |
| `salesInvoiceId` | relation → `SalesInvoice` | no | yes, unique (one link per invoice) |
| `customerEntityId` | relation → `CustomerEntity` (kind=`company`) | no | yes |
| `customerContactId` | relation → `CustomerEntity` (kind=`person`), nullable | no | no |
| `customerSnapshot` | json (name/email frozen at sync time) | no | no |
| `organizationId`, `tenantId` | uuid | no | yes |
| `createdAt`, `updatedAt` | datetime | no | system-set |

New custom field, declared by `sync_xero`'s `ce.ts` against the Company profile entity (exact generated entity-id literal — `E.customers.customer_company_profile` or equivalent — to be confirmed against `entities.ids.generated.ts` in the feature spec):

| Field | Type | Multi-value | Required |
|---|---|---|---|
| `xero_tax_number` | text | no | no |

**Domain invariants:**
- Exactly one `IntegrationCredentials` row per OM tenant+organization for `integrationId='xero'` — one Xero Organisation connected at a time (§ 3, WF1; multi-organisation-per-tenant is out of scope, § 10).
- An `XeroInvoiceCustomerLink` row exists if and only if the linked `SalesInvoice` was created by this integration (1:1, enforced by the unique index on `salesInvoiceId`).
- A `SyncExternalIdMapping` row for `(integrationId='xero', internalEntityType='sales.invoice', externalId=<InvoiceID>)` existing is the sole signal that an invoice is Xero-sourced (no redundant boolean flag — reuses existing infrastructure, § 0.2 point 5).
- Contacts are always imported before the invoices that reference them are allowed to succeed (§ 6.5) — an invoice whose Contact cannot be resolved is a `failed` item, never a partially-linked invoice.

**Access control:** internal-only (§ 2). No new ACL features are introduced — the integration reuses `integrations.view`/`integrations.manage`/`integrations.credentials.manage` and `data_sync.view`/`data_sync.run`/`data_sync.configure`, exactly as every other data-sync provider does.

#### Checklist
- [x] Paying customer identified
- [x] Flywheel articulated
- [x] Primary goal stated with measurable outcome; scope exclusions listed
- [x] Every domain term defined once; no Xero/OM "tenant" collision (resolved by never calling Xero's side "tenant")
- [x] Domain entities identified with clear ownership; new entities precisely typed
- [x] Data ownership documented (§ 6.2 elaborates field-level ownership)
- [x] Access control rules documented (reuse, no new features)

---

## 2. Identity Model `PM`

| Persona | Role key | Identity | Org scope | Sees | Does |
|---|---|---|---|---|---|
| OM Admin | existing admin/`integrations.manage`+`data_sync.configure` holder | internal | one OM tenant+organization | Integrations marketplace, Xero detail page, Data Sync dashboard | Connects/disconnects Xero, configures the sync schedule, triggers on-demand runs, reads run logs, reconnects on token expiry |
| OM Sales/CRM user | existing `customers.*`/`sales.*` feature holder | internal | one OM tenant+organization | Companies and Invoices imported from Xero, in the normal Companies/Sales UI | Views imported data; cannot edit Xero-sourced invoice fields (§ 6.2); can freely edit OM-only Company fields (owner, tags, notes) |

**External-surface decision framework:** N/A — every persona here is internal to the operating organization (OM's own staff using their own OM tenant against their own Xero Organisation). There is no end-customer-facing surface for this integration.

**Portal decision: NOT USED.**

**If NOT USED — why:** This is a backend-to-backend accounting sync between two systems the tenant's own staff operate. No customer-portal persona is involved on either side.

**Decision log:** Both personas are internal because both need the platform's rich internal tooling (integration marketplace, data sync dashboard, DataTable-based Companies/Invoices lists) — none of that is available or appropriate on the portal surface, and neither persona is external to the operating organization.

#### Checklist
- [x] Every persona has ONE identity type — internal
- [x] Identity decision justified per persona
- [x] No persona has two accounts
- [x] Org scoping defined — one OM tenant+organization per Xero connection
- [x] Portal decision justified (single-surface fact recorded, tree N/A)

---

## 3. Workflows `PM`

### WF1: Connect a Xero Organisation

**Journey:** Admin opens Integrations marketplace -> opens the Xero card -> enters Client ID + Client Secret -> clicks "Connect to Xero" -> completes Xero's consent screen -> Xero redirects back -> if more than one Xero Organisation was authorized, admin picks exactly one -> connection is stored and shown as Connected.

**ROI:** Removes the only manual setup step standing between a tenant and automated accounting-data sync; a 5-minute one-time setup replaces indefinite manual re-keying.

**Key personas:** OM Admin.

**Boundaries:**
- Starts when: Admin opens the Xero integration detail page with no active connection.
- Ends when: `IntegrationCredentials` holds a valid access/refresh token pair and exactly one bound `xeroOrganisationId` (deliberately not named `xeroTenantId` — see § 1.3 on avoiding the Xero/OM "tenant" collision at the schema level, not just in prose), and `IntegrationState.isEnabled=true`.
- NOT this workflow: the actual data import (WF2/WF3), token refresh during normal operation (WF4), reauthorization after expiry (WF5).

**Edge cases:**
1. Admin authorizes zero Xero Organisations during consent -> connection fails with a clear "no organisation authorized" error, no partial state saved.
2. Admin authorizes 2+ Organisations -> admin is prompted to pick exactly one before the connection is considered complete; the others are simply not used (Xero's grant still covers them, OM only acts on the chosen one).
3. Client ID/Secret are wrong -> Xero's own consent/token-exchange step rejects them before any redirect back to OM; OM surfaces the identity-provider error verbatim without revealing internal detail.
4. Admin clicks Connect twice in two tabs (double-submit) -> the state-cookie nonce (via the imported `oauth-state.ts` helper, § 0.2.1) makes only the first callback valid; the second is rejected as an expired/mismatched state.
5. Network/timeout talking to Xero's token endpoint -> connection attempt fails cleanly, no partial `IntegrationCredentials` row is left half-written.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| Enter Client ID/Secret | `integrations` Credentials tab, `text`/`secret` field types | No | Reuse as-is |
| "Connect to Xero" button | UMES widget injection on the integration detail page | No | Same mechanism the Gmail channel's Connect button uses |
| OAuth authorize redirect + callback | — | **Yes** | No generic route layer exists (§ 0.2.1); build provider-owned routes modeled on `communication_channels`' route shape |
| State/nonce protection | `communication_channels/lib/oauth-state.ts` (generic, already cross-package-imported by `channel-gmail`) | **No** | Import directly — not a port (§ 0.2.1 correction) |
| Store tokens + selected Organisation | `integrationCredentialsService.saveField()` | No | Reuse as-is |
| Show Connected status | `IntegrationState` + integration detail page | No | Reuse as-is |

### WF2: Import Contacts as Companies

**Journey:** Admin triggers an on-demand run (or a schedule fires) for the `xero.contacts` entity type -> adapter pulls Xero Contacts page by page -> each Contact is matched against an existing OM Company or created new -> Company fields Xero owns are written; OM-only fields are left untouched -> run completes with per-Contact create/update/skip/failed counts.

**ROI:** A tenant with, say, 400 Xero customers gets 400 correctly-matched OM Companies with zero manual data entry and zero duplicate-creation risk, versus hours of manual CSV prep or hand entry.

**Key personas:** OM Admin (triggers/monitors); OM Sales/CRM user (consumes the result).

**Boundaries:**
- Starts when: a sync run for `xero.contacts` begins (on-demand or scheduled).
- Ends when: every Contact page returned by Xero for the current window has been processed into a create/update/skip/failed outcome.
- NOT this workflow: importing invoices (WF3); Bills/`ACCPAY`-only supplier contacts are explicitly filtered out (§ 6.4).

**Edge cases:**
1. A Contact has no `TaxNumber`/`CompanyNumber` and no existing external-id mapping -> no reliable fallback match exists -> a new Company is always created (never guessed by Name alone) -> possible duplicate is only ever a soft warning in the run log, never silently merged (§ 6.1).
2. A Contact's `TaxNumber` matches an existing OM Company's `xero_tax_number` custom field but formatted with different whitespace/casing ("GB 123 456" vs "GB123456") -> normalization (strip whitespace, uppercase) is applied before comparison; a match that still fails after normalization creates a new Company rather than guessing.
3. A Contact is `ContactStatus=ARCHIVED` -> mapped Company is updated with `status='archived'`/`isActive=false`, never deleted.
4. A Contact is `ContactStatus=GDPRREQUEST` (PII stripped by Xero) -> OM does not overwrite existing PII fields with the now-blank Xero values; only the status flip is applied (§ 6.4).
5. A Contact is supplier-only (`IsSupplier=true`, `IsCustomer=false`, never referenced by an imported invoice) -> filtered out entirely, no Company created (§ 6.4).

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| Pull Contacts page by page | `DataSyncAdapter.streamImport` | Partial | Xero API client + pagination + rate-limit backoff is new code inside the adapter |
| Match existing vs new | `ExternalIdMappingService` + an in-memory dedupe index (modeled on `buildEmailDedupeIndex`) | Partial | Id-mapping is pure reuse; the tax-number dedupe index is new but small, same shape as the existing email index |
| Create/update Company | `customers.people.create/update`-equivalent commands for companies (via the customers module's command pattern) | No | Reuse existing customers-module commands |
| Store `ContactID` mapping | `ExternalIdMappingService.storeExternalIdMapping` | No | Reuse as-is |
| Per-item error reporting | `data_sync` engine + `IntegrationLog` | No | Reuse as-is |

### WF3: Import Sales Invoices linked to Companies

**Journey:** Admin triggers/schedules a run for `xero.invoices` -> adapter pulls `ACCREC` Invoices with `Status IN (AUTHORISED, VOIDED)` modified since the last cursor -> for each Invoice, resolve its Contact's mapped Company (self-healing a missing mapping via a direct Xero Contact GET if needed) -> create/update the `SalesInvoice` + lines + the `XeroInvoiceCustomerLink` -> run completes with counts.

**ROI:** A tenant's OM sales reporting and customer-record views reflect real invoiced revenue without anyone re-typing invoice headers/lines; every imported invoice is provably linked to the right Company.

**Key personas:** OM Admin (triggers/monitors); OM Sales/CRM user (reads invoice/payment-status data against a Company).

**Boundaries:**
- Starts when: a sync run for `xero.invoices` begins.
- Ends when: every `ACCREC` invoice page in the current window has been processed into create/update/skip/failed, each successful one linked to a Company.
- NOT this workflow: Bills (`ACCPAY`), credit notes, detailed multi-payment allocation, PDFs/attachments — all deferred (§ 6.3, § 7). Never writes anything back to Xero.

**Edge cases:**
1. Invoice's Contact has not yet been synced (no mapping) -> adapter attempts a direct Xero `GET /Contacts/{id}` to self-heal; if that also fails or the Contact is filtered out by WF2's supplier-only rule, the invoice item is `failed` with a stable error code, not silently skipped or partially linked (§ 6.5).
2. Xero's `InvoiceNumber` collides with a pre-existing, unrelated OM invoice's `invoiceNumber` (DB unique constraint on org+tenant+`invoiceNumber`) -> the create fails; the item is reported `failed` with a clear collision error; no silent renumbering (§ 5.1).
3. Invoice is `VOIDED` -> mirrored as `status='voided'` on the OM Invoice, never deleted, since it may already be referenced elsewhere in OM.
4. Invoice was `DELETED` in Xero (only possible while still `DRAFT`/`SUBMITTED`, i.e. never reaches OM in the first place since Phase 1 only imports `AUTHORISED`/`VOIDED`) -> not applicable; documented so the "why doesn't OM see drafts" question has an answer.
5. Xero's daily/per-minute rate limit is hit mid-run on a very large first sync -> the adapter's own backoff honors `Retry-After`; if the daily cap is hit, the run yields its progress so far (`hasMore=true`), and the next scheduled/on-demand run resumes from the last committed cursor — no data loss, just a multi-day first sync for very large tenants.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| Pull Invoices page by page | `DataSyncAdapter.streamImport` | Partial | Same Xero API client as WF2, different endpoint/filter |
| Resolve Contact -> Company | `ExternalIdMappingService.lookupLocalId` + self-heal GET | Partial | Lookup is reuse; self-heal GET is small new logic |
| Create/update Invoice + lines | `sales.invoices.create`/`.update` commands | No | Amounts are already caller-asserted (§ 0.2.3) — zero new plumbing for "store as-is" |
| Link Invoice -> Company | `XeroInvoiceCustomerLink` (new) | **Yes** | The one genuine schema gap (§ 1.4) |
| Store `InvoiceID` mapping | `ExternalIdMappingService` | No | Reuse as-is |
| Make Xero-sourced records read-only while connected | Mutation-guard registry + External-ID widget (already shows Xero link) | Partial | Guard logic is new but small; display is pure reuse |

### WF4: Scheduled incremental sync keeps OM current

**Journey:** Admin configures a CRON/interval schedule for `xero.contacts` and `xero.invoices` from the Data Sync dashboard (exactly like any other provider) -> the platform's generic scheduler fires -> a `SyncRun` is created and enqueued -> the adapter resumes from `If-Modified-Since` = the last committed cursor -> only changed records are processed.

**ROI:** Zero ongoing manual effort; OM data lags Xero by at most one schedule interval (e.g. 15 minutes) instead of however long a human takes to notice and re-run a manual export.

**Key personas:** OM Admin (sets the schedule once).

**Boundaries:**
- Starts when: the schedule is configured and enabled.
- Ends when: N/A — this is the steady-state recurring workflow, bounded per-run by WF2/WF3's own boundaries.
- NOT this workflow: the first (full) sync, which is WF2/WF3 with no prior cursor.

**Edge cases:**
1. Two scheduled runs for the same entity type overlap (previous run still processing) -> `data_sync`'s existing overlap detection refuses the second (reuse, no new logic).
2. Xero's access token expires between schedule ticks -> refreshed transparently before the API call, same as any mid-run refresh (WF1/WF5 boundary).
3. A previous run ended with some `failed` items -> those are not automatically retried by the next incremental run (their `UpdatedDateUTC` cursor position has already advanced past them) -> visible in the run's failed-item list; admin can trigger "Run as full sync" to reattempt (existing `data_sync` UX, no new mechanism, § 6.6).

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| Configure CRON schedule | `data_sync` Schedule tab + `schedulerService` | No | Fully generic, zero new code |
| Run history/logs | `data_sync` dashboard | No | Fully generic |
| Cursor persistence/resume | `data_sync` engine + `SyncCursor` | No | Adapter just returns `If-Modified-Since`-shaped cursor strings |

### WF5: Reauthorize or disconnect on token expiry/revocation

**Journey:** Refresh token dies (60 days unused, or revoked in Xero, or password changed) -> next scheduled sync's token refresh fails -> `IntegrationState.reauthRequired=true` is set -> Admin sees a "Reconnect" prompt on the integration detail page -> Admin re-runs WF1's consent flow -> connection is restored.

**ROI:** No silent, indefinite sync failure — the platform's own health-probe/reauth-flag mechanism surfaces the problem within 15 minutes (the existing health-probe interval) instead of a tenant only discovering stale data weeks later.

**Key personas:** OM Admin.

**Boundaries:**
- Starts when: a token refresh attempt fails with an invalid-grant style error.
- Ends when: either the admin successfully reconnects (back to WF1's end state) or explicitly disconnects (credentials cleared, `isEnabled=false`, schedules paused).
- NOT this workflow: a transient network failure during refresh (retried with backoff, not treated as reauth-required).

**Edge cases:**
1. Admin disconnects intentionally (not because of expiry) -> same end state as an expired reconnect-prompt path: credentials cleared, schedules paused, no orphaned scheduled jobs left firing against dead credentials.
2. Reconnect selects a **different** Xero Organisation than before -> flagged prominently (this changes what all future syncs pull) — Phase 1 treats this as equivalent to a fresh connect; existing external-id mappings for the old Organisation are not automatically invalidated (see § 10 open question).
3. Health probe (15-min interval) detects the failure before any scheduled sync attempt does -> `reauthRequired` is set proactively, same UX.

**Platform readiness (per step):**

| Step | Platform capability | Gap? | Notes |
|---|---|---|---|
| Detect refresh failure | Xero API client's refresh call | Partial | New code, small |
| Flag reauth needed | `IntegrationState.reauthRequired` | No | Existing column, existing mechanism |
| Health probe | `integrationHealthService` (15-min interval) | No | Reuse as-is |
| Reconnect UI | Integration detail page + WF1's flow | No | Same widget, same routes |

#### Checklist (overall)
- [x] 5 core workflows defined
- [x] Every workflow step mapped to a platform capability, gaps flagged explicitly
- [x] No workflow exceeds ~200 new-code lines' worth of genuinely new logic without a named, unavoidable gap (OAuth flow, Xero API client, invoice-customer link, tax-number dedupe)

---

## 3.5 UI Architecture `PM + UX`

### Navigation (per role)

| Role | Sidebar groups | Notes |
|---|---|---|
| OM Admin | Existing "External Systems -> Integrations" and "External Systems -> Data Sync" groups | No new sidebar entries — Xero is a card in the existing Integrations marketplace and a provider in the existing Data Sync dashboard |
| OM Sales/CRM user | Existing "Customers -> Companies" and "Sales -> Invoices" | No new navigation — imported records appear in existing lists |

### Dashboard Widgets

None new. The existing Integrations health/status card and the Data Sync run-history widgets already answer "is Xero syncing correctly right now?" — no bespoke Xero dashboard widget is justified for Phase 1.

### Custom Pages

| Page | URL pattern | Role | Purpose | Building block |
|---|---|---|---|---|
| Xero integration detail (extra tabs) | `/backend/integrations/sync_xero` (existing route, extra injected tabs) | Admin | Connect/disconnect, show connected Organisation name, health | standard integration detail page + UMES widget injection (tab) |

### Widget Injections

| Widget | Injects into | Injection spot | Data |
|---|---|---|---|
| "Connect to Xero" / connection status card | Integration detail page | `integrations.detail:sync_xero` | Connection state, connected Organisation name, reconnect CTA |
| Xero link display | Company detail page, Invoice detail page | Existing `integrations.detail` external-id widget spot (already built, generic) | `ContactID`/`InvoiceID`, last synced at, sync status |

### Key User Flows

| Persona | Task | Flow (login -> done) | Clicks | Notes |
|---|---|---|---|---|
| OM Admin | Connect Xero | Login -> Integrations -> Xero card -> enter Client ID/Secret -> Connect -> Xero consent -> back in OM | 3 | Xero's own consent screen is outside OM's click count |
| OM Admin | Trigger on-demand sync | Login -> Data Sync dashboard -> select `xero.contacts`/`xero.invoices` -> Run once now | 3 | Existing generic flow |
| OM Sales/CRM user | View a Xero-imported Company | Login -> Customers -> Companies -> open record | 2 | No new UI |

### Empty States

| Page/Widget | Empty state message | Action |
|---|---|---|
| Xero integration detail, no connection yet | "Not connected to Xero yet." | "Connect to Xero" button |
| Data Sync dashboard, no runs yet for `xero.*` | Existing generic "No runs yet" state | "Run once now" |

#### Checklist
- [x] Every persona has a defined login-to-primary-task flow, ≤3 clicks
- [x] No custom pages beyond one injected tab — everything else reuses existing standard pages
- [x] Empty states reuse existing generic ones where possible

---

## 4. Workflow Gap Analysis `Architect`

### Gap Scoring — Atomic Commits (per template: 0=platform does it, 5=5+ commits/external dependency)

#### WF1: Connect a Xero Organisation — Total: 5 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Package scaffold + `integration.ts` (credentials fields, category) | `integrations` registry | 1 | app | 1 | Config + a few typed fields |
| OAuth initiate/callback/disconnect routes (state-cookie helper imported, not ported) | route layer none generic; `oauth-state.ts`/`oauth-token.ts` ARE generic and importable (§ 0.2.1) | 3 | app | 2 | Route handlers + token-exchange wiring are new; state-cookie crypto and token-response parsing are a direct import of existing helpers, same as `channel-gmail` does — commit estimate reduced from the original draft per the architect checkpoint |
| Multi-organisation picker (when `/connections` returns >1) | none | 2 | app | 1 | Small UI + one API call |
| Connect/disconnect widget on detail page | UMES widget injection | 1 | app | 1 | Same mechanism as Gmail's Connect button |

#### WF2: Import Contacts as Companies — Total: 6 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Xero API client (Contacts endpoint, pagination, `If-Modified-Since`, rate-limit backoff) | none generic (provider-specific per `data_sync` rules) | 3 | app | 2 | Shared with WF3's Invoices client |
| `xero.contacts` `DataSyncAdapter` (matching, mapping, field-level ownership) | `DataSyncAdapter` contract | 2 | app | 2 | Modeled directly on `sync_excel`'s adapter |
| Tax-number custom field (`ce.ts`) | Custom fields (EAV) | 1 | app | 1 | One declared field |
| Archived/GDPR/supplier-only filtering rules | none generic | 2 | app | 1 | Business rules inside the adapter |

#### WF3: Import Sales Invoices linked to Companies — Total: 8 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Xero API client (Invoices endpoint, `ACCREC` filter) | shared with WF2 | 0 | app | 0 | Already built in WF2 |
| `xero.invoices` `DataSyncAdapter` (header+lines mapping, amounts as-is) | `DataSyncAdapter` + existing caller-asserted invoice writes | 2 | app | 2 | Amounts plumbing is zero-gap; mapping code is new |
| `XeroInvoiceCustomerLink` extension entity + migration | `data/extensions.ts` pattern | 3 | app | 2 | The one real schema gap |
| Self-heal missing Contact resolution | none generic | 2 | app | 1 | One extra Xero GET call path |
| InvoiceNumber collision handling | DB unique constraint (existing) | 2 | app | 1 | Error-path handling, not new schema |
| Voided/deleted status mirroring | `SalesInvoice.status` (existing free-text field) | 1 | app | 1 | Just a status-string mapping rule |
| Read-only enforcement for Xero-sourced invoices | Mutation-guard registry + External-ID widget | 2 | app | 1 | Guard logic only; display is pure reuse |

#### WF4: Scheduled incremental sync — Total: 0 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Everything | `data_sync` scheduler/run/cursor/retry | 0 | platform (already exists) | 0 | Fully generic, nothing to build |

#### WF5: Reauthorize/disconnect — Total: 2 atomic commits

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Refresh-failure detection -> `reauthRequired` | `IntegrationState` (existing column) | 1 | app | 1 | Small: catch the specific Xero error, flag the column |
| Health check service | `integrationHealthService` | 1 | app | 1 | One `GET /connections` call as the check |

### Gap Summary

| Workflow | Business Priority | Atomic Commits (raw) | Workaround? | Commits (effective) | Blocks ROI? |
|---|---|---|---|---|---|
| WF1 Connect | High | 5 | No | 5 | Yes — nothing works without it |
| WF2 Contacts | High | 6 | No | 6 | Yes — invoices need Companies first |
| WF3 Invoices | High | 8 | No | 8 | Yes — this is the primary business value |
| WF4 Scheduled sync | Medium | 0 | No | 0 | No — on-demand alone still delivers value |
| WF5 Reauth | Medium | 2 | No | 2 | No — but silent staleness without it is a real risk |

**Total: 21 atomic commits** across all five workflows. No workaround was needed anywhere — every gap has a clean, sanctioned platform mechanism to build against (extension entity, mutation guard, custom field, `DataSyncAdapter`), even where the underlying code (OAuth flow, Xero API client) is genuinely new.

The Architect saved detailed commit plans to `.ai/specs/app-spec-notes/commits-WF1.md` through `commits-WF5.md` — **not yet written**; to be produced at feature-spec time (`om-spec-writing`), since atomic-commit-level task breakdown belongs there, not in this business-level document.

#### Checklist
- [x] Every workflow step scored in atomic commits
- [ ] Architect checkpoint: workflow-to-platform mapping verified by an independent subagent — **pending, see § 4.5 note**

> **Architect checkpoint note:** per the skill's process, a fresh-context subagent should review this gap analysis against the repo's AGENTS.md before Phase 2 starts, checking for (a) a missed platform capability that would reduce a gap score, and (b) overengineering. This is queued as the next step after this document is confirmed in shape by the user — see the end of this document for status.

---

## 4.5 Module Architecture `Architect`

### Platform capabilities used

| Capability | Usage | Extension points used | Notes |
|---|---|---|---|
| `integrations` registry/credentials/state/health/logs | as-is | `IntegrationDefinition`, `integrationCredentialsService`, `IntegrationState.reauthRequired`, `integrationHealthService` | Standard provider registration |
| `data_sync` adapter/run/cursor/schedule engine | as-is | `DataSyncAdapter` contract | Two entity types: `xero.contacts`, `xero.invoices` |
| `ExternalIdMappingService` | as-is | `lookupLocalId`/`storeExternalIdMapping` | `integrationId='xero'` |
| `customers` module commands | as-is | Company create/update via the module's own command pattern | No direct ORM writes |
| `sales` module commands | as-is | `sales.invoices.create`/`.update` | Amounts already caller-asserted |
| Custom fields (EAV) | extend | `ce.ts` on the Company profile entity | `xero_tax_number` |
| Entity extensions | extend | `data/extensions.ts` | `XeroInvoiceCustomerLink` |
| Mutation-guard registry | extend | Blocks manual edits on Xero-sourced invoices | New guard, existing registry |
| UMES widget injection | extend | Integration detail tab; reuse of the generic External-ID widget | No new display component needed for the link itself |
| Communication-channels OAuth helpers | use (`oauth-state.ts`, `oauth-token.ts`) + reference (route/refresh-coalescing shape) | `oauth-state.ts`/`oauth-token.ts` imported directly, exactly as `channel-gmail` already does (workspace-package import, not a violation of any cross-module rule); `credential-refresh.ts`'s coalescing logic and the route layer are `ChannelAdapter`-typed and not reusable as-is — those are rebuilt inside `sync_xero` following the same design |

### Shared modules (existing or proposed)

| Module | Status | Usage | Extension points | Rationale |
|---|---|---|---|---|
| `integrations` | EXISTING | use | Credentials/state/health/logs | Foundation layer, no changes needed |
| `data_sync` | EXISTING | use | `DataSyncAdapter` | Sync engine, no changes needed |
| `customers` | EXISTING | extend (custom field only) | `ce.ts` | Only touches Company via its own extension mechanism, never core entities |
| `sales` | EXISTING | extend (extension entity only) | `data/extensions.ts` | Only adds a link table, never modifies `SalesInvoice` |

No new shared/upstream module is proposed. **Correction from the initial draft (architect checkpoint finding):** the state-cookie and token-exchange helpers (`oauth-state.ts`, `oauth-token.ts`) are *already* the shared OAuth2 toolkit this section originally proposed extracting — `channel-gmail` already imports them across the package boundary today, so `sync_xero` is not the second provider that would justify building one; it is simply the second provider that *uses* the one that already exists. Only the route layer and the `ChannelAdapter`-typed refresh-coalescing logic remain genuinely un-reusable and are rebuilt per-provider (§ 0.2.1) — if a third OAuth2 provider needs that too, generalizing `credential-refresh.ts` into a non-`ChannelAdapter`-typed helper becomes a real, no-longer-hypothetical proposal at that point (not now — YAGNI still applies to that specific piece).

### App modules

| Module | Responsibility | Entities owned | Notes |
|---|---|---|---|
| `sync_xero` (package `@open-mercato/sync-xero`) | Xero OAuth connection, Contacts/Invoices sync adapters, invoice-customer link, tax-number custom field | `XeroInvoiceCustomerLink` (extension entity) | Single module — Xero-specific domain logic does not belong split across two modules; the OAuth/connection concern and the data-sync-adapter concern are two facets of one integration, not two bounded contexts |

#### Checklist
- [x] Every platform capability listed with usage type and extension points
- [x] Every listed capability traces to a workflow (§ 3)
- [x] No shared module proposed speculatively — the OAuth-toolkit opportunity is recorded as an open question, not built
- [x] Single app module, justified (one bounded context: "sync this tenant's Xero Organisation into OM")
- [x] No direct modification of platform/customers/sales code — only sanctioned extension points (custom field, extension entity, mutation guard, widget injection)

---

## 5. User Stories `PM`

> Every story traces to a workflow step (§ 3) and follows happy/alternate/failure per the DDD challenger's completeness bar.

### WF1: Connect a Xero Organisation

**US-1.1** As an OM Admin, I connect my Xero Organisation so that Contacts and Invoices can start syncing into OM.
Success: after consent, `IntegrationCredentials` holds valid tokens and exactly one `xeroOrganisationId`; the integration detail page shows "Connected" with the Organisation's name.
**Happy path:** Admin enters Client ID/Secret, clicks Connect, completes Xero consent for one Organisation, is redirected back to a "Connected" state.
**Alternate paths:** Admin authorizes multiple Organisations during consent -> a picker step lets them choose exactly one before the connection is considered complete.
**Failure paths:** Wrong Client ID/Secret -> Xero's consent/token step itself rejects it, OM shows a generic "could not connect to Xero" error without echoing Xero's raw response; user retries with corrected credentials, no partial state saved. Network timeout mid-exchange -> connection attempt fails cleanly, no `IntegrationCredentials` row is created or left half-populated; user retries.

**US-1.2** As an OM Admin, I disconnect Xero so that no further syncing happens once I no longer want it connected, and previously-imported invoices become editable again rather than staying permanently locked.
Success: `IntegrationState.isEnabled=false`, credentials cleared, all `xero.*` schedules paused (not deleted — re-enabling on reconnect restores them), and every invoice previously locked read-only by US-3.2's guard (§ 6.2) becomes editable again — `SyncExternalIdMapping` rows are left untouched so the "imported from Xero" link/history still displays.
**Happy path:** Admin clicks Disconnect, confirms, sees "Not connected"; a previously read-only Xero-sourced invoice is now editable.
**Alternate paths:** Admin disconnects mid-run -> in-flight `xero.*` `SyncRun`s are explicitly cancelled first (via `data_sync`'s existing `AbortSignal` cancellation), and only then are credentials cleared — this ordering avoids the next in-flight API call failing ambiguously against already-cleared credentials.
**Failure paths:** N/A — disconnect itself is a local state change with no external call that can fail; the only external call in this flow (cancelling an in-flight run) already has its own generic failure handling in `data_sync`.

### WF2: Import Contacts as Companies

**US-2.1** As an OM Admin, I run (or schedule) a Contacts sync so that Xero customers appear as Companies in OM without manual entry.
Success: every Xero Contact that is a customer (§ 6.4 filter) has exactly one OM Company; the run's create/update/skip/failed counts are visible in the Data Sync dashboard.
**Happy path:** New Contact with a matched or unmatched tax number -> Company is created or matched and updated.
**Alternate paths:** Re-running the same sync after no Xero changes -> every item resolves to `skip` (no-op, since `If-Modified-Since` excludes unchanged rows) or `update` with identical values if Xero re-touched the record without a real content change.
**Failure paths:** A Contact with no name-derivable data at all (should not occur in practice — `Name` is required by Xero — but the adapter treats a genuinely blank required field the same way `sync_excel` does: `failed`, not a crash) -> item reported `failed` with a clear message, run continues with the next item.

**US-2.2** As an OM Sales/CRM user, I view a Xero-imported Company's Xero link so that I know it's the real, current record from accounting.
Success: the Company detail page shows the Xero `ContactID`, last-synced timestamp, and sync status via the existing External-ID widget.
**Happy path:** Widget shows "Synced 4 minutes ago."
**Alternate paths:** N/A.
**Failure paths:** Last sync attempt for this record failed -> widget shows an error/stale sync status per the widget's existing generic states (no new UI needed).

**US-2.3** As an OM Sales/CRM user, my own edits to OM-only Company fields (owner, tags, notes) are never overwritten by the next Xero sync.
Success: after a re-sync, `ownerUserId`, tags, and comments are byte-identical to what the user last set; only Xero-owned fields (§ 6.2: name, tax number, address, active/archived status) changed if Xero changed them.
**Happy path:** User sets an owner and a tag on a Xero-imported Company; next sync updates the Company's address; owner/tag are untouched.
**Alternate paths:** N/A.
**Failure paths:** N/A — this is an invariant, not a user-triggered action; its violation would be a bug, not a failure path a user experiences interactively.

### WF3: Import Sales Invoices linked to Companies

**US-3.1** As an OM Admin, I run (or schedule) an Invoices sync so that Xero sales invoices appear in OM linked to the right Company.
Success: every `ACCREC`/`AUTHORISED` (or `VOIDED`) Xero invoice modified since the last cursor has exactly one OM `SalesInvoice`, linked via `XeroInvoiceCustomerLink` to the correct Company, with header/line amounts matching Xero exactly (no OM recalculation).
**Happy path:** Invoice's Contact was already synced in a prior Contacts run -> invoice is created/updated and linked immediately.
**Alternate paths:** Invoice's Contact has not been synced yet -> the adapter self-heals by fetching that one Contact directly from Xero, creates the Company on the fly, then proceeds with the invoice.
**Failure paths:** Self-heal also fails (Contact deleted/inaccessible, or filtered out as supplier-only) -> invoice item is `failed` with error code `xero.invoice_contact_unresolved`; no `SalesInvoice` is created for that item. Link creation fails after the invoice itself was created (e.g. a constraint violation on `XeroInvoiceCustomerLink`) -> **no true single-transaction guarantee exists across this boundary**, because `SalesInvoice` and `XeroInvoiceCustomerLink` are owned by two different modules (`sales` and `sync_xero`) and the platform's "no direct ORM relationships between modules" rule means there is no shared database transaction spanning a `sales` command and a `sync_xero`-owned write. The adapter's actual sequence is: (1) `sales.invoices.create`, (2) create the link row immediately after in the same adapter step; if (2) fails, the adapter issues a compensating `sales.invoices.delete` on the just-created invoice and reports the item `failed` — never leaving an unlinked invoice behind. This is safe under `data_sync`'s replay-safety contract: a retry re-runs the same `ContactID`/`InvoiceID`-keyed upsert and either completes cleanly or repeats the same compensation, with no duplicate created either way. InvoiceNumber collides with a pre-existing unrelated OM invoice -> item is `failed` with a collision error at step (1), before any link is attempted; the pre-existing invoice is untouched.

**US-3.2** As an OM Sales/CRM user, I cannot edit fields on a Xero-sourced invoice while the Xero connection is active, so it never silently diverges from the accounting record.
Success: attempting `sales.invoices.update`/`.delete` on an invoice with an active Xero external-id mapping **and** an enabled Xero connection (§ 6.2) is rejected by the mutation guard with a clear "managed by Xero" message; the invoice detail UI renders those fields read-only. Disconnecting Xero (US-1.2) lifts this restriction on every such invoice — there is no per-invoice unlock because the whole-connection disconnect already serves that purpose.
**Happy path:** User opens a Xero-sourced invoice while Xero is connected, sees read-only fields and a link to the Xero record.
**Alternate paths:** Xero is disconnected (US-1.2) -> the same invoice is now fully editable, with its Xero-link history still visible via the External-ID widget.
**Failure paths:** User attempts the edit via direct API call (bypassing the read-only UI) while still connected -> the mutation guard still rejects it server-side; UI and API are consistent.

**US-3.3** As an OM Sales/CRM user, I see an invoice's payment status (paid/partially paid/outstanding) sourced from Xero so I don't have to check Xero separately.
Success: `paidTotalAmount`/`outstandingAmount` on the OM Invoice match Xero's `AmountPaid`/`AmountDue` as of the last sync.
**Happy path:** Xero invoice partially paid -> OM shows the same partial amounts.
**Alternate paths:** Invoice fully paid in Xero between syncs -> next sync updates the amounts; OM never shows a payment as reversed unless Xero itself reports it that way.
**Failure paths:** N/A — this is a read-only projection of already-imported data.

### Cross-Story Impact Matrix

| Story | State changed | Stories affected | Impact | Mitigation |
|---|---|---|---|---|
| US-1.2 (Disconnect) | `IntegrationState.isEnabled=false`, schedules paused | US-2.1, US-3.1 | Scheduled runs must stop cleanly, not error repeatedly against dead credentials | `data_sync`'s existing schedule-pause behavior on a disabled integration (reused, not new) |
| US-2.1 (Contact sync) | New/updated Company, new/updated external-id mapping | US-3.1 (Contact resolution), US-2.2, US-2.3 | An invoice import running concurrently with a contact import for the *same* Contact could race on the mapping row | `storeExternalIdMapping`'s existing upsert-with-dedup logic (§ platform research) already collapses a race into one canonical mapping row; `data_sync`'s per-`(integration, entityType, direction)` overlap detection additionally prevents two `xero.contacts` runs from racing each other (it does not prevent a `xero.contacts` and `xero.invoices` run from running concurrently, which is expected and fine since they target different entity types) |
| US-3.1 (Invoice sync) | New `SalesInvoice` + `XeroInvoiceCustomerLink` | US-3.2, US-3.3 | An invoice must never exist without its link (US-3.2's read-only guard keys off the mapping, not the link, so this is not a hard dependency, but a dangling invoice-without-a-company would be a silent CRM gap). `SalesInvoice` (owned by `sales`) and `XeroInvoiceCustomerLink` (owned by `sync_xero`) are two different modules' writes, so there is no shared DB transaction across them (the platform bans cross-module ORM relationships) | Sequential writes with compensation, not a shared transaction: invoice create, then link create; a link-create failure triggers a compensating invoice delete so no unlinked invoice survives, safe to retry under `data_sync`'s replay-safety contract (§ WF3 US-3.1 failure paths) |
| US-2.3 (field ownership) | none — this is a negative invariant | US-2.1 | A future re-sync could accidentally touch an OM-only field if a developer maps a new Xero field carelessly | Field-ownership table (§ 6.2) is the single source of truth for which fields the adapter is allowed to write; enforced by code review against this spec, not by a runtime mechanism (no platform primitive for "OM-only field" exists — noted as a lightweight risk, not a blocker) |
| US-1.2 (Disconnect + later reconnect to a *different* Organisation) | Credentials point at a new `xeroOrganisationId` | US-2.1, US-3.1 | Existing external-id mappings still reference the *old* Organisation's GUIDs; a fresh sync against a new Organisation would treat everything as new | Flagged as § 10 open question — Phase 1 does not auto-detect or warn on an Organisation switch |
| US-1.2 (Disconnect, credential clearing vs. in-flight run) | Credentials cleared, `isEnabled=false` | WF2/WF3 in-flight runs | Clearing credentials while a run is still mid-page would make the next Xero API call fail ambiguously (looks like an auth error, not a deliberate stop) instead of failing via the documented cancellation/reauth paths | Disconnect **cancels any in-flight `xero.*` runs first** (via `data_sync`'s existing `AbortSignal` cancellation, same mechanism any operator-triggered cancel uses) and only clears credentials once cancellation is acknowledged — sequencing, not a new mechanism |
| US-1.2 (Disconnect, permanent) | `IntegrationState.isEnabled=false`; `SyncExternalIdMapping` rows are NOT deleted (kept for historical Xero-link display) | US-3.2 (read-only guard) | Without a rule, every invoice ever synced stays permanently locked read-only forever after a deliberate, permanent disconnect (e.g. a tenant switching off Xero for good) — since § 6.2's read-only guard keys off mapping *existence*, and mappings are intentionally never cleaned up on disconnect. Phase 1 also provides no per-invoice unlock override (US-3.2). This was a real dead end, not an edge case | **Resolved in § 6.2's revised rule**: the mutation guard now also checks `IntegrationState.isEnabled` — a Xero-sourced invoice is read-only only while the integration is connected AND enabled. Disconnecting releases the lock on every previously-synced invoice (the mapping itself is untouched, so the "Managed by Xero" link/history display still shows where the data came from) |

#### Checklist (domain stories)
- [x] Every story has persona + action + measurable outcome + success criteria
- [x] Every story has alternate and failure paths (US-1.2, US-2.3, US-3.3 note explicitly where a path is N/A and why)
- [x] Every story traces to a workflow step
- [x] Identity checkpoint per story — all internal, `integrations.*`/`data_sync.*`/`customers.*`/`sales.*` features
- [x] No weak stories — every story names a concrete action and outcome, not "manage"/"handle"

### Default User Stories

**US-0.1** As someone evaluating this integration, I connect a Xero Demo Company and run a first sync so that I can see the feature working without needing a real Xero account with real financial data.
Success: local dev setup instructions (§ 0.1, "Demo Company") let a developer register a Xero Web app with a `localhost` redirect URI, connect the Demo Company, and see its pre-populated sample Contacts/Invoices land in OM.

**US-0.2** N/A in the seeded-demo-data sense the template describes (this integration pulls from a real external system, it does not seed synthetic OM demo data) — the Xero Demo Company itself plays that role (US-0.1).

#### Checklist (default stories)
- [x] US-0.1 defined against the Xero Demo Company (the platform's own seed-data convention doesn't apply to an import-only integration pulling from a live external sandbox)

---

## 6. Decisions Requested `PM` — matching, re-import, and scope questions the brief asked to be presented, not decided silently

### 6.1 Matching keys

**Contacts -> Company:**

| Candidate key | Reliability | Risk |
|---|---|---|
| `ContactID` (via id-mapping, after first sync) | Highest — Xero-guaranteed unique, immutable | None once a mapping exists; irrelevant on first sync of a never-before-seen Contact |
| `TaxNumber` (normalized: strip whitespace, uppercase) | Medium | Often blank (not required by Xero, especially for contacts in countries without VAT); formatting drift (country-prefix vs not) mitigated by normalization but not eliminated; not Xero-enforced-unique (rare but possible for two contacts to share one, e.g. sibling entities) |
| `CompanyNumber` (registration number) | Low-medium | Same caveats as `TaxNumber`, and typically filled in even less often by SMB Xero users |
| `ContactNumber`/`AccountNumber` | Low, as a **first-run** key | Meant for exactly this "your external system's key" purpose, but is blank unless the Xero org already used a *different* prior integration — high-value if present, rare in practice |
| `Name` | Not usable as an auto-match key | Xero does not enforce uniqueness; casing/punctuation drift is common ("Acme Ltd" vs "ACME LTD.") |

**Recommendation:** `ContactID` via id-mapping is the sole primary key (always wins once it exists). On first sync only, fall back in order to `TaxNumber` (normalized), then `CompanyNumber` (normalized), both matched against the new `xero_tax_number` custom field (§ 1.4) — if either matches exactly, link to that existing Company; the match is logged in the run log as "matched existing company by tax/registration number" for transparency. **Never auto-match on `Name` alone.** A Contact whose Name matches an existing Company but whose tax/registration numbers don't (or are blank on either side) still creates a new Company, and is surfaced as a **soft duplicate-risk warning** in the run log — the same "warn, don't silently merge, don't hard-block" pattern `sync_excel`'s foundation spec already established for its own duplicate-risk warnings.

**A real limitation of the tax-number fallback, stated plainly (raised by DDD review):** `xero_tax_number` is a field this integration itself introduces (§ 1.4) — it does not exist on any Company created before Phase 1 ships. That means the fallback can only ever match a Company that (a) was created by an earlier Xero sync (which already has a `ContactID` mapping and therefore never needs the fallback), or (b) had `xero_tax_number` populated deliberately by an admin ahead of the first sync. **It does not, by itself, prevent duplicate creation against a pre-existing, manually-entered OM Company on a tenant's very first Xero sync** — that Company's tax ID, if it has one, almost certainly lives in a different field (a generic custom field the tenant already uses, free text in `description`, or nowhere at all). Two things follow: first, the admin-facing setup guidance for WF1/WF2 (feature-spec level, not this document) should explicitly recommend that tenants with existing manually-entered Companies populate `xero_tax_number` on them before running the first Contacts sync, if they want first-sync dedup to work; second, this spec does not claim first-sync dedup against arbitrary legacy data is solved — soft duplicate-risk warnings (Name-based, never auto-linking) are the only safety net for that case, and are accepted as sufficient for Phase 1 rather than building a heavier matching UI (§ 10 Open Question, new entry below).

**Invoices -> OM Invoice:**

`InvoiceID` via id-mapping is the **only** matching key — no fallback. `InvoiceNumber` is rejected as a fallback because (a) OM already enforces a hard DB-unique constraint on `(organizationId, tenantId, invoiceNumber)` that a Xero-assigned number could collide with a pre-existing, unrelated manually-created OM invoice, and (b) for `ACCPAY` bills `InvoiceNumber` is the supplier's own free-text reference with no uniqueness guarantee at all (moot for Phase 1 since only `ACCREC` is in scope, but worth recording so a later Bills phase doesn't repeat this mistake). A genuine collision is a `failed` item with a clear error, resolved manually by the admin (rename the pre-existing OM invoice, or accept the failure and investigate) — not auto-resolved by suffixing or renaming, which would silently diverge from Xero's own numbering.

### 6.2 Re-import / overwrite behavior

**How the reference CSV import (`sync_excel`) behaves today:** unconditional partial overwrite. On every re-run, any mapped CSV column that has a non-blank value for a row **always overwrites** the corresponding OM field; a blank cell is simply omitted from the update payload, leaving the existing value untouched. There is no skip/merge mode, no configurability, and no concept of a "locked" or "read-only" field — a user could manually edit an imported field in OM and it would be silently clobbered on the next CSV re-import of the same source row. Visibility beyond the run's own create/update/skip/failed log is limited to whatever `audit_logs`/command-history capture generically (not CSV-specific).

**Options considered for Xero, evaluated against that precedent:**

| Option | Description | Trade-off |
|---|---|---|
| A — Full Xero authority + read-only enforcement (Invoices), field-level ownership (Companies) — **the user's starting position** | Xero-sourced invoice fields are always overwritten and the OM UI/API refuse manual edits to them (enforced via a mutation guard). Company fields Xero owns are overwritten; OM-only fields (owner, tags, notes, non-Xero custom fields) are never touched. | Strongest data-integrity guarantee for legally-relevant invoice data; requires new (small) guard logic beyond what CSV import does. For Companies, this is actually **weaker** than "requires new work" — it matches what `sync_excel` already does implicitly (partial, mapped-fields-only overwrite), just made an explicit, documented rule rather than an accident of how `updateInput` happens to be built. |
| B — CSV-style unconditional overwrite, no read-only enforcement anywhere | Simplest, zero new guard code, matches precedent exactly. | For invoices specifically, silently overwriting a user's manual correction (e.g., a fixed due date) with stale-if-sync-lagged Xero data is worse than for CRM contact data — invoices are legal financial documents where silent divergence-then-clobber is a real integrity risk, not just an annoyance. |
| C — "Last local edit wins" (skip the overwrite if OM's `updated_at` is newer than the mapping's `lastSyncedAt`) | Avoids clobbering a deliberate local edit. | Breaks the stated business goal outright — "Xero is source of truth" is no longer true the moment a user edits something in OM, and the two systems can silently diverge with no way to tell which one is "right" without manually diffing. Also more code than Option A, not less. |

**Recommendation: Option A, exactly as proposed, with three concrete implementation notes:**
1. For **Invoices**, "Xero-sourced" is derived from the existence of a `SyncExternalIdMapping` row (`integrationId='xero', internalEntityType='sales.invoice'`) **AND** `IntegrationState.isEnabled=true` for the connection — not mapping existence alone, and not a new stored flag. The mutation guard checks both at write time; the detail-page UI checks the same pair at render time via the External-ID widget. **The `isEnabled` half of this check is the fix for a real dead end the DDD review surfaced:** without it, an invoice imported once and then the tenant permanently disconnecting Xero (switching accounting systems, cancelling the integration) would stay locked read-only forever, with Phase 1's US-3.2 providing no per-invoice unlock override. Gating the guard on `isEnabled` means disconnecting releases every previously-synced invoice back to normal editability — the `SyncExternalIdMapping` row itself is untouched, so the Xero-link display/history is preserved, only the write-block lifts. Reconnecting re-arms the guard for any invoice whose mapping still exists. This is a one-line addition to the guard's condition, not new infrastructure.
2. For **Companies**, field-level ownership is **already the CSV importer's actual behavior** (only mapped, non-blank fields are ever written) — this spec just makes explicit, in § 1.4/§ 3, exactly which fields Xero owns (`displayName`/`legalName`, `primaryEmail`, `primaryPhone`, addresses, `xero_tax_number`, `status`/`isActive`) versus which are always OM-only (`ownerUserId`, tags, comments, deals, `industry`/`sizeBucket`/`annualRevenue`, any non-Xero custom field).

**Visibility of import-driven changes:** the Data Sync run detail page's existing per-item log (create/update/skip/failed) is sufficient for Phase 1 — it already answers "what did the last sync do to this record." A full field-level diff/history view is out of scope for Phase 1 (no platform primitive for this exists beyond whatever `audit_logs` captures generically for command-based writes, which this integration gets for free since it writes through the same commands as everything else, but is not guaranteed to render a human-friendly diff) — recorded as a possible Phase 2+ enhancement, not a Phase 1 requirement, since neither workflow's ROI depends on it.

### 6.3 Invoice data scope (MVP)

The user's proposed MVP — sales invoices only (`ACCREC`), header + line items, currency code and amounts stored as-is, payment status from the invoice itself (`status`, `AmountPaid`, `AmountDue`) — **is fully supported by the existing `SalesInvoice`/`SalesInvoiceLine` schema with exactly one gap** (the Company link, § 1.4/§ 5.1). This spec keeps that scope as proposed, refined with two necessary edge-case rules that are not scope *expansions*, just correctness rules the MVP needs to not do the wrong thing:
- Only `Status IN (AUTHORISED, VOIDED)` invoices are pulled — `DRAFT`/`SUBMITTED` are not yet real financial documents and would misrepresent OM's sales reporting if imported (§ 6.4).
- Voided invoices are mirrored with `status='voided'`, never deleted (§ 3, WF3 edge case 3).

**Deferred to later phases** (unchanged from the user's proposal, validated against the schema): Bills (`ACCPAY`) — genuinely has no target entity in OM today (no purchasing/AP module exists in the repo), a materially bigger design effort than "add a field," correctly deferred indefinitely pending a purchasing-side module existing at all. Credit notes — `SalesCreditMemo`/`SalesCreditMemoLine` already exist and already support linking to an invoice, a natural, low-gap Phase 2 candidate. Detailed multi-payment records — `SalesPayment`/`SalesPaymentAllocation` already exist, another natural low-gap Phase 2 candidate once aggregate paid/outstanding (Phase 1) proves the pattern. Invoice PDFs/attachments — the generic `attachments` module already exists and would be a thin adapter addition, not a new subsystem.

### 6.4 Archived/voided/deleted records, and individuals vs. companies

| Xero state | OM treatment | Rationale |
|---|---|---|
| Contact `ContactStatus=ARCHIVED` | Company `status='archived'`, `isActive=false` — never deleted | Preserves referential integrity for any deals/invoices/activities already attached to the Company in OM |
| Contact `ContactStatus=GDPRREQUEST` | Status flip only (as above); existing PII fields are **not** overwritten with Xero's now-blanked values | Overwriting with blanks would destroy OM's own historical record of a redacted contact; flagged as a judgment call worth a compliance sign-off, not purely an engineering decision — see § 10 |
| Invoice `Status=VOIDED` | OM Invoice `status='voided'`, never deleted | A voided invoice remains a real historical document Xero itself never removes |
| Invoice `Status=DELETED` | Not applicable to Phase 1 — only `AUTHORISED`/`VOIDED` are ever pulled, so a Xero-side delete (only possible pre-authorisation) is never observed | Documents the "why don't drafts appear" answer for support/debugging |
| Contact is an individual (has `FirstName`/`LastName`, no obvious company signal) | Imported as a Company anyway, uniformly | See below |
| Contact is supplier-only (`IsSupplier=true`, `IsCustomer=false`, never referenced by an imported invoice) | **Filtered out — no Company created** | Bills (the only reason a pure supplier would matter) are out of MVP scope; importing vendors into a CRM's "Companies" list would misrepresent them |

**Individuals vs. companies — three options considered:**

1. **Import every Contact uniformly as an OM Company** (recommended) — Xero has no reliable, structured "this is an individual/sole trader" flag (only a heuristic: `FirstName`/`LastName` populated). Treating every accounts-receivable party the same way keeps the Invoice-to-Contact link uniform (always Company via `XeroInvoiceCustomerLink`) and avoids a second, parallel Invoice-to-Person link type for a fuzzy classification that would sometimes be wrong anyway.
2. Heuristically classify into Person vs. Company based on `FirstName`/`LastName` presence — more semantically "correct" for OM's CRM in theory, but the heuristic is fragile (many Xero orgs put an individual's full name only in the `Name` field), and it doubles the invoice-linking design (needs both a Company-link and a Person-link path) for a distinction Xero itself doesn't reliably make.
3. Filter out anything that looks like an individual entirely — loses real customer data for tenants who do invoice individuals (sole traders, consumers) through Xero.

**Recommendation:** Option 1, combined with the supplier-only filter above — import a Contact as a Company only when it is (or becomes, via an imported invoice) a customer; never classify into Person vs. Company.

### 6.5 Import order and failure handling

Contacts and Invoices are two separate `supportedEntities` values (`xero.contacts`, `xero.invoices`) on one adapter, consistent with how `data_sync` already models per-entity-type runs and schedules — an admin can sync either independently. To avoid an operator-managed "always schedule Contacts before Invoices" foot-gun, the Invoices adapter **self-heals** a missing Contact mapping by fetching that one Contact directly from Xero on demand when it's first needed, rather than requiring strict global ordering. If the self-heal also fails (Contact inaccessible, deleted, or filtered out as supplier-only), the invoice item is reported `failed` with a stable error code (`xero.invoice_contact_unresolved`) and is **not** auto-retried by the next incremental run (its cursor position has already advanced past it, per how `If-Modified-Since` incremental sync works) — visible in the run's failed-item list, resolved by the admin triggering a full resync if needed. This reuses `data_sync`'s existing failed-item visibility and "run as full sync" mechanism rather than inventing a new retry-queue.

### 6.6 Rate limiting and partial failures — what's reused vs. genuinely new

**Reused as-is from existing OM modules:** queue-based workers with bounded concurrency, cursor persistence after every batch (resume on failure), per-item error logging that never aborts the whole run, `ProgressJob`-based progress reporting, the run detail page's failed-item list, the retry endpoint, cancellation via `AbortSignal`, CRON scheduling via the platform's generic scheduler, and `data_sync`'s existing overlap detection preventing two concurrent runs of the same entity type.

**Genuinely new, and correctly scoped to live inside the `sync_xero` package (never inside `data_sync`, per its "never special-case provider credentials/logic" rule):** a small rate-limiter honoring Xero's documented 60-calls/minute-per-Organisation cap, and a `429`-aware retry that reads `Retry-After` before resuming. A very large tenant's first full sync may take multiple sync windows purely from Xero's 5,000-calls/day cap — this is a real constraint on first-sync duration for large accounts (flagged in WF3's edge cases), not a design flaw; the adapter's batch size is tuned modestly (matching Xero's own ~100-per-page paging) so this stays well within the per-minute cap even during a large backfill.

#### Checklist
- [x] Matching keys recommended per entity with fallbacks and named risks
- [x] Re-import behavior evaluated against the CSV precedent, options presented, one recommended with rationale
- [x] Archived/voided/deleted/individual handling decided with rationale
- [x] Import order/failure handling designed against the existing `data_sync` failure model
- [x] Rate limiting placed correctly (provider package, not the generic sync engine)

---

## 7. Phasing & Rollout `PM`

### Phase 1: Connect + Contacts

**Goal:** An admin can connect their Xero Organisation and see Xero Contacts appear as OM Companies, matched correctly against any pre-existing OM data.

**Why this order:** Nothing else in this spec works without a connection, and Invoices (Phase 2) cannot be meaningfully linked without Companies existing first.

| Story | What ships | Commits |
|---|---|---|
| US-1.1, US-1.2 | OAuth connect/disconnect flow, multi-organisation picker | 5 |
| US-2.1, US-2.2, US-2.3 | Contacts sync adapter, tax-number matching + custom field, field-ownership rules, on-demand + scheduled runs | 6 |

**Total: 11 atomic commits**
**Workaround:** None.

**Acceptance criteria:** `DDD writes, PM challenges`

**Domain criteria** `DDD`:
- [x] Exactly one `IntegrationCredentials` row exists per OM tenant+organization for `integrationId='xero'` at any time — no orphaned or duplicate rows after a reconnect.
- [x] A `SyncExternalIdMapping` row for a given `(integrationId='xero', internalEntityType='customers.company', externalId)` is unique — `storeExternalIdMapping`'s existing dedup-on-write logic (§ platform research) guarantees this, reused not reimplemented.
- [x] `CompanyCreated`/`CompanyUpdated`-equivalent domain events (via the customers module's own command-driven side effects) fire for every Xero-sourced Company change, exactly as they would for a manually created Company — no bypass of the module's own event/audit/index side effects.
- [x] An OM-only Company field (owner, tags, notes, non-Xero custom fields) is never present in the payload sent to the update command for a Xero-sourced change.

**Business criteria** `PM`:
- [x] An admin can connect a Xero Demo Company end-to-end and see it reflected as "Connected" within the same session.
- [x] An admin can trigger a Contacts sync on demand and see accurate create/update/skip/failed counts.
- [x] A sales/CRM user can open an imported Company and see it behaves exactly like a manually created one (editable OM-only fields, visible Xero link) with no visible difference in the UI shell.

**Value delivered:**
- **Business value:** Zero manual re-keying of Xero customer records into OM's CRM.
- **ROI metric:** For a tenant's full Xero contact list, 100% land as OM Companies with zero duplicate creation on a second run of the same sync.

**PM's challenges to the DDD criteria:** None cut — all four are either already-existing platform guarantees being reused (dedup-on-write, command-driven events) or a direct expression of § 6.2's field-ownership decision the business explicitly asked for. All accepted.

### Phase 2: Sales Invoices

**Goal:** An admin can sync Xero sales invoices into OM, each correctly linked to its Company, with amounts matching Xero exactly and protected from silent local divergence.

**Why this order:** Depends on Phase 1's Companies existing (or being self-healed on demand); this is where the primary "no manual re-keying of financial data" value is delivered.

| Story | What ships | Commits |
|---|---|---|
| US-3.1 | Invoices sync adapter, self-heal Contact resolution, `XeroInvoiceCustomerLink` | 6 |
| US-3.2 | Mutation guard making Xero-sourced invoice fields read-only | 1 |
| US-3.3 | Payment-status projection (reuses US-3.1's mapping, no extra commit) | included above |

**Total: 8 atomic commits** (aligned with § 4's WF3 total minus the InvoiceNumber-collision handling and voided/deleted mirroring already folded into "Invoices sync adapter" above)

**Workaround:** None.

**Acceptance criteria:** `DDD writes, PM challenges`

**Domain criteria** `DDD`:
- [x] Every `SalesInvoice` created by this integration has exactly one `XeroInvoiceCustomerLink` row — never zero (would be an unlinkable financial record), never more than one (the unique index enforces this).
- [x] An invoice's `grandTotalGrossAmount`/`taxTotalAmount`/etc. are byte-identical to what Xero reported at last sync — no OM-side recalculation path may touch them (already true today per § 0.2.3; this criterion exists to guard against a future regression, e.g. someone wiring `salesCalculationService` into the invoice write path).
- [x] A `sales.invoices.update`/`.delete` call against a Xero-sourced invoice is rejected at the command/mutation-guard layer, not only hidden in the UI — an API client bypassing the UI gets the same protection.
- [x] `SyncExternalIdMapping` for `sales.invoice` is the sole source of truth for "is this invoice Xero-sourced" — no second, potentially-inconsistent flag is introduced.

**Business criteria** `PM`:
- [x] An admin can sync invoices from the Xero Demo Company and see them appear against the correct (Demo Company's own) customer records.
- [x] A sales/CRM user cannot edit a Xero-sourced invoice's amount fields through the normal UI.
- [x] An invoice whose Contact wasn't yet synced still successfully imports via self-heal, without requiring the admin to manually re-order two syncs.

**Value delivered:**
- **Business value:** OM's sales reporting and per-Company invoice history reflect real, current Xero financial data with no manual entry and no risk of a user accidentally corrupting a legally-relevant document.
- **ROI metric:** For a tenant's full set of `ACCREC`/`AUTHORISED`+`VOIDED` invoices, 100% land as correctly-linked OM Invoices; zero silent amount discrepancies between Xero and OM after any sync.

**PM's challenges to the DDD criteria:** The PM initially questioned whether "reject at the command layer, not just the UI" is over-engineering for an MVP — but since the read-only guarantee is the entire justification for choosing Option A over the simpler Option B in § 6.2, a UI-only enforcement that an API client could trivially bypass would silently fail to deliver the business property this phase exists to provide. Accepted as essential, not cut.

### Phase 3: Scheduled sync hardening + reauthorization UX

**Goal:** Xero data stays current automatically, and a broken connection is surfaced and fixable within minutes, not discovered weeks later as stale data.

**Why this order:** Phases 1-2 already work fully on-demand; this phase is what makes the integration safe to leave unattended, which is the difference between a demo and something a client would actually run their business on.

| Story | What ships | Commits |
|---|---|---|
| WF4 (no new stories — scheduling is configuration, not a new story) | CRON schedule setup guidance, documentation | 0 (pure config via existing Data Sync UI) |
| WF5 reauth flow (folds into US-1.1's connect flow, reused) | Refresh-failure detection, `reauthRequired` flagging, health check | 2 |

**Total: 2 atomic commits**
**Workaround:** None.

**Acceptance criteria:** `DDD writes, PM challenges`

**Domain criteria** `DDD`:
- [x] A refresh-token failure never leaves the integration silently "Connected" while actually non-functional — `reauthRequired` must flip within one health-probe interval (15 minutes) of the failure.
- [x] No scheduled job keeps firing indefinitely against dead credentials without eventually surfacing the failure to an admin (via the existing health/reauth mechanism, not a new one).

**Business criteria** `PM`:
- [x] An admin sees a clear "Reconnect to Xero" prompt within 15 minutes of the refresh token dying, without needing to notice stale data first.
- [x] Reconnecting restores scheduled syncs without the admin having to re-create the schedule from scratch.

**Value delivered:**
- **Business value:** The integration is safe to leave running unattended for months — the single realistic long-term failure mode (a 60-day-unused or revoked refresh token) is self-surfacing.
- **ROI metric:** Time from token failure to a visible admin-facing prompt: ≤15 minutes (one health-probe interval), versus potentially weeks of silently stale data without this phase.

**PM's challenges to the DDD criteria:** None cut — both criteria are minimal and directly reuse existing platform mechanisms (`reauthRequired`, health probe); there was nothing to trim.

### Rollout Summary

```
Phase 1: Connect + Contacts              11 commits    WF1, WF2
Phase 2: Sales Invoices                   8 commits    WF3
Phase 3: Scheduled sync hardening         2 commits    WF4, WF5
                                          ---------
                                          21 atomic commits total
                                          21 commits for production-ready (Phases 1-3)
```

#### Checklist
- [x] Phases ordered by business priority x gap score x blocker status (Connect/Contacts must exist before Invoices can link to anything; hardening is valuable but not blocking)
- [x] Each phase delivers a complete, usable increment
- [x] No workarounds needed anywhere — no phase to document one for
- [x] Total atomic commits estimated per phase
- [x] Acceptance criteria per phase: DDD wrote domain criteria, PM challenged them (Phase 2's challenge is recorded; Phases 1 and 3 had nothing worth cutting)
- [x] Business value + ROI metric stated per phase

---

## 8. Cross-Spec Conflicts `PM`

| Conflict | Specs involved | Resolution |
|---|---|---|
| `.ai/specs/2026-09-07-sales-external-amounts-mode.md` proposes a `totals_mode`/`amounts_mode` column pair for **Orders**, explicitly excluding Invoices because "they already behave this way" | This spec, `2026-09-07-sales-external-amounts-mode.md` | No conflict — this spec relies on the *existing* caller-asserted invoice-write behavior that the Orders spec cites as precedent; if that Orders spec later changes how Invoices work (it currently says it won't), this spec's § 0.2.3 finding must be re-verified before Phase 2 implementation |
| `.ai/specs/2026-03-29-sync-excel-customers-import-foundation.md` establishes the matching/dedup reference behavior this spec follows | This spec | No conflict — this spec explicitly follows that precedent (§ 6.1, § 6.2) rather than inventing a divergent one; if that spec's matching rules change, this spec's § 6.1/§ 6.2 rationale should be re-checked |
| `.ai/specs/2026-03-29-google-workspace-integration.md` (Draft, not yet implemented) independently designs a provider-owned OAuth flow with the same shape this spec proposes for Xero (initiate/callback/disconnect routes inside the provider package) | This spec, the Google Workspace spec | No conflict — both specs converge on the same route-layer pattern independently, which corroborates it as the right approach given no generic OAuth *route* mechanism exists (§ 0.2.1). Both should import `communication_channels`' `oauth-state.ts`/`oauth-token.ts` directly rather than each re-deriving state-cookie crypto; if the Google Workspace integration ships first, this spec's Phase 1 OAuth work should confirm it used the same two helpers rather than inventing a third variant |

Every entity this spec references (`CustomerEntity`, `CustomerCompanyProfile`, `SalesInvoice`, `SalesInvoiceLine`, `IntegrationCredentials`, `IntegrationState`, `SyncExternalIdMapping`, `SyncRun`, `SyncSchedule`) is owned by an existing module (`customers`, `sales`, `integrations`, `data_sync` respectively); this spec owns only the new `XeroInvoiceCustomerLink` extension entity and the `xero_tax_number` custom field. No entity ownership conflict exists.

#### Checklist
- [x] All related specs listed with what each contributes
- [x] Identity model consistent across specs (internal-only, no portal — nothing to conflict with)
- [x] Terminology consistent — matches § 1.3 glossary
- [x] Shared entities owned by one spec each; new entities are this spec's own
- [x] Every conflict has a resolution, not "TBD"

---

## 9. Reference App Quality Gate `Architect`

N/A — this is a real feature for a real product, not a reference/example app.

---

## 10. Open Questions `PM`

| # | Question | Options | Impact | Owner | Status |
|---|---|---|---|---|---|
| 1 | Should GDPR-erased (`ContactStatus=GDPRREQUEST`) Contacts propagate their now-blanked PII fields into OM, overwriting existing data? | (a) Never overwrite with blanks, only flip status (recommended, § 6.4) (b) Always overwrite, including with blanks, for strict "Xero is truth" consistency | Medium — a compliance/legal judgment call as much as an engineering one | PM + legal/compliance stakeholder | Open — recommended default (a) stands pending explicit sign-off |
| 2 | Should reconnecting Xero to a **different** Xero Organisation than previously connected invalidate/flag existing external-id mappings from the old Organisation? | (a) No special handling in Phase 1 (as currently designed) — a fresh sync just treats everything as new against the new Organisation, old mappings become inert but are not cleaned up (b) Detect an Organisation-id change and prompt the admin with an explicit warning/cleanup step | Low for Phase 1 (single-Organisation-per-tenant is the common case and switching is rare/deliberate), but a real data-hygiene question if it happens | PM | Open — Phase 1 ships with option (a); revisit if support tickets show this is a real pain point |
| 3 | Should the Phase 1 fixed field mapping (no `sync_excel`-style configurable mapping UI) be revisited once real tenants use this? | (a) Keep fixed/hardcoded for as long as it covers real needs (current design) (b) Build a configurable mapping UI matching `sync_excel`'s pattern | Low now, potentially medium later | PM | Open — deferred, not a Phase 1-3 blocker |
| 4 | Should the `ChannelAdapter`-typed refresh-coalescing logic in `credential-refresh.ts` be generalized into a reusable, non-`ChannelAdapter`-typed helper, now that `sync_xero` needs the same single-flight-refresh behavior `communication_channels` already solved? (Note: this question narrowed after the architect checkpoint — `oauth-state.ts`/`oauth-token.ts` are already reusable and require no decision, just a direct import) | (a) Not now — `sync_xero` reimplements its own small refresh-coalescing logic (b) Generalize `credential-refresh.ts` now, alongside this integration, since two real providers would then use it | Low for this spec's own delivery, potentially valuable platform-wide if a third OAuth2 provider follows | Architect | Open — recorded per § 4.5, not a Phase 1-3 blocker |
| 5 | Confirm the exact generated entity-id literal for the Company profile custom-field target (`E.customers.customer_company_profile` or equivalent) | N/A — a verification task, not a design choice | Low | Architect (feature-spec time) | Open — trivial, resolved by reading `entities.ids.generated.ts` when the feature spec is written |
| 6 | Verify current Xero API details against live docs before Phase 1 implementation (exact scope names, rate-limit figures, page sizes) — see § 0.1's verification checklist | N/A — a verification task | Medium — implementation would be built against possibly-stale trained-knowledge figures otherwise | PM/Architect (pre-implementation) | Open — blocks nothing in this spec, but blocks safe implementation start |
| 7 | Should Phase 1's admin-facing setup guidance instruct tenants with pre-existing, manually-entered Companies to populate `xero_tax_number` before the first Contacts sync, to make § 6.1's tax-number fallback matching actually useful against legacy data (raised by DDD review — the fallback otherwise only ever matches Companies a prior Xero sync already created)? | (a) Yes — document it as a recommended pre-sync step (b) No — accept that first-sync dedup against legacy manually-entered Companies relies solely on the soft Name-based duplicate-risk warning | Medium — affects how much duplicate cleanup a tenant does manually after their first sync | PM | Open — recommended default (a), to be written into the feature spec's setup docs, not this document |

#### Checklist
- [x] Every question has options, impact, owner, status
- [x] No BLOCKER-severity question is unresolved before its phase starts (all six are Medium/Low impact, none block Phase 1 from starting)
- [x] Decided questions (§ 6's five decisions) have their rationale recorded in § 6, not repeated here

---

## Production Readiness `PM`

| Workflow | Deployable | Blocker | What the client would say |
|---|---|---|---|
| WF1 Connect | Yes, after Phase 1 | None | "I connected it once and it just worked." |
| WF2 Contacts | Yes, after Phase 1 | None | "My Xero customers showed up correctly, no duplicates." |
| WF3 Invoices | Yes, after Phase 2 | None (Phase 1 must ship first) | "My invoices are all there, linked to the right customer, and I can't accidentally break them." |
| WF4 Scheduled sync | Yes, after Phase 1 (on-demand) fully; Phase 3 adds unattended-operation safety | None | "It stays up to date on its own." |
| WF5 Reauth | Yes, after Phase 3 | None | "When my Xero connection needed reconnecting, it told me instead of silently going stale." |

#### Checklist
- [x] Each workflow assessed: deployable or not, with the specific blocker (none remain unresolved)
- [x] "What would the client say?" framed as the actual complaint/praise, not a technical gap
- [x] No workflow stops midway — WF3 correctly depends on WF1/WF2 completing first, which is phase ordering, not a mid-workflow dead end

---

## Changelog

### 2026-09-26
- Initial draft. Xero API research from trained knowledge (live web access unavailable this session — flagged for pre-implementation verification, § 10 #6). Platform research performed by direct repository reading plus a dispatched research subagent, covering `integrations`, `data_sync`, `sync_excel`, `customers`, and `sales`. Key findings that shaped the design: no generic OAuth admin UI exists; `SalesInvoice` has no direct Company link (new `XeroInvoiceCustomerLink` extension entity); Invoice amounts are already caller-asserted today (zero new plumbing for "store as-is"); `CustomerCompanyProfile` has no tax-ID column (new custom field, not a core schema change, chosen for Phase 1). Matching, re-import, archived/voided, individual-vs-company, and rate-limiting decisions presented as options with a recommendation each, per the user's explicit request not to decide silently.
- Same-day revision after the mandatory DDD challenger gate (§ 1, 2, 5, 6) and an independent architect checkpoint (§ 4, 4.5), both dispatched as fresh-context subagents per the skill's process. Fixes applied: (1) renamed the OAuth-connection field from `xeroTenantId` to `xeroOrganisationId` throughout — the original name collided with OM's own `tenantId` convention at the schema level, not just in prose; (2) split the "Xero-sourced field" glossary term into "Xero-sourced record" (whole-record, mapping+`isEnabled`-driven, Invoices) and "Xero-owned field" (field-level, code-review-only convention, Companies) — one term was quietly covering two different enforcement mechanisms; (3) closed a real dead end where a permanent Xero disconnect would leave every previously-synced invoice locked read-only forever with no unlock path — the mutation guard now also checks `IntegrationState.isEnabled`, so disconnecting releases the lock (US-1.2, US-3.2, § 6.2); (4) added the disconnect-cancels-in-flight-runs-before-clearing-credentials sequencing to the Cross-Story Impact Matrix, closing a timing-gap the matrix had missed; (5) replaced the unfounded "same atomic command-level unit of work" claim for `SalesInvoice`+`XeroInvoiceCustomerLink` (impossible across two modules' writes, per the platform's no-cross-module-ORM-relationship rule) with an explicit sequential-write-plus-compensation design, safe under `data_sync`'s replay-safety contract; (6) added an explicit limitation note (§ 6.1) and a new Open Question (#7) acknowledging the tax-number matching fallback can't help against pre-existing, manually-entered Companies unless an admin populates the new field ahead of time — the field this integration introduces obviously doesn't exist on data created before Phase 1 ships. Separately, the architect checkpoint corrected an overstated claim: `communication_channels`' `oauth-state.ts`/`oauth-token.ts` helpers are already provider-agnostic and already imported across a package boundary by `channel-gmail` today — `sync_xero` should import them directly (as `channel-gmail` does) rather than "porting"/reimplementing them, which reduced § 0.2.1's framing, § 4 WF1's gap description, § 4.5's "propose extracting a toolkit" framing (there is nothing left to extract for those two helpers — they're already reusable), and narrowed Open Question #4 to only the genuinely non-reusable `ChannelAdapter`-typed refresh-coalescing logic. The other three platform claims (no direct Company link on `SalesInvoice`; no tax-ID column on `CustomerCompanyProfile`; Invoice amounts already caller-asserted) were independently verified against the current code and confirmed correct, file:line.
