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

### 0.1 Xero API — split by provenance: VERIFIED against Xero's published OpenAPI spec, vs. trained knowledge

**Provenance, in five research passes.** **(1)** Xero's machine-readable API definition — `https://raw.githubusercontent.com/XeroAPI/Xero-OpenAPI/master/xero_accounting.yaml` (933 KB, the source their own SDKs are generated from) — settled every field, enum and query parameter. **(2)** Xero's **FAQ pages are server-rendered** (the `/documentation/*` pages are not, serving a content-free 139 KB shell), so `/faq/limits`, `/faq/oauth2`, `/faq/granular-scopes` and `/faq/getting-started` were read directly. **(3)** `securitySchemes` plus each operation's `security` block gave the scope-to-endpoint mapping and both OAuth endpoint URLs; `xero-identity.yaml` v19.0.0 gave the `/Connections` contract. **(4)** Screenshots of three client-rendered pages (Scopes, HTTP Requests and Responses, Contacts) transcribed by subagents. **(5)** The Invoices page, supplied as saved HTML and parsed locally.

Items are tagged **[VERIFIED]** with their source. **Two facts remain [UNVERIFIED]**: the Developer Portal registration UX and the `http://localhost` redirect allowance — neither affects a mapping, a matching rule or the scope set. **Four of the five passes changed a design rule rather than merely adding a citation**, which is the argument for having run them all: pass 1 found the missing `PAID` status and contact merges; pass 2 found `401`-not-`403` and the 30-minute refresh grace period; pass 3 found `.read` scopes and the `/Connections` capitalisation; pass 4 found the `If-Modified-Since` blind spot, the 1000-row page size, XML-by-default, and that `accounting.contacts` was never being deprecated; pass 5 found that a plain list call returns **no line items at all**.

Items are tagged **[VERIFIED]** with their source. **Two facts remain [UNVERIFIED]**: the Developer Portal registration UX and the `http://localhost` redirect allowance — neither affects a mapping, a matching rule or the scope set. **Each pass changed the design rather than merely adding citations**, which is the argument for having run all four: pass 1 found the missing `PAID` status and contact merges, pass 2 found `401`-not-`403` and the refresh grace period, pass 3 found `.read` scopes and the `/Connections` capitalisation, pass 4 found the `If-Modified-Since` blind spot, the 1000-row page size, the XML-by-default requirement, and that `accounting.contacts` was never being deprecated.

**The verification paid for itself immediately: it found a bug in this spec's own invoice filter.** This document's § 0.1 first draft listed `Invoice.Status` as `DRAFT`/`SUBMITTED`/`AUTHORISED`/`DELETED`/`VOIDED` and its verification checklist asked whether `Status` "still excludes an explicit PAID value". It does not. The real enum is **`DRAFT`, `SUBMITTED`, `DELETED`, `AUTHORISED`, `PAID`, `VOIDED`** — `PAID` is a first-class status. § 6.3's rule "only `Status IN (AUTHORISED, VOIDED)` invoices are pulled" would therefore have **silently skipped every fully-paid invoice**, which for most real Xero organisations is the majority of their history. Corrected throughout to `AUTHORISED, PAID, VOIDED`.

**[VERIFIED] Contact fields** (`components.schemas.Contact`):
- `ContactID` — "Xero identifier". The only immutable, guaranteed-unique key.
- **`MergedToContactID`** — "ID for the destination of a merged contact. **Only returned when using paging or when fetching a contact by ContactId or ContactNumber.**" Xero supports *merging* contacts, and this field is how a stale `ContactID` tells you where it went. This is a genuinely new constraint for the id-mapping design (§ 6.1, § 10) that the first draft did not know about, and the retrieval caveat is a trap: a plain unpaged `GET /Contacts` never returns it.
- `ContactNumber` (max 50) — "This can be updated via the API **only** i.e. this field is read only on the Xero contact screen, used to identify contacts in external systems". Purpose-built as an external-system key, and **not editable by a Xero user in the UI** — which makes it strictly more stable than `AccountNumber`.
- `AccountNumber` (max 50) — "A user defined account number. This can be updated via the API **and the Xero UI**." Same shape as `ContactNumber` but user-editable, therefore a weaker key. The first draft treated the two as interchangeable; they are not.
- `ContactStatus` — enum `ACTIVE`, `ARCHIVED`, `GDPRREQUEST`. (Confirms the first draft exactly.)
- `Name` (max 255) — "Full name of contact/organisation". No uniqueness assertion anywhere in the spec, confirming it is unusable as a key.
- `TaxNumber` (max 50) — "also known as the ABN (Australia), GST Number (New Zealand), VAT Number (UK) or Tax ID Number (US and global)". Free text, no format validation, no uniqueness.
- `TaxNumberType` — enum `SSN`, `EIN`, `ITIN`, `ATIN`. **US-only identifiers**, so this field gives no help normalizing a UK VAT or EU tax number — it cannot be used to disambiguate `TaxNumber` formats globally, which is what a matching design would want it for.
- `IsCustomer` / `IsSupplier` — both explicitly **read-only and computed**: "Cannot be set via PUT or POST – it is automatically set" based on whether the contact has any AR / AP invoices. **Consequence for § 6.4: a brand-new Xero contact with no invoices yet has `IsCustomer=false` AND `IsSupplier=false`,** so neither flag can be used as a reliable "is this a customer?" filter.
- `CompanyNumber` (max 50), `EmailAddress` (max 255, "umlauts not supported"), `Addresses[]`, `Phones[]`, `ContactPersons[]`, `DefaultCurrency`, `UpdatedDateUTC` ("UTC timestamp of last update to contact"), `ContactGroups[]`, `Balances`, `HasAttachments`.

**[VERIFIED] Invoice fields** (`components.schemas.Invoice`):
- `InvoiceID` — "Xero generated unique identifier for invoice".
- `Type` — enum with **eight** members, not two: `ACCPAY`, `ACCPAYCREDIT`, `APOVERPAYMENT`, `APPREPAYMENT`, `ACCREC`, `ACCRECCREDIT`, `AROVERPAYMENT`, `ARPREPAYMENT`. The first draft described this as `ACCREC`/`ACCPAY`. It matters because an MVP filter of `Type=="ACCREC"` is then demonstrably exact — it excludes credit notes (`ACCRECCREDIT`) and pre/overpayments rather than merely being assumed to.
- `Status` — enum `DRAFT`, `SUBMITTED`, `DELETED`, `AUTHORISED`, **`PAID`**, `VOIDED`. See the correction above.
- `InvoiceNumber` (max 255) — "**ACCREC** – Unique alpha numeric code identifying invoice (when missing will auto-generate from your Organisation Invoice Settings)". Note the uniqueness language is scoped to `ACCREC` only; nothing comparable is asserted for `ACCPAY`. This **confirms** the first draft's reasoning in § 6.1 for rejecting `InvoiceNumber` as a cross-type fallback.
- `Reference` — "**ACCREC only** – additional reference number".
- `Contact` — in the list response this is a **summary** object (`ContactID`, `Name`, empty arrays), verified from the spec's own `getInvoices` example. So linking an imported invoice to its Company needs **no extra API call** — the `ContactID` is already on the invoice payload.
- Payment state on the invoice itself: `AmountDue`, `AmountPaid`, `AmountCredited`, `FullyPaidOnDate` ("Only returned on fully paid invoices). **Confirms § 6.3's MVP design** that payment status needs no separate `/Payments` call.
- `CurrencyCode`, `CurrencyRate` ("If no rate is specified, the XE.com day rate is used", max `[18].[6]`), `SubTotal`, `TotalTax`, `Total`, `TotalDiscount`, `RoundingAmount`.
- `Date`, `DueDate` (both `YYYY-MM-DD` on write), `UpdatedDateUTC`, **`UpdatedDateUTCString`** ("UTC ISO-8601 formatted timestamp").
- `RepeatingInvoiceID` — invoices generated from a repeating template carry their template's id.
- `CISDeduction` / `CISRate` — UK construction-scheme fields; out of MVP scope, named so a later phase does not treat them as a surprise.
- `LineItems[]` — verified fields: `LineItemID`, `Description`, `Quantity`, `UnitAmount`, `ItemCode`, `AccountCode`, `AccountID`, `TaxType`, `TaxAmount`, `LineAmount`, `Tracking` (max 2 categories), `DiscountRate`/`DiscountAmount` (**"only supported on ACCREC invoices"**), `Taxability`, `SalesTaxCodeId`, `TaxBreakdown[]`.

**[VERIFIED — Xero's Invoices documentation page] Invoice retrieval has a trap the MVP walks straight into, and one the design happens to avoid.**

- **Line items are NOT returned by a plain list call.** Xero: *"When you retrieve multiple invoices, only a summary of the contact is returned and **no line details are returned** – this is to keep the response more compact. The line item details will be returned when you retrieve an individual invoice, either by specifying Invoice ID, Invoice Number, **querying by Statuses**, or by using the optional **paging** parameter."* Since § 6.3's MVP imports invoice header **and line items**, a naive `GET /Invoices?If-Modified-Since=…` would silently produce invoices with zero lines. **The design is saved by a coincidence worth making explicit:** this spec already filters by status, and Xero states *"When you retrieve invoices by querying by Statuses, pagination is enforced by default"* — so `?Statuses=AUTHORISED,PAID,VOIDED` both auto-paginates and returns line items. That is now a documented requirement of the query shape, not a lucky default.
- **`summaryOnly=true` is fatal for invoices too.** Its documented exclusions are **`LineItems`**, `Payments`, `HasAttachments` and `CISDeduction`. Combined with the Contacts exclusions (§ 6.6), the parameter is rejected for *both* entities in this integration, each for a concrete mapped-field reason rather than caution.
- **The optimised `where` fields for Invoices are far richer than for Contacts**, and every filter this spec uses is on the list: `Status`, `Type`, `InvoiceId`, `InvoiceNumber`, `Reference`, `Contact.ContactID`, `Contact.Name`, `Contact.ContactNumber`, `Date`, `DueDate`, `AmountDue`, `AmountPaid`. `Date`, `DueDate` and `AmountDue` additionally support **range operators** (`>`, `>=`, `<`, `<=`) combinable with `AND`. So `Type=="ACCREC"` is an optimised filter, not a threshold risk.
- **Comma-separated list parameters: `Statuses`, `IDs`, `InvoiceNumbers`, `ContactIDs`.** Xero's own worked example is strikingly close to this spec's query: `?Statuses=AUTHORISED,PAID&ContactIDs=…` — a third independent confirmation that `PAID` is a real status the first draft would have dropped.
- **`or` is optimised for `InvoiceId` only.** Xero: *"the optimisation of the or operator is restricted to InvoiceId field only. Using or with other fields is not optimised and may lead to exceeding the threshold limit."* So multi-value filtering must use the list parameters above, never `or`.
- **The same 100,000-record high-volume threshold applies to GET Invoices**, returning `400` when exceeded or when unoptimised fields are used for filtering/ordering at that volume.
- **Optimised ordering:** `InvoiceId`, `UpdatedDateUTC`, `Date`; default is **`UpdatedDateUTC ASC, InvoiceId ASC`** — the same stable id tiebreak as Contacts, so the incremental walk is safe across page boundaries on both entities.
- **`UpdatedDateUTCString` is confirmed present and ISO-8601** ("Last modified date in ISO-8601 format"), which settles § 10 #10: prefer the `*String` variants and parse the .NET `/Date(…)/` form only where no string variant exists.
- **Status transitions confirm § 6.4's rules at source:** the only valid transitions into a terminal state are `AUTHORISED -> VOIDED` and `DRAFT|SUBMITTED -> DELETED`. An authorised invoice can never be deleted, only voided — so a Phase 1 import filtered to `AUTHORISED, PAID, VOIDED` can never encounter a `DELETED` record, exactly as § 6.4 claims. Xero also states *"Once an invoice is fully paid the status will change to PAID"*, making `PAID` a system-set terminal state rather than something a user chooses.
- **Also available:** a record filter accepting **`InvoiceNumber`** as well as `InvoiceID` (`GET /Invoices/INV-01514`), `SearchTerm` across `InvoiceNumber` and `Reference`, and `createdByMyApp` to restrict results to invoices this app created — the last being irrelevant here, since this integration creates nothing in Xero.


**[VERIFIED] Dates are serialized in .NET format, and this will break a naive parser.** The `getInvoices` response example in Xero's own spec returns `Date: /Date(1539993600000+0000)/` and `DateTimeUTC: /Date(1552326816230)/`. A plain `new Date(payload.Date)` yields `Invalid Date`. The adapter must either parse the `/Date(ms+offset)/` form explicitly or prefer the `*String` variants (`UpdatedDateUTCString`, `DateString`) where Xero provides them. Not mentioned in the first draft; it is the kind of omission that costs an afternoon during implementation.

**[VERIFIED] Pagination and incremental sync** (both `getContacts` and `getInvoices`):
- **[VERIFIED — docs]** `page` (1-based) and `pageSize` — **default 100, maximum 1000, minimum 1**, with out-of-range values *clamped* to the nearest supported size rather than rejected. The first draft assumed 100 was the ceiling; **the 1000 maximum improves the rate-limit budget by an order of magnitude** (§ 6.6). The response carries an explicit envelope, lowercase key: `pagination: { page, pageSize, pageCount, itemCount }`, and Xero states it **supersedes** the old "keep fetching until a page returns empty" technique — the walker bounds itself from `pageCount`.
- **[VERIFIED — docs] Paged endpoints, exhaustively:** **Invoices, Contacts**, CreditNotes, BankTransactions, ManualJournals, Payments, PurchaseOrders, Prepayments, Overpayments. Both entities this spec imports are covered.
- **[VERIFIED — Contacts docs] Paging is not merely an optimisation for Contacts — it changes which fields you get.** "GET Contacts without paging only returns a subset of elements", and a second documented field table is introduced with *"The following are only retrieved on GET requests for a single contact or when pagination is used"*. That table contains **`MergedToContactID`**, `ContactPersons`, `ContactGroups`, `Website`, `Balances` and the default account codes. **So the merge detection in § 6.1 is only possible on a paged walk** — an unpaged one is silently blind to it. This turns "page the Contacts walk" from a performance choice into a correctness requirement.
- **[VERIFIED — docs] The Accounting API returns XML by default.** Xero: *"By default all successful responses on the accounting API are returned as XML."* JSON requires explicitly setting **`Accept: application/json`** on every request. Never mentioned in the first draft; omitting it yields XML the adapter will fail to parse.
- **[VERIFIED — docs] Default ordering is already what this spec wanted, with a stable tiebreak.** Xero applies **`UpdatedDateUTC ASC, ContactID ASC`** by default (and the equivalent on Invoices, Payments, Credit Notes, Bank Transactions) explicitly "to ensure consistency in ordering across pages". So the design note about pairing `If-Modified-Since` with `order=UpdatedDateUTC ASC` is satisfied by the default, and the id-based secondary sort removes the risk of a record being skipped or duplicated across a page boundary when several share a timestamp.
- **[VERIFIED — Contacts docs] Only three fields are optimised for filtering, and only with `equals`:** `Name`, `EmailAddress`, `AccountNumber` (case- and accent-insensitive; must not be wrapped in `ToLower()`/`ToUpper()`). Optimised **ordering** fields are `ContactID`, `UpdatedDateUTC`, `Name`. Anything else risks the threshold below.
- **[VERIFIED — Contacts docs] A hard 100k high-volume threshold exists on GET Contacts:** requests returning more than 100,000 contacts "will be denied", and unoptimised filtering or ordering that would exceed it is rejected with a **`400`**. Paging plus the optimised fields above is how a large tenant stays inside it.
- **[VERIFIED — Contacts docs]** `searchTerm` searches `Name`, `FirstName`, `LastName`, `ContactNumber`, `CompanyNumber`, `EmailAddress` (case-insensitive) and is Xero's sanctioned substring-search path — explicitly preferred over `where=Name.Contains(...)`, which is listed as an anti-pattern.
- **[VERIFIED — docs]** **`If-Modified-Since`** (header) — "Only items created or updated since the specified timestamp will be returned (**accurate to the second**)", format `yyyy-mm-ddThh:mm:ss`, evaluated against `UpdatedDateUTC`.
- **[VERIFIED — and this one changes the design] `If-Modified-Since` has a documented blind spot.** Xero, verbatim: *"Not all changes will trigger a change of the UpdatedDateUTC field. These include changes to partially paid transactions which don't generate a journal such as **DueDate or SentToContact**, and **Contact fields pulled from other sources such as Balances, IsSupplier, and isCustomer**."* The Contacts page repeats it: *"changes to the Balances, IsCustomer or IsSupplier values will not trigger a contact to be returned with the Modified-After filter."*

  **Two consequences the first draft did not anticipate:**
  1. **An invoice's `DueDate` can change without the incremental sync ever seeing it.** OM would serve a stale due date indefinitely, quietly falsifying § 6.2's "Xero is the source of truth for invoice fields". No cheap fix exists — only a periodic full resync closes it (new Open Question #12).
  2. **`IsCustomer`/`IsSupplier` changes never bump `UpdatedDateUTC`, which undermines § 6.4's supplier filter.** A contact excluded as supplier-only becomes a customer the moment they receive their first AR invoice — precisely the derived-field change Xero says will not surface in an incremental Contacts run, so they could stay permanently excluded from OM despite being a real customer. **The mitigation already exists in this design and must now be named as load-bearing rather than convenient:** § 6.5's invoice-side self-heal fetches a Contact directly by id when an invoice references an unmapped one, and that path is immune to the blind spot because it is triggered by the *invoice*, whose own `UpdatedDateUTC` does move. The supplier filter is safe **only because** the self-heal exists — stated so nobody later removes it as redundant.
- **`summaryOnly`** (boolean) — "retrieve a smaller version of the response object… excluding computation-heavy fields, making the API calls quick and efficient". A real optimization for the rate-limit budget (§ 6.6) that the first draft did not know existed. **Caveat, from the field docs themselves:** several fields including `MergedToContactID` and the default line-amount types are "only returned when using paging or when fetching by ContactId" — so `summaryOnly` trades away exactly the merge signal § 6.1 now needs.
- `includeArchived` (boolean) — on Contacts this maps to `ContactStatus=ARCHIVED` and is meaningful. On Invoices the spec's own description says "Invoices with a status of ARCHIVED will be included", but `ARCHIVED` is **not** a member of the `Invoice.Status` enum — an inconsistency in Xero's published spec, flagged rather than designed around.
- `Statuses` (comma-separated) and `IDs`/`InvoiceNumbers`/`ContactIDs` (comma-separated) — and Xero's own guidance, quoted: "**For faster response times we recommend using these explicit parameters instead of passing OR conditions into the Where filter.**" This directly substantiates the first draft's instinct to avoid `where` in the primary incremental loop. `ContactIDs` also gives § 6.5's failure handling a precise tool: invoices for a specific set of contacts can be fetched in one call.
- `where` / `order` (e.g. `order=InvoiceNumber ASC`), `searchTerm` (case-insensitive text search — Contacts: across `Name`, `FirstName`, `LastName`, `ContactNumber`, `EmailAddress`), `unitdp` (opt into 4-decimal unit amounts).

---

**Second research pass — most of the "unverifiable" tier turned out to be reachable after all.** The `/documentation/guides/*` pages are a client-rendered Next.js app that returns a content-free 139 KB shell to a non-browser client, which is what blocked the first attempt. But Xero's **FAQ pages are server-rendered** and carry the same operational facts, and `developer.xero.com/sitemap.xml` lists them. Fetched successfully: `/faq/limits`, `/faq/oauth2`, `/faq/granular-scopes`, `/faq/getting-started`. Items below now marked **[VERIFIED]** with the FAQ path they came from; **the only genuinely outstanding item is the exact granular scope names**, which live on the client-rendered Scopes page.

The second pass also earned its keep: it found that insufficient scope returns **`401`, not `403`** (a wrong branch in the error taxonomy), that Xero began a **dated scope migration on 2 March 2026** which forces granular scopes on any app registered now, and that a **30-minute grace period** exists for retrying a failed refresh — which contradicts an invariant in the companion OAuth2 toolkit spec.

**Auth and operational details — verified bullet by bullet.** Each item below carries its own provenance tag. Only **two** facts in this whole section remain **[UNVERIFIED]** trained knowledge: the app-registration UX in the Developer Portal, and the `http://localhost` allowance for development redirect URIs. Neither changes an entity mapping, a matching rule, or the scope set.

**OAuth 2.0 (Authorization Code flow, "Web app" app type):**
- **[UNVERIFIED]** App registered at `developer.xero.com` yields a `Client ID` + `Client Secret` (confidential client). Redirect URI must be pre-registered exactly; Xero permits `http://localhost:<port>/...` for local development. *(The no-wildcard rule and the 50-URI limit are [VERIFIED] below; only the localhost allowance and the portal UX are from trained knowledge.)*
- **[VERIFIED — Xero's Scopes page, read from a screenshot] The exact scope set for this integration.** This closes the last research gap, and it corrected an assumption: **`accounting.contacts` is NOT being deprecated.** Only three broad scopes appear in Xero's deprecation table, and Contacts is not among them — the Contacts scopes carry a blank status, meaning they are already granular enough and stay as they are. The scope migration therefore affects only the **invoice** half of this integration.

  | Deprecated broad scope | Replaced by |
  |---|---|
  | `accounting.transactions` | `accounting.invoices`, `accounting.payments`, `accounting.banktransactions`, `accounting.manualjournals` |
  | `accounting.transactions.read` | `accounting.invoices.read`, `accounting.payments.read`, `accounting.banktransactions.read`, `accounting.manualjournals.read` |
  | `accounting.reports.read` | eight `accounting.reports.*.read` scopes (irrelevant here) |

  **The scope set this integration should request:**

  | Scope | Why | Covers |
  |---|---|---|
  | `offline_access` | **Required to receive a refresh token at all** — "To get a refresh token, you must request the offline_access scope" | — |
  | `accounting.contacts.read` | WF2, Contacts -> Companies | Contacts, ContactGroups (GET only) |
  | `accounting.invoices.read` | WF3, sales Invoices | Invoices, CreditNotes, LinkedTransactions, Quotes, PurchaseOrders, RepeatingInvoices, Items (GET only) |

  **Three deliberate omissions, each with a reason.** `openid`/`profile`/`email` are documented as being "required for single sign on" — this integration never authenticates a person through Xero, it reads accounting data, and the connected-account label in the UI comes from `/Connections.tenantName` rather than from an `id_token`. Requesting them would enlarge the consent screen for nothing. `accounting.payments.read` is not needed because Phase 1 takes payment state from the invoice's own `AmountDue`/`AmountPaid`/`FullyPaidOnDate` fields (§ 6.3) — it becomes necessary only if the deferred "detailed payments" phase ships. `accounting.attachments.read` likewise belongs to the deferred invoice-PDF phase.

- **[VERIFIED — Scopes page] Scopes are additive, and narrowing them later is not possible without a revoke.** Xero: *"Each subsequent time your app sends a user through the flow, any new scopes will be added to previously consented scopes… It's not possible to remove scopes from an existing access token. The only way to reduce consented scopes is to revoke the token and start again."* **This makes over-requesting a one-way door**, and is the strongest argument for the minimal `.read` set above: adding a scope later costs one re-consent, but removing an over-broad one costs a revoke plus re-consent for every connected tenant.

- **[VERIFIED — `/faq/granular-scopes` and the Scopes page] A dated platform migration is in progress, and it reaches this integration.** The Scopes page is the more precise of the two sources: *"**Web and PKCE apps** – Since March 2026, all new **and existing** Web and PKCE apps have been assigned granular scopes"*; *"**Custom connections** – Since 29 April 2026, all custom connections will have access to granular scopes"*; and broad scopes *"will remain available until September 2027"*. Note this is stronger than the FAQ's "apps created on or after 2 March 2026" — for Web apps, which is what this integration registers, **existing** apps were assigned granular scopes too. Consequences: (a) the descriptor requests granular scopes from day one; (b) a missing scope surfaces as `401` + `insufficent_scope`, not `403`; (c) a test app created now uses granular scopes by default and validates against the Demo Company. **The exact scope set is verified above** — `accounting.contacts` turned out not to be part of the deprecation at all.
- **[VERIFIED — OpenAPI `securitySchemes.OAuth2.flows.authorizationCode`]** Flow: redirect to **`https://login.xero.com/identity/connect/authorize`** (`client_id`, `redirect_uri`, `response_type=code`, `scope`, `state`) → user authenticates and picks which Xero Organisation(s) to authorize → redirect back with `code` + `state` → exchange at **`https://identity.xero.com/connect/token`** (Basic auth `client_id:client_secret`, `grant_type=authorization_code`). Both URLs are declared verbatim in Xero's published spec, confirming the first draft.
- **[VERIFIED — `/faq/oauth2`]** Token response: `access_token` (**"What is the expiration for an access token? 30 minutes."**), `refresh_token` (**"Unused refresh tokens expire after 60 days"**, single-use — "you should replace your existing refresh token with the new one returned in the response"), `id_token`, `expires_in`. Both figures confirm the first draft.
- **[VERIFIED — `/faq/oauth2`] A 30-minute grace period exists for a failed refresh, and it changes a design assumption.** Xero: *"If you don't receive a response from a token refresh you can retry using your existing refresh token for up to 30 minutes."* The OAuth2 toolkit App Spec's invariant treats a persist failure after a successful remote rotation as **definitive** (reauth required), on the reasoning that the old refresh token is already dead. **For Xero that is too pessimistic** — the old token remains usable for 30 minutes, so the correct behaviour is to retry with the stored token inside that window and only escalate to reauth after it closes. Worth carrying back into the toolkit spec as a descriptor-level capability (`refreshRetryGraceMinutes`) rather than hard-coding one provider's grace period into a generic invariant.
- **[VERIFIED — `/faq/oauth2`] PKCE is supported by Xero** ("Xero supports the Proof Key for Code Exchange (PKCE) extension to the authorization code flow"), so the toolkit's PKCE-on-by-default costs nothing here. Single-page apps are explicitly not supported; irrelevant for a server-side integration.
- **[VERIFIED — `/faq/oauth2`]** Redirect URIs: **no wildcards** (absolute URIs only, per RFC 6749 §3.1.2), and **up to 50 per app** — comfortably enough for localhost development plus staging plus production.
- Refresh: `POST` the same token endpoint with `grant_type=refresh_token`. A refresh token that goes **60 days without being used**, or that the end user revokes from Xero's own "Connected apps" screen, or that dies because the user changed their Xero password, becomes permanently invalid — the tenant must go through the full authorize flow again (a **reconnect**, not a silent refresh).
- **[VERIFIED — `xero-identity.yaml` v19.0.0, Xero's published Identity Service spec] `GET https://api.xero.com/Connections`** (note the **capital `C`** — the first draft wrote it lowercase) returns every Xero Organisation this grant is authorized for. Response schema confirmed as `{ id, tenantId, authEventId, tenantType, tenantName, createdDateUtc, updatedDateUtc }[]`, with `tenantType` being `ORGANISATION` or `PRACTICE`. One OAuth grant **can cover more than one Organisation**. **`DELETE /Connections/{id}` → `204`**, described by Xero as "disconnect a tenant".
- **[VERIFIED] Two fields on `Connection` the first draft did not have, and both are useful here:**
  - **`authEventId`** — "Identifier shared across connections authorised at the same time". This is a cleaner way to handle WF1's multi-Organisation case than comparing timestamps: every Organisation the admin approved in one consent round shares an `authEventId`, and `GET /Connections?authEventId=…` filters to exactly that round.
  - **`updatedDateUtc`** — "May differ to the created date if the user has disconnected and subsequently reconnected this tenant to your app." Useful for spotting that the **same** organisation was reconnected (e.g. to re-consent for new scopes). **An earlier draft of this section overstated it as the signal for Open Question #2 — it is not:** that question is about connecting a *different* organisation, and the decisive signal there is comparing the stored `xeroOrganisationId` against the newly selected one, not this field.
- **[VERIFIED]** Xero's own example response names `"Demo Company (NZ)"` as the tenant, which independently corroborates the Demo Company setup below.
- **Every Accounting API call requires the `Xero-tenant-id` header** set to the target Organisation's `tenantId` GUID from `/connections` — the same access token addresses every authorized organisation by varying this header; there is no per-organisation token.
- A private, single-tenant integration (what this spec assumes — one OM tenant/organization connects its own Xero Organisation with its own Client ID/Secret) is the simple case: after consent, resolve `/connections`, and if more than one Organisation comes back, the admin must pick exactly one to bind (§ Decision, Phase 1).

**[VERIFIED — `developer.xero.com/faq/limits`, quoted] Rate limits & errors.** The FAQ pages, unlike the `/documentation/` guides, *are* server-rendered and were fetched successfully. Xero's own wording:
- **Concurrent Limit: 5 calls in progress at one time. Minute Limit: 60 calls per minute. Daily Limit: 5000 calls per day** — all **per tenant** (organisation/account/practice). Confirms the first draft's figures exactly.
- **App Minute Limit: 10,000 calls per minute across all tenants** — a limit the first draft did not know about. Irrelevant for one tenant, but it is the ceiling if OM ever runs many tenants' Xero syncs concurrently from one registered app, which is the eventual multi-tenant shape.
- **Every response carries `X-DayLimit-Remaining`, `X-MinLimit-Remaining` and `X-AppMinLimit-Remaining`.** Exact header names, previously unknown — these let § 6.6's budgeting read the real remaining quota instead of counting calls locally, which is strictly better because it survives restarts and parallel runs.
- Exceeding any limit returns **HTTP 429**. Rate limits **cannot be increased** ("our rate limits are the same for all apps").
- Limits apply **per connection**: "if two separate Xero organisations are connected to an application, each connection would have 5000 API calls available in a given 24 hour period."
- Pagination returns **100 items at a time**, and Xero names the endpoints supporting it: **invoices, contacts**, bank transactions and manual journals — both entities this spec imports are covered.
- For writes (out of scope here, recorded for a later phase): ~50 nodes per request is the practical ceiling, with a **3.5 MB** maximum request size.

**Error handling — one correction the first draft got wrong:**
- `400` — structured validation errors (`Elements[].ValidationErrors[]`) on writes (not relevant here — import-only).
- `401` — expired/invalid token → refresh and retry once.
- **`401` with `WWW-Authenticate: insufficent_scope` (Xero's own spelling) — insufficient scope. The first draft said this was a `403`; it is not.** This distinction is load-bearing rather than cosmetic: a plain `401` means "refresh the token", but a `401 insufficent_scope` means "the token is fine, the grant is too narrow" — refreshing will loop forever. Xero's own guidance: "We recommend updating your error handling to specifically catch 401s and prompt the user to 'Update Permissions.'" So the adapter must branch on that header, and the OAuth2 toolkit's failure taxonomy needs a third class beyond transient/reauth: **re-consent-with-new-scopes**.
- `5xx` — transient; exponential backoff.
- Because the limits are per-Organisation, a tenant with one connected Organisation cannot parallelize around them; a large first sync can span multiple sync windows purely from the 5,000/day cap.

**Contacts — retained notes not covered by the verified list above:** Contacts are **never hard-deleted** through the API — only archived (`ContactStatus=ARCHIVED`) or GDPR-redacted (`ContactStatus=GDPRREQUEST`, which strips PII). Both remain retrievable, which is what makes § 6.4's "mirror the state, never delete locally" rule implementable. `ContactNumber`/`AccountNumber` are unique per organisation when set, but are blank unless the org has already used another integration. *(Field-level detail is now in the [VERIFIED] block above; this paragraph keeps only the behavioural facts the OpenAPI spec does not state.)*

**Invoices — retained notes not covered by the verified list above:** only `DRAFT`/`SUBMITTED` invoices can be Xero-deleted (`Status=DELETED`); an `AUTHORISED` invoice can only be **voided** (`Status=VOIDED`), never deleted. Both states remain retrievable via the API and are never physically removed — again what makes § 6.4 implementable. An `ACCREC` `InvoiceNumber` can be hand-edited by a user, after which Xero does not re-enforce global uniqueness against older or imported rows; `Reference` is often a PO number. *(Field-level detail is now in the [VERIFIED] block above.)*

**Incremental sync — retained design note:** combine `If-Modified-Since` with `order=UpdatedDateUTC ASC` so pagination stays stable while new updates land mid-walk. *(Parameter-level detail is now in the [VERIFIED] block above, including Xero's own recommendation to prefer the explicit `Statuses`/`IDs` parameters over `where`.)*

**Demo Company:** every Xero login (including a developer's own account) has access to a pre-populated "Demo Company (NZ)" sandbox organisation — same API, same base URL, no separate sandbox environment. Local development: register a Xero app with an OAuth redirect URI on `localhost`, run the consent flow, and select the Demo Company as the authorized Organisation.

**Verification checklist before Phase 1 sign-off — now empty.** Three research passes plus three documentation screenshots settled every item the first draft flagged. Confirmed at source: all Contact/Invoice/LineItem fields and enums (including `PAID`, which the first draft had wrong); both OAuth endpoint URLs; the `/Connections` schema; token lifetimes and the 30-minute refresh grace period; PKCE support; redirect-URI rules; all four rate limits and the three quota headers; `401 insufficent_scope` semantics; the full granular-scope tables and the exact scope set to request; pagination defaults, the 1000 maximum and the paged-endpoint list; the `Accept: application/json` requirement; default ordering with its id tiebreak; the optimised filter/order fields and the 100k threshold; the `summaryOnly` exclusion list; and the `If-Modified-Since` blind spot. **Nothing remains to research.** One optional smoke test is worth doing before the first implementation commit — run the normal OAuth consent flow once by hand against the Demo Company (the dev environment this project already planned to use) to confirm the granular scopes are assigned to a new app and that the `.read` variants cover our GET calls. Both are currently inferences from Xero's tables rather than quotes, and scopes cannot be narrowed later without a revoke (§ 10 #11).

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

**Journey:** Admin triggers/schedules a run for `xero.invoices` -> adapter pulls `ACCREC` Invoices via **`?Statuses=AUTHORISED,PAID,VOIDED`** (the status-query form, which Xero auto-paginates **and which is the only list shape that returns line items** — § 0.1 [VERIFIED]) modified since the last cursor -> for each Invoice, resolve its Contact's mapped Company (self-healing a missing mapping via a direct Xero Contact GET if needed) -> create/update the `SalesInvoice` + lines + the `XeroInvoiceCustomerLink` -> run completes with counts.

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
4. Invoice was `DELETED` in Xero (only possible while still `DRAFT`/`SUBMITTED`, i.e. never reaches OM in the first place since Phase 1 only imports `AUTHORISED`/`PAID`/`VOIDED`) -> not applicable; documented so the "why doesn't OM see drafts" question has an answer.
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

#### WF1: Connect a Xero Organisation — Total: **2 atomic commits** (was 5 standalone)

> **Rescored 2026-09-27 after the sequencing decision: the OAuth2 provider toolkit ships first** (§ 10 #4). Xero no longer builds an OAuth flow — it declares a descriptor and implements one hook. The three rows struck through below are the toolkit's responsibility, and Xero inherits PKCE, RFC 7009 revocation, cluster-safe token refresh and the generic Connect UI rather than reimplementing them. **This makes the toolkit a hard prerequisite for Phase 1, not an optimisation.**

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Package scaffold + `integration.ts` + the **`OAuth2ProviderDescriptor`** (issuer/endpoints, the three `.read` scopes, `refreshRetryGraceMinutes: 30`) | `integrations` registry + the toolkit's descriptor type | 1 | app | 1 | Config and typed fields only — no protocol code |
| ~~OAuth initiate/callback/disconnect routes~~ | **Toolkit** (generic `/api/integrations/oauth/[provider]/*`) | 0 | — | **0** | Struck: provided by the toolkit, with PKCE and revocation Xero would not otherwise have had |
| Xero Organisation picker — the toolkit's **Resource Selection hook**, shipped as a provider-injected widget | toolkit hook + `InjectionSpot` in the credentials tab | 2 | app | 1 | The one genuinely Xero-specific piece of the connect flow, and the reason the toolkit spec names Xero as the extension point's proving consumer |
| ~~Connect/disconnect widget on detail page~~ | **Toolkit** (generic `oauth` credential-field renderer) | 0 | — | **0** | Struck: the toolkit implements the `oauth` field type generically |

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

#### WF4: Scheduled incremental sync — Total: 1 atomic commit

| Step | Platform capability | Gap | Scope | Commits | Notes |
|---|---|---|---|---|---|
| Incremental scheduling, runs, cursors, retry | `data_sync` scheduler/run/cursor/retry | 0 | platform (already exists) | 0 | Fully generic, nothing to build |
| **Full-resync run mode: an on/off toggle and a "Run now" button in the Xero configuration screen** (§ 6.7) | `data_sync` already has schedules, on-demand triggering, run history, per-item logging and **overlap detection preventing concurrent runs of the same entity type**; the credentials tab already hosts provider-injected widgets | 1 | app (`sync_xero`) | 1 | **Added 2026-09-27 after the `If-Modified-Since` blind spot was verified, then simplified the same day.** New work is narrow: a "full" run-mode flag that omits the header, a toggle that writes a `SyncSchedule` row (a facade over the existing scheduler, not a second one), explanatory copy, and a pre-flight quota check with `Date`-range auto-chunking in code. The earlier quota-estimating dialog was dropped as ceremony — a full resync costs 0.14-2% of the daily limit |

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

**Total: 19 atomic commits** across all five workflows — 22 standalone, minus the 3 that the OAuth2 toolkit absorbs now that it ships first (§ 10 #4). The trajectory: 21 originally, +1 for § 6.7's full resync, −3 for the toolkit. No workaround was needed anywhere — every gap has a clean, sanctioned platform mechanism to build against (extension entity, mutation guard, custom field, `DataSyncAdapter`), even where the underlying code (OAuth flow, Xero API client) is genuinely new.

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
Success: every `ACCREC` Xero invoice in `AUTHORISED`, `PAID` or `VOIDED` status modified since the last cursor has exactly one OM `SalesInvoice`, linked via `XeroInvoiceCustomerLink` to the correct Company, with header/line amounts matching Xero exactly (no OM recalculation).
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

> **Six decisions, each with options and a recommendation, none decided silently.** § 6.1 matching keys · § 6.1b pre-existing OM records (added after reading the reference importer's actual ambiguity handling) · § 6.2 re-import/overwrite + change visibility · § 6.3 invoice MVP scope · § 6.4 archived/voided/deleted and individuals-vs-companies · § 6.5 import order and failures · § 6.6 rate limiting.

### 6.1 Matching keys

**Contacts -> Company:**

| Candidate key | Reliability | Risk |
|---|---|---|
| `ContactID` (via id-mapping, after first sync) | Highest — Xero-guaranteed unique, immutable | None once a mapping exists; irrelevant on first sync of a never-before-seen Contact |
| `TaxNumber` (normalized: strip whitespace, uppercase) | Medium | Often blank (not required by Xero, especially for contacts in countries without VAT); formatting drift (country-prefix vs not) mitigated by normalization but not eliminated; not Xero-enforced-unique (rare but possible for two contacts to share one, e.g. sibling entities) |
| `CompanyNumber` (registration number, max 50) | Low-medium | Same caveats as `TaxNumber`, and typically filled in even less often by SMB Xero users |
| `ContactNumber` (max 50) | Low, as a **first-run** key — but the **better** of the two external-key fields | Purpose-built ("used to identify contacts in external systems") and **not editable in the Xero UI at all** — API-writable only (§ 0.1 [VERIFIED]), so it cannot drift under a user's hands. Still blank unless the org already used a prior integration |
| `AccountNumber` (max 50) | Lower than `ContactNumber` | Verified to be editable **both** via API and in the Xero UI, so it is a user-mutable field masquerading as a key. The first draft treated it as interchangeable with `ContactNumber`; it should be preferred strictly less |
| `Name` (max 255) | **Not usable as an auto-match key — and Xero now says so itself** | A correction to this spec's earlier reasoning, which claimed Name simply is not unique. It is *currently* enforced: `PUT /Contacts` errors when an existing contact matches on `ContactName` or `ContactNumber`. But Xero's Contacts page carries an **"Important Update"**: *"The business rules around contacts in Xero may be changing in the future and 'Contact Name' may no longer be a unique field. We recommend all developers use ContactID to uniquely reference contacts in Xero and do not rely on ContactName as a way to reference contact data uniquely."* So the recommendation stands, on much firmer ground: not "it isn't unique" but "the vendor is deprecating its uniqueness and explicitly tells integrators not to depend on it". Casing/punctuation drift ("Acme Ltd" vs "ACME LTD.") remains a secondary reason |
| `TaxNumberType` | **Not usable at all for normalization** | Verified enum is `SSN`/`EIN`/`ITIN`/`ATIN` — **US identifiers only**. It cannot tell a UK VAT number from an EU one, so it gives no help disambiguating `TaxNumber` formats, which is the one thing a matcher would want it for |

**Recommendation:** `ContactID` via id-mapping is the sole primary key (always wins once it exists). On first sync only, fall back in order to `TaxNumber` (normalized), then `CompanyNumber` (normalized), both matched against the new `xero_tax_number` custom field (§ 1.4) — if either matches exactly, link to that existing Company; the match is logged in the run log as "matched existing company by tax/registration number" for transparency. **Never auto-match on `Name` alone.** A Contact whose Name matches an existing Company but whose tax/registration numbers don't (or are blank on either side) still creates a new Company, and is surfaced as a **soft duplicate-risk warning** in the run log — the same "warn, don't silently merge, don't hard-block" pattern `sync_excel`'s foundation spec already established for its own duplicate-risk warnings.

**A real limitation of the tax-number fallback, stated plainly (raised by DDD review):** `xero_tax_number` is a field this integration itself introduces (§ 1.4) — it does not exist on any Company created before Phase 1 ships. That means the fallback can only ever match a Company that (a) was created by an earlier Xero sync (which already has a `ContactID` mapping and therefore never needs the fallback), or (b) had `xero_tax_number` populated deliberately by an admin ahead of the first sync. **It does not, by itself, prevent duplicate creation against a pre-existing, manually-entered OM Company on a tenant's very first Xero sync** — that Company's tax ID, if it has one, almost certainly lives in a different field (a generic custom field the tenant already uses, free text in `description`, or nowhere at all). Two things follow: first, the admin-facing setup guidance for WF1/WF2 (feature-spec level, not this document) should explicitly recommend that tenants with existing manually-entered Companies populate `xero_tax_number` on them before running the first Contacts sync, if they want first-sync dedup to work; second, this spec does not claim first-sync dedup against arbitrary legacy data is solved — soft duplicate-risk warnings (Name-based, never auto-linking) are the only safety net for that case, and are accepted as sufficient for Phase 1 rather than building a heavier matching UI (§ 10 Open Question, new entry below).

**A constraint the first draft did not know about: Xero contacts can be merged, and `ContactID` is then no longer stable in the way id-mapping assumes.** The verified `Contact` schema carries **`MergedToContactID`** — "ID for the destination of a merged contact". When a Xero user merges two contacts, the losing `ContactID` survives as an alias that points at the winner. This breaks the brief's premise ("store the Xero external ID so repeated runs update existing records") in a specific way: two `SyncExternalIdMapping` rows, created by earlier syncs, now refer to what Xero considers **one** contact — so two OM Companies are each "the" mapping target, and the next sync will update one of them arbitrarily while the other silently rots as a duplicate that no longer receives updates.

Two further traps make this worse than it first appears. First, `MergedToContactID` is **"only returned when using paging or when fetching a contact by ContactId or ContactNumber"** — an unpaged list walk never sees it, so an implementation can be blind to merges without any error. Second, `summaryOnly=true` — the rate-limit optimization § 6.6 would otherwise want — is documented to drop exactly this class of field, so the cheap call and the correct call are in direct tension.

**Recommended handling (and it is deliberately minimal for Phase 1):** page the Contacts walk (which this design does anyway for `If-Modified-Since` cursoring), and when a Contact arrives with a non-empty `MergedToContactID`, do **not** update the OM Company mapped to the losing id. Instead mark that mapping as superseded, log a `skipped` item naming both OM Companies and the surviving `ContactID`, and leave the merge decision to a human — because merging two OM Companies means reassigning their invoices, contacts, deals and owners, which is a CRM operation with no safe automatic answer and no existing OM primitive. Auto-merging OM records because an accountant merged two Xero contacts would be the integration silently destroying CRM data it does not own. Tracked as a new § 10 open question for whether Phase 2 should offer an assisted merge UI.

**Invoices -> OM Invoice:**

`InvoiceID` via id-mapping is the **only** matching key — no fallback. `InvoiceNumber` is rejected as a fallback because (a) OM already enforces a hard DB-unique constraint on `(organizationId, tenantId, invoiceNumber)` that a Xero-assigned number could collide with a pre-existing, unrelated manually-created OM invoice, and (b) for `ACCPAY` bills `InvoiceNumber` is the supplier's own free-text reference with no uniqueness guarantee at all (moot for Phase 1 since only `ACCREC` is in scope, but worth recording so a later Bills phase doesn't repeat this mistake). A genuine collision is a `failed` item with a clear error, resolved manually by the admin (rename the pre-existing OM invoice, or accept the failure and investigate) — not auto-resolved by suffixing or renaming, which would silently diverge from Xero's own numbering.

### 6.1b Records that already exist in OM before the first import — presented as an explicit decision

**What the reference CSV import actually does, read from the code rather than from its spec** (`packages/core/src/modules/sync_excel/lib/adapters/customers.ts`):

`resolveExistingPersonId` tries the external-id mapping first and, failing that, consults an email dedupe index. `buildEmailDedupeIndex` loads every `isActive: true`, non-deleted Person in scope ordered by `createdAt: 'asc'` and fills a `Map` with `if (!email || index.has(email)) continue`.

Four consequences follow, and they are the honest answer to "how does the reference handle ambiguous matches":

1. **It does not detect ambiguity at all.** When two OM Persons share an email, the **oldest wins** by creation order and the other is never mentioned — no warning, no `skipped` item, nothing in the run log. "Multiple candidates" is resolved silently.
2. **There is no partial or fuzzy matching.** The key is an exact normalized email. A near-match is a non-match, and produces a new record.
3. **Conflicting data is not surfaced either** — once matched, § 6.2's unconditional partial overwrite applies and the incoming non-blank values simply win.
4. Two further sharp edges: the index is built **once, before the run**, so two rows in the same file with the same email can still create two records; and it filters to `isActive: true`, so an **archived** Person will not match and a duplicate gets created alongside it.

This is a reasonable design for a human-driven, one-file-at-a-time CSV import where the operator is watching. It is a weaker fit for an unattended, scheduled integration, which is why this needs a decision rather than inheritance.

| Option | Description | Trade-off |
|---|---|---|
| **A — Mirror the reference exactly** | One deterministic fallback key (normalized `TaxNumber`, then `CompanyNumber`), oldest-wins on ambiguity, no ambiguity reporting | Cheapest, and perfectly consistent with the precedent the brief asked us to follow. But it imports the precedent's worst property — silent ambiguity resolution — into a job that runs unattended on a schedule, where nobody is watching to notice that two Companies collapsed into one arbitrarily |
| **B — Mirror the reference, but report ambiguity (recommended)** | Same keys and same oldest-wins resolution, **plus**: when more than one Company matches a fallback key, still pick the oldest deterministically *and* emit a `skipped`-adjacent warning item naming every candidate; additionally emit the Name-based soft duplicate-risk warning already described in § 6.1 | Behaviourally identical to A for every unambiguous record, so it inherits the precedent without inheriting its blind spot. Costs one extra query shape (count candidates rather than take the first) and some run-log surface. The admin finds out on the first run instead of during an audit three months later |
| C — Refuse to auto-match, queue every first-sync candidate for human confirmation | No fallback matching at all; every Contact that does not already have a `ContactID` mapping but plausibly matches an existing Company becomes a review item | Safest against wrong merges, and genuinely appropriate for financial data. But it needs a review UI that does not exist in `data_sync` today, and on a first sync of a few thousand contacts it produces a review queue nobody will work through — turning a 1-click import into a data-entry project, which is how integrations get abandoned |

**Recommendation: Option B.** It follows the brief's instruction to reuse the CSV import's approach rather than invent a parallel mechanism, while fixing the one property that does not survive the move from attended to unattended execution. Option C is the right answer for a later phase *if* real tenants report wrong matches; building its review UI before any evidence of that would be speculative, and § 6.1's limitation note already explains why first-sync dedup against arbitrary legacy data cannot be fully solved by key matching anyway.

**Note the deliberate asymmetry with Invoices:** this fallback applies to Companies only. Invoices match on `InvoiceID` alone with no fallback (§ 6.1), so none of the above applies to them — a pre-existing OM invoice is never auto-linked to a Xero invoice, and a number collision is a `failed` item for a human.

### 6.2 Re-import / overwrite behavior

**How the reference CSV import (`sync_excel`) behaves today:** unconditional partial overwrite. On every re-run, any mapped CSV column that has a non-blank value for a row **always overwrites** the corresponding OM field; a blank cell is simply omitted from the update payload, leaving the existing value untouched. There is no skip/merge mode, no configurability, and no concept of a "locked" or "read-only" field — a user could manually edit an imported field in OM and it would be silently clobbered on the next CSV re-import of the same source row. Visibility beyond the run's own create/update/skip/failed log is limited to whatever `audit_logs`/command-history capture generically (not CSV-specific).

**Options considered for Xero, evaluated against that precedent:**

| Option | Description | Trade-off |
|---|---|---|
| A — Full Xero authority + read-only enforcement (Invoices), field-level ownership (Companies) — **the user's starting position** | Xero-sourced invoice fields are always overwritten and the OM UI/API refuse manual edits to them (enforced via a mutation guard). Company fields Xero owns are overwritten; OM-only fields (owner, tags, notes, non-Xero custom fields) are never touched. | Strongest data-integrity guarantee for legally-relevant invoice data; requires new (small) guard logic beyond what CSV import does. For Companies, this is actually **weaker** than "requires new work" — it matches what `sync_excel` already does implicitly (partial, mapped-fields-only overwrite), just made an explicit, documented rule rather than an accident of how `updateInput` happens to be built. |
| B — CSV-style unconditional overwrite, no read-only enforcement anywhere | Simplest, zero new guard code, matches precedent exactly. | For invoices specifically, silently overwriting a user's manual correction (e.g., a fixed due date) with stale-if-sync-lagged Xero data is worse than for CRM contact data — invoices are legal financial documents where silent divergence-then-clobber is a real integrity risk, not just an annoyance. |
| C — "Last local edit wins" (skip the overwrite if OM's `updated_at` is newer than the mapping's `lastSyncedAt`) | Avoids clobbering a deliberate local edit. | Breaks the stated business goal outright — "Xero is source of truth" is no longer true the moment a user edits something in OM, and the two systems can silently diverge with no way to tell which one is "right" without manually diffing. Also more code than Option A, not less. |

**Recommendation: Option A, exactly as proposed, with three concrete implementation notes:**
1. For **Invoices**, "Xero-sourced" is derived from the existence of a `SyncExternalIdMapping` row (`integrationId='xero', internalEntityType='sales.invoice'`) **AND** `IntegrationState.isEnabled=true` for the connection (both columns verified present: `packages/core/src/modules/integrations/data/entities.ts:105` for `is_enabled`, `:111` for `reauth_required` — the guard needs no schema change) — not mapping existence alone, and not a new stored flag. The mutation guard checks both at write time; the detail-page UI checks the same pair at render time via the External-ID widget. **The `isEnabled` half of this check is the fix for a real dead end the DDD review surfaced:** without it, an invoice imported once and then the tenant permanently disconnecting Xero (switching accounting systems, cancelling the integration) would stay locked read-only forever, with Phase 1's US-3.2 providing no per-invoice unlock override. Gating the guard on `isEnabled` means disconnecting releases every previously-synced invoice back to normal editability — the `SyncExternalIdMapping` row itself is untouched, so the Xero-link display/history is preserved, only the write-block lifts. Reconnecting re-arms the guard for any invoice whose mapping still exists. This is a one-line addition to the guard's condition, not new infrastructure.
2. For **Companies**, field-level ownership is **already the CSV importer's actual behavior** (only mapped, non-blank fields are ever written) — this spec just makes explicit, in § 1.4/§ 3, exactly which fields Xero owns (`displayName`/`legalName`, `primaryEmail`, `primaryPhone`, addresses, `xero_tax_number`, `status`/`isActive`) versus which are always OM-only (`ownerUserId`, tags, comments, deals, `industry`/`sizeBucket`/`annualRevenue`, any non-Xero custom field).

**Visibility of import-driven changes:** the Data Sync run detail page's existing per-item log (create/update/skip/failed) is sufficient for Phase 1 — it already answers "what did the last sync do to this record." A full field-level diff/history view is out of scope for Phase 1 (no platform primitive for this exists beyond whatever `audit_logs` captures generically for command-based writes, which this integration gets for free since it writes through the same commands as everything else, but is not guaranteed to render a human-friendly diff) — recorded as a possible Phase 2+ enhancement, not a Phase 1 requirement, since neither workflow's ROI depends on it.

### 6.3 Invoice data scope (MVP)

The user's proposed MVP — sales invoices only (`ACCREC`), header + line items, currency code and amounts stored as-is, payment status from the invoice itself (`status`, `AmountPaid`, `AmountDue`) — **is fully supported by the existing `SalesInvoice`/`SalesInvoiceLine` schema with exactly one gap** (the Company link, § 1.4/§ 5.1). This spec keeps that scope as proposed, refined with two necessary edge-case rules that are not scope *expansions*, just correctness rules the MVP needs to not do the wrong thing:
- Only `Status IN (AUTHORISED, PAID, VOIDED)` invoices are pulled — `DRAFT`/`SUBMITTED` are not yet real financial documents and would misrepresent OM's sales reporting if imported (§ 6.4). **`PAID` is in this list because of a correction, not an addition:** the first draft said `AUTHORISED, VOIDED`, having believed `PAID` was not a `Status` value. It is (§ 0.1 [VERIFIED]), so the original filter would have silently skipped every fully-paid invoice — for most established Xero organisations, the bulk of their invoice history. The MVP still reads *amounts* (`AmountDue`/`AmountPaid`) from the invoice rather than the status, as designed; `PAID` simply has to be let through the door first.
- Voided invoices are mirrored with `status='voided'`, never deleted (§ 3, WF3 edge case 3).

**Deferred to later phases** (unchanged from the user's proposal, validated against the schema): Bills (`ACCPAY`) — genuinely has no target entity in OM today (no purchasing/AP module exists in the repo), a materially bigger design effort than "add a field," correctly deferred indefinitely pending a purchasing-side module existing at all. Credit notes — `SalesCreditMemo`/`SalesCreditMemoLine` already exist and already support linking to an invoice, a natural, low-gap Phase 2 candidate. Detailed multi-payment records — `SalesPayment`/`SalesPaymentAllocation` already exist, another natural low-gap Phase 2 candidate once aggregate paid/outstanding (Phase 1) proves the pattern. Invoice PDFs/attachments — the generic `attachments` module already exists and would be a thin adapter addition, not a new subsystem.

### 6.4 Archived/voided/deleted records, and individuals vs. companies

| Xero state | OM treatment | Rationale |
|---|---|---|
| Contact `ContactStatus=ARCHIVED` | Company `status='archived'`, `isActive=false` — never deleted | Preserves referential integrity for any deals/invoices/activities already attached to the Company in OM |
| Contact `ContactStatus=GDPRREQUEST` | Status flip only (as above); existing PII fields are **not** overwritten with Xero's now-blanked values | Overwriting with blanks would destroy OM's own historical record of a redacted contact; flagged as a judgment call worth a compliance sign-off, not purely an engineering decision — see § 10 |
| Invoice `Status=VOIDED` | OM Invoice `status='voided'`, never deleted | A voided invoice remains a real historical document Xero itself never removes |
| Invoice `Status=DELETED` | Not applicable to Phase 1 — only `AUTHORISED`/`PAID`/`VOIDED` are ever pulled, so a Xero-side delete (only possible pre-authorisation) is never observed | Documents the "why don't drafts appear" answer for support/debugging |
| Invoice `Status=PAID` | OM Invoice imported normally, with `AmountPaid`/`AmountDue` carried across | **Added by the § 0.1 correction.** `PAID` is a real `Status` value the first draft did not know existed and would have filtered out |
| Contact is an individual (has `FirstName`/`LastName`, no obvious company signal) | Imported as a Company anyway, uniformly | See below |
| Contact is supplier-only (`IsSupplier=true`, `IsCustomer=false`, never referenced by an imported invoice) | **Filtered out — no Company created** | Bills (the only reason a pure supplier would matter) are out of MVP scope; importing vendors into a CRM's "Companies" list would misrepresent them |
| Contact has **`IsCustomer=false` AND `IsSupplier=false`** — a brand-new Xero contact with no invoices yet | **Imported, not filtered** | Verified correction: both flags are **read-only and computed** by Xero from whether the contact has any AR/AP invoice (§ 0.1 [VERIFIED]), so a newly created contact has both `false`. Treating `IsCustomer=false` as "not a customer" would therefore filter out every contact created since the last invoice run — including the ones a tenant just added in order to invoice them. The supplier-only filter above must read **`IsSupplier=true` AND `IsCustomer=false`**, never `IsCustomer=false` alone |
| Contact has **both** `IsCustomer=true` and `IsSupplier=true` | Imported as a Company | Common in practice (a business you both buy from and sell to); the supplier filter must not exclude it |

**Individuals vs. companies — three options considered:**

1. **Import every Contact uniformly as an OM Company** (recommended) — Xero has no reliable, structured "this is an individual/sole trader" flag (only a heuristic: `FirstName`/`LastName` populated). Treating every accounts-receivable party the same way keeps the Invoice-to-Contact link uniform (always Company via `XeroInvoiceCustomerLink`) and avoids a second, parallel Invoice-to-Person link type for a fuzzy classification that would sometimes be wrong anyway.
2. Heuristically classify into Person vs. Company based on `FirstName`/`LastName` presence — more semantically "correct" for OM's CRM in theory, but the heuristic is fragile (many Xero orgs put an individual's full name only in the `Name` field), and it doubles the invoice-linking design (needs both a Company-link and a Person-link path) for a distinction Xero itself doesn't reliably make.
3. Filter out anything that looks like an individual entirely — loses real customer data for tenants who do invoice individuals (sole traders, consumers) through Xero.

**Recommendation:** Option 1, combined with the supplier-only filter above — import a Contact as a Company only when it is (or becomes, via an imported invoice) a customer; never classify into Person vs. Company.

### 6.5 Import order and failure handling

Contacts and Invoices are two separate `supportedEntities` values (`xero.contacts`, `xero.invoices`) on one adapter, consistent with how `data_sync` already models per-entity-type runs and schedules — an admin can sync either independently. To avoid an operator-managed "always schedule Contacts before Invoices" foot-gun, the Invoices adapter **self-heals** a missing Contact mapping by fetching that one Contact directly from Xero on demand when it's first needed, rather than requiring strict global ordering. If the self-heal also fails (Contact inaccessible, deleted, or filtered out as supplier-only), the invoice item is reported `failed` with a stable error code (`xero.invoice_contact_unresolved`) and is **not** auto-retried by the next incremental run (its cursor position has already advanced past it, per how `If-Modified-Since` incremental sync works) — visible in the run's failed-item list, resolved by the admin triggering a full resync if needed. This reuses `data_sync`'s existing failed-item visibility and "run as full sync" mechanism rather than inventing a new retry-queue.

### 6.6 Rate limiting and partial failures — what's reused vs. genuinely new

**Reused as-is from existing OM modules:** queue-based workers with bounded concurrency, cursor persistence after every batch (resume on failure), per-item error logging that never aborts the whole run, `ProgressJob`-based progress reporting, the run detail page's failed-item list, the retry endpoint, cancellation via `AbortSignal`, CRON scheduling via the platform's generic scheduler, and `data_sync`'s existing overlap detection preventing two concurrent runs of the same entity type.

**Genuinely new, and correctly scoped to live inside the `sync_xero` package (never inside `data_sync`, per its "never special-case provider credentials/logic" rule):** a small rate-limiter and a `429`-aware retry. Both are now designed against **verified** limits rather than remembered ones (§ 0.1 [VERIFIED]):
- Budget against **5 concurrent / 60 per minute / 5,000 per day, per Organisation**, plus the app-wide **10,000 per minute** ceiling that matters once OM runs many tenants from one registered Xero app.
- **Read the quota from the response rather than counting locally.** Every Xero response carries `X-MinLimit-Remaining`, `X-DayLimit-Remaining` and `X-AppMinLimit-Remaining`. Using them is strictly better than a local counter: it survives process restarts, parallel runs and any other client sharing the same app registration — none of which a local counter can see. The first draft proposed a local limiter only, because the header names were unknown.
- Xero states rate limits **cannot be increased**, so there is no "ask Xero for more" escape hatch to plan around.
- **Paging is not optional on either entity, which removes a tempting but wrong optimisation.** Contacts must be paged or `MergedToContactID` is never returned (§ 6.1); Invoices must be paged or queried by `Statuses` or **no line items come back at all** (§ 0.1). A future attempt to cut call volume by dropping paging would silently break merge detection and produce invoices with no lines — worth stating because both failures are silent rather than loud.
- A very large tenant's first full sync may span multiple sync windows purely from the 5,000/day cap — a real constraint on first-sync duration (flagged in WF3's edge cases), not a design flaw. Pagination is verified at **100 per page** and verified to be supported on both `invoices` and `contacts`, so the modest batch size stays well inside the per-minute cap during a backfill.
- **`summaryOnly=true` is rejected for Contacts, and the verified exclusion list makes this decisive rather than cautious.** Xero documents exactly ten excluded fields: `Addresses`, `Balances`, `ContactGroups`, `ContactPersons`, **`IsCustomer`**, **`IsSupplier`**, `PurchasesDefaultAccountCode`, `PurchasesTrackingCategories`, `SalesDefaultAccountCode`, `SalesTrackingCategories`. **Three of those this integration actively needs:** `Addresses` is mapped onto the Company (§ 1.4), and `IsCustomer`/`IsSupplier` drive § 6.4's supplier filter — so `summaryOnly` would break two features to save payload. `MergedToContactID` is *not* on the exclusion list, but Xero also states `summaryOnly` "enforces pagination by default" while `MergedToContactID` is only returned "when pagination is used", and the docs never resolve that interaction — so its availability under `summaryOnly` is undefined and would need empirical testing. Since the parameter is already ruled out on the three mapped fields, that question never has to be answered. This closes § 10 #9. **The same parameter is separately fatal on the Invoices side**, where its exclusions are `LineItems`, `Payments`, `HasAttachments` and `CISDeduction` — and § 6.3's MVP imports line items. So `summaryOnly` is rejected for both entities, each for a concrete mapped-field reason.

### 6.7 Full resync: two controls in the integration's own configuration **(decided 2026-09-27)**

`If-Modified-Since` provably misses some changes (§ 0.1 [VERIFIED]), so incremental sync alone cannot keep OM correct: an invoice's `DueDate` can change in Xero without ever bumping `UpdatedDateUTC`, and § 6.2 makes that field read-only in OM — wrong data the UI actively refuses to let the user fix.

**The whole mechanism is two controls on the Xero integration's configuration screen**, not a subsystem:

| Control | Behaviour |
|---|---|
| **"Weekly full resync" on/off**, default **on** | Toggling it writes a `SyncSchedule` row — **the same record Data Sync manages**, so this is a one-click facade over the existing scheduler, not a parallel mechanism. The schedule stays visible and editable in Data Sync for anyone wanting a different cadence |
| **"Run full resync now"** | Calls the on-demand trigger `data_sync` already provides. A plain confirmation, because it is long-running |

**Why the configuration screen rather than the Data Sync schedule list — the explanation needs somewhere to live.** A generic schedule list has no room for a paragraph about Xero not reporting certain changes, and without that paragraph the first admin who notices a weekly full sync will switch it off as waste. Putting the toggle next to the explanation, on the screen belonging to the integration whose quirk it compensates for, is what makes the default survive contact with an operator. Platform-wise this is the existing pattern: a provider-injected widget in the credentials tab, the same mechanism carrying the Xero Organisation picker.

**An earlier draft of this section specified a quota-estimating confirmation dialog, and that was over-engineering — refuted by this document's own numbers.** Against the verified 1000-row page size:

| Tenant size | API calls | Share of the 5,000/day limit |
|---|---|---|
| 5,000 invoices + 1,500 contacts | ~7 | 0.14% |
| 50,000 + 10,000 | ~60 | 1.2% |
| Xero's 100,000-invoice ceiling | ~100 | 2% |

A calculator warning an admin about spending 0.14% of a quota is ceremony, not information. **The binding constraint is not Xero's rate limit but OM's write path** — creating and updating thousands of records — and no dialog helps with that.

**What survives from that design, in code rather than UI:** a **pre-flight quota check** reading the persisted `X-DayLimit-Remaining` before a run starts. It costs a few lines and covers the one case where the limit genuinely bites — a tenant above Xero's 100k per-query threshold, where the run is also **auto-chunked by `Date` range** (supported, since `Date` is an optimised filter with range operators, § 0.1). If the budget is insufficient the scheduled run does not start and logs `skipped: insufficient daily quota, retrying next window`, because starting and dying halfway leaves a partially refreshed dataset. The `skipped` entry is explicit rather than a silent no-op — a schedule that quietly declined to run would reintroduce exactly the invisible-failure class this mechanism exists to remove. None of this is surfaced to the admin, who has no reason to reason about Xero's paging thresholds.

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
| US-1.1, US-1.2 | Xero `OAuth2ProviderDescriptor` + the Organisation picker as a Resource Selection hook. **The OAuth flow itself is the toolkit's** (§ 10 #4) | 2 |
| US-2.1, US-2.2, US-2.3 | Contacts sync adapter, tax-number matching + custom field, field-ownership rules, on-demand + scheduled runs | 6 |

**Total: 8 atomic commits** (11 standalone, minus the 3 absorbed by the OAuth2 toolkit).

**Hard prerequisite:** the OAuth2 provider toolkit's Phase 1 must land first. Its own gating questions — approval of `openid-client` as a `core` production dependency, and the `Ask First` sign-off on the descriptor type and canonical route shape — therefore gate this phase too.

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
- **ROI metric:** For a tenant's full set of `ACCREC` invoices in `AUTHORISED`, `PAID` or `VOIDED` status, 100% land as correctly-linked OM Invoices; zero silent amount discrepancies between Xero and OM after any sync.

**PM's challenges to the DDD criteria:** The PM initially questioned whether "reject at the command layer, not just the UI" is over-engineering for an MVP — but since the read-only guarantee is the entire justification for choosing Option A over the simpler Option B in § 6.2, a UI-only enforcement that an API client could trivially bypass would silently fail to deliver the business property this phase exists to provide. Accepted as essential, not cut.

### Phase 3: Scheduled sync hardening + reauthorization UX

**Goal:** Xero data stays current automatically, and a broken connection is surfaced and fixable within minutes, not discovered weeks later as stale data.

**Why this order:** Phases 1-2 already work fully on-demand; this phase is what makes the integration safe to leave unattended, which is the difference between a demo and something a client would actually run their business on.

| Story | What ships | Commits |
|---|---|---|
| WF4 (no new stories — incremental scheduling is configuration, not a new story) | CRON schedule setup guidance, documentation | 0 (pure config via existing Data Sync UI) |
| **WF4 full resync (§ 6.7)** | "Weekly full resync" on/off toggle + "Run now" button in the Xero configuration screen, with the explanatory copy; pre-flight quota check and `Date`-range auto-chunking in code | 1 |
| WF5 reauth flow (folds into US-1.1's connect flow, reused) | Refresh-failure detection, `reauthRequired` flagging, health check | 2 |

**Total: 3 atomic commits**

**Why the full resync belongs in this phase rather than Phase 1:** it exists to correct data that incremental sync silently misses, which only becomes a problem once the integration has been running unattended for a while. Phases 1-2 are operated on demand by someone watching the run log, so the blind spot has no time to accumulate. This phase is where "safe to leave alone" is the goal, and a correctness backstop is exactly what that requires.
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
PREREQUISITE: OAuth2 provider toolkit, Phase 1        15 commits   (separate spec)

Phase 1: Connect + Contacts               8 commits    WF1, WF2
Phase 2: Sales Invoices                   8 commits    WF3
Phase 3: Scheduled sync hardening         3 commits    WF4 (incl. full resync), WF5
                                          ---------
                                          19 atomic commits for production-ready (Phases 1-3)

Decided 2026-09-27: the toolkit ships first, so Xero declares a descriptor and
implements one Resource Selection hook instead of building an OAuth flow. That
removes 3 commits here and gives Xero PKCE, RFC 7009 revocation and cluster-safe
token refresh it would not otherwise have had.
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
| `.ai/specs/2026-09-26-oauth2-provider-toolkit-reuse.md` (Proposed, not yet implemented) proposes narrowing `credential-refresh.ts`'s type off `ChannelAdapter` so `sync_xero` can reuse its refresh-coalescing logic — raised directly out of this spec's Open Question #4 | This spec, the toolkit-reuse spec | No conflict — a standalone, zero-BC-risk proposal this spec depends on optionally: if accepted before Xero's Phase 1 OAuth work starts, `sync_xero` imports the shared helper; if not, Xero ships with its own small equivalent and switches later. Neither spec blocks the other. **Superseded in scope** by the full toolkit App Spec below, which keeps this narrow version as its explicit cheap fallback |
| **`.ai/specs/2026-09-26-app-spec-oauth2-provider-toolkit.md`** (App Spec, on branch `oauth2-provider-toolkit`) designs a full descriptor-driven OAuth2 toolkit in `core/integrations` — generic initiate/callback/disconnect routes, PKCE by default, a cross-process refresh lock, RFC 7009 revocation, a generic Connect UI, and Gmail migrated onto it | This spec, the OAuth2 toolkit App Spec | **DECIDED 2026-09-27: the toolkit ships first, making it a hard prerequisite for this spec's Phase 1.** That spec grew directly out of this one's Open Question #4, treating OAuth reuse as a platform question rather than a Xero-specific one, and it names Xero as its intended first consumer precisely because Xero needs Resource Selection (its generic name for "pick which Xero Organisation") — the hardest extension point. **If the toolkit's Phase 1 lands first**, this spec's WF1 OAuth work drops from ~5 commits to roughly 2 (a descriptor plus the Organisation-picker hook), its Open Question #4 is answered outright, and Xero inherits PKCE, revocation and cross-process-safe refresh for free. **If Xero ships first**, Xero becomes a migration target in the toolkit's Phase 3 alongside Gmail. Either order works and neither blocks; the decision is which to build first, and it should be made explicitly rather than by whichever branch merges sooner. Note the toolkit spec's own § 8 records the reciprocal view, so the two documents agree |

**Two findings from this spec's Xero research that the OAuth2 toolkit spec must absorb.** Recording them here because they were discovered on this side of the boundary and would otherwise be lost:

1. **The toolkit's "a persist failure after a successful remote rotation is definitive" invariant is too strict for Xero.** Xero grants a **30-minute grace period** in which the *old* refresh token may be retried (`/faq/oauth2`, § 0.1 [VERIFIED]). Hard-coding one provider's grace period into a generic invariant would be wrong in both directions — so the toolkit should carry a descriptor field (e.g. `refreshRetryGraceMinutes`, default `0`) and treat a persist failure as definitive only once the window has closed. Xero sets it to 30.
2. **The toolkit's failure taxonomy needs a third class.** It currently splits failures into *transient* and *reauth*. Xero returns **`401` with `WWW-Authenticate: insufficent_scope`** when a granular scope is missing — a case where the token is valid, refreshing loops forever, and the correct action is **re-consent with a wider scope set**, not reauthorization of the same grant. This also gives the toolkit's US-2.3 (downgraded-scope warning) a concrete provider justification, and it interacts with Xero's dated granular-scope migration (§ 10 #11), where scopes are additive and adding one requires explicit re-consent.

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
| 1 | ~~GDPR-erased Contacts: propagate blanked PII into OM?~~ | — | — | PM | **DECIDED (user, 2026-09-27): option (a).** A `GDPRREQUEST` contact flips the OM Company's status only; existing OM field values are never overwritten with Xero's blanks. Rationale on record: OM has **no erasure primitive at all** (`customers`/`shared` contain none — only a comment in `commands/settings.ts:21` anticipating "future GDPR additions"), so overwriting would make this adapter the platform's first erasure mechanism — unaudited, irreversible and CRON-fired, on data it does not own. Separately, OM invoices are accounting records and GDPR Art. 17(3)(b) exempts processing required by a legal obligation. **Follow-on for the platform, explicitly out of this spec's scope: OM needs a real erasure mechanism** |
| 2 | ~~Connecting a different Xero Organisation: flag existing mappings?~~ | — | — | PM | **DECIDED (user, 2026-09-27): option (b).** On (re)connect, compare the newly selected `xeroOrganisationId` against the stored one. If it differs and mappings exist, **block with an explicit choice** naming both organisations and the affected counts ("N companies and M invoices were imported from <old org>; continuing will create duplicates"), offering continue-or-cancel. **Never auto-clean.** `xeroOrganisationId` is recorded alongside each mapping so the superseded set stays filterable. Note the failure mode is mess, not corruption — `ContactID`s are GUIDs, so two organisations' ids can never collide |
| 3 | ~~Revisit the fixed field mapping with a configurable UI?~~ | — | — | PM | **DECIDED (user, 2026-09-27): defer until a real need appears.** Phase 1 ships the fixed mapping. Revisit only when a tenant presents a mapping the fixed set cannot express — not speculatively |
| 4 | ~~Should the refresh-coalescing logic be generalized, and if so what ships first?~~ | — | — | Architect + user | **DECIDED (user, 2026-09-27): the OAuth2 provider toolkit ships first.** Consequences, applied throughout this document: WF1 drops from 5 commits to **2** (Xero declares a descriptor and implements the Resource Selection hook; the routes, the Connect UI and the refresh logic are the toolkit's), Phase 1 drops from 11 to **8**, and the total from 22 to **19**. Xero inherits PKCE, RFC 7009 revocation and cluster-safe refresh rather than building its own. **The toolkit is now a hard prerequisite for Phase 1, not an optimisation** — and its own gating questions (dependency approval for `openid-client`, and the `Ask First` on the descriptor type and canonical route shape) become blockers for this spec too. See `.ai/specs/2026-09-26-app-spec-oauth2-provider-toolkit.md` |
| 5 | ~~Confirm the exact generated entity-id literal for the Company profile custom-field target~~ | — | — | Architect | **Answered by reading the repo.** `packages/core/generated/entities.ids.generated.ts:73` declares `"customer_company_profile": "customers:customer_company_profile"`, so the literal is **`E.customers.customer_company_profile`**, resolving to the string `customers:customer_company_profile`. Usage convention confirmed against real call sites (e.g. `customers/api/addresses/route.ts:47` uses `entityType: E.customers.customer_address`). No design impact — the `xero_tax_number` custom field attaches to that entity id as planned |
| 6 | ~~Confirm the granular scope names~~ | — | — | Architect | **Answered from Xero's Scopes page (§ 0.1).** `accounting.contacts` is **not** being deprecated — only `accounting.transactions`, `accounting.transactions.read` and `accounting.reports.read` are, so the migration touches only the invoice half. The set to request is **`offline_access`, `accounting.contacts.read`, `accounting.invoices.read`**; `openid`/`profile`/`email` are for SSO and deliberately omitted |
| 11 | ~~Confirm the granular scope set before the first consent flow~~ | — | — | Architect | **Not an open question — it is Phase 1's first implementation step.** The scope names are verified from Xero's own Scopes tables (§ 0.1). Two things remain inferences rather than quotes, and a single manual run of the normal consent flow against the Demo Company settles both in minutes: (a) that the granular scopes are actually *assigned* to a newly registered app, since a scope that is not assigned fails `authorize` with `invalid_scope`; (b) that the `.read` variants suffice for our GET calls, inferred from the docs' "As above but GET only". Worth doing before writing code only because scopes cannot be narrowed later without a revoke plus re-consent per tenant |
| 8 | ~~How should a Xero contact merge be handled?~~ | — | — | PM | **DECIDED (user, 2026-09-27): option (a).** On a non-empty `MergedToContactID`: do not update the OM Company mapped to the losing id, mark that mapping superseded, and log a `skipped` item naming both OM Companies and the surviving `ContactID`. The CRM merge stays a human decision, because merging two OM Companies means reassigning invoices, persons, deals, activities, owner and tags with no OM primitive for it — an integration silently destroying CRM data it does not own is worse than a duplicate. **Depends on the paged Contacts walk** (§ 6.1): `MergedToContactID` is not returned by an unpaged list call, so an unpaged implementation is blind to merges without any error |
| 9 | ~~Can `summaryOnly=true` be used for the Contacts walk?~~ | — | — | Architect | **Answered: no, decisively.** The verified exclusion list drops `Addresses` (mapped onto the Company) plus `IsCustomer`/`IsSupplier` (which drive § 6.4's supplier filter), so it would break two features to save payload. Its undefined interaction with `MergedToContactID` therefore never needs resolving (§ 6.6) |
| 10 | ~~.NET date format: parse it, or prefer the `*String` variants?~~ | — | — | Architect | **Answered: prefer the `*String` variants.** The Invoices page confirms `UpdatedDateUTCString` is "Last modified date in **ISO-8601** format", alongside `DateString`/`DueDateString`. The adapter parses the .NET `/Date(epoch_ms)/` and `/Date(epoch_ms+0000)/` forms only where no string variant exists (§ 0.1) |
| 7 | ~~Should setup guidance tell tenants to populate `xero_tax_number` before the first sync?~~ | — | — | PM | **Downgraded on review: this is a documentation line, not a design decision, and it was over-weighted as an open question.** The advice is free to write and helps a tenant with a few dozen legacy Companies, but it does not scale precisely where it would matter — hand-filling tax IDs across thousands of records is a project in itself. Default to writing it into the setup docs. **The real safety net for first-sync duplicates is § 6.1b's ambiguity reporting**, not this |
| 12 | ~~`If-Modified-Since` misses some changes — add a periodic full resync?~~ | — | — | PM | **DECIDED (user, 2026-09-27).** Two controls in the Xero integration's own configuration screen: a **"Weekly full resync" on/off toggle (default on)** that writes a `SyncSchedule` row — a facade over the existing Data Sync scheduler rather than a second mechanism — and a **"Run now"** button calling the existing on-demand trigger. The configuration screen was chosen over the generic schedule list **because the explanation needs somewhere to live**: without a note about Xero not reporting certain changes, the first admin to notice a weekly full sync switches it off as waste. A quota-estimating dialog was specified and then dropped as over-engineering, refuted by this document's own figures (a full resync costs 0.14-2% of the daily limit). See § 6.7 |

#### Checklist
- [x] Every question has options, impact, owner, status
- [x] No BLOCKER-severity question is unresolved before its phase starts — ten questions now, none blocking Phase 1 from starting. The highest-impact one is #8 (contact merges), added by the OpenAPI verification; it is Medium-High because it is a *silent* data-rot risk, and its recommended Phase 1 answer (detect, skip, log, defer to a human) is cheap
- [x] Decided questions (§ 6's five decisions) have their rationale recorded in § 6, not repeated here
- [x] Questions that later research *answered* are shown as answered with what changed (#4, #6), not quietly deleted

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
- Same-day follow-up: Open Question #4's refresh-coalescing question was written up as a standalone proposal, `.ai/specs/2026-09-26-oauth2-provider-toolkit-reuse.md`, recommending a narrow, zero-BC-risk type change to `credential-refresh.ts` rather than a bigger module-move. Linked from Open Question #4 and added to § 8 Cross-Spec Conflicts. Neither this spec nor the new proposal blocks the other.

### 2026-09-27
- **Xero API research upgraded from trained knowledge to verified, closing the brief's Step 1 as far as the environment permits.** A later session obtained outbound network access and fetched Xero's official published API definition (`XeroAPI/Xero-OpenAPI`, `xero_accounting.yaml`, 933 KB — the source Xero's own SDKs are generated from). § 0.1 is now split into a **[VERIFIED]** tier (every Contact, Invoice and LineItem field this spec maps; all enums; all pagination and incremental-sync parameters) and an **[UNVERIFIED]** tier (OAuth lifetimes, scope names, endpoint URLs, rate limits, Demo Company) that could not be confirmed because `developer.xero.com` is a client-rendered Next.js application serving a content-free shell to a non-browser client. § 10 #6 is narrowed accordingly.
- **The verification found and fixed a real bug in this spec.** § 6.3 required pulling only `Status IN (AUTHORISED, VOIDED)`; the verified `Invoice.Status` enum includes **`PAID`** as a first-class value, so that filter would have **silently skipped every fully-paid invoice** — for most established Xero organisations, the majority of their invoice history. Corrected to `AUTHORISED, PAID, VOIDED` in § 3 (WF3), § 6.3 and § 6.4. The spec's own first-draft verification checklist had asked exactly this question and guessed wrong, which is a reasonable argument for verifying enums before designing filters on them.
- **New constraint discovered: Xero contacts can be merged.** The verified schema carries `MergedToContactID`, meaning two previously-mapped `ContactID`s can collapse onto one Xero contact, leaving two OM Companies claiming the same source record while only one keeps receiving updates. Two traps compound it: the field is documented as returned *only* when paging or fetching by id, and `summaryOnly=true` — the rate-limit optimization this spec would otherwise want — drops exactly this class of field. Added to § 6.1 with a deliberately minimal Phase 1 answer (detect, mark the losing mapping superseded, log a `skipped` item naming both OM Companies, leave the CRM merge to a human, because auto-merging Companies would reassign invoices, contacts, deals and owners with no safe automatic answer), plus new Open Questions #8 and #9.
- **Other verified corrections:** `Invoice.Type` has **eight** enum members, not two, which makes the MVP's `Type=="ACCREC"` filter demonstrably exact rather than assumed binary. `IsCustomer`/`IsSupplier` are **read-only and computed** from invoice existence, so a brand-new contact has both `false` — the supplier-only filter in § 6.4 must test `IsSupplier=true AND IsCustomer=false`, never `IsCustomer=false` alone, or it would exclude every contact created since the last invoice run. `ContactNumber` is API-writable but **read-only in the Xero UI**, making it a strictly better key than `AccountNumber`, which is user-editable in both — § 6.1 had treated them as interchangeable. `TaxNumberType`'s enum is US-only (`SSN`/`EIN`/`ITIN`/`ATIN`), so it cannot help normalize non-US tax numbers. Xero serializes dates as .NET `/Date(…+0000)/`, so a naive `new Date()` yields `Invalid Date` (new Open Question #10). Xero's own guidance to prefer explicit `Statuses`/`IDs`/`ContactIDs` parameters over `where` substantiates this spec's existing incremental-loop design, and `ContactIDs` gives § 6.5's failure handling a precise tool.
- **Reconciled with the OAuth2 provider toolkit App Spec**, which grew out of this document's Open Question #4 and now exists in full on branch `oauth2-provider-toolkit` (25 commits, platform-scoped, Xero named as its intended first consumer). § 8 gains the cross-reference and the sequencing decision — if the toolkit's Phase 1 lands first, this spec's WF1 OAuth work drops from ~5 commits to roughly 2 and inherits PKCE, revocation and cluster-safe refresh; if Xero ships first, it becomes a migration target in the toolkit's Phase 3. Open Question #4 is reframed from "should we generalize?" (answered: yes, twice over) to "which ships first?", and its impact raised from Low to Medium because it materially changes this spec's estimate.
- **Added § 6.1b, the one decision the brief asked for that the first draft had folded into prose rather than presenting as options**: how to match Xero Contacts against Companies that already existed in OM before the first import. Grounded by reading the reference importer's code rather than its spec — `buildEmailDedupeIndex` loads every active Person ordered by `createdAt: 'asc'` and skips any email already in the map, so the CSV import resolves ambiguity by **silently preferring the oldest record**, performs no fuzzy matching, surfaces no conflicts, builds its index once before the run (so two rows in one file can still duplicate), and filters to `isActive: true` (so an archived record never matches and a duplicate is created beside it). Three options presented; recommendation is to mirror the precedent's keys and oldest-wins resolution but **report** ambiguity, since silent resolution is defensible for an attended one-file import and much less so for an unattended scheduled job.
- **Second research pass: most of the "unverifiable" tier was reachable after all.** The first pass concluded `developer.xero.com` could not be read because `/documentation/guides/*` is a client-rendered Next.js app serving a content-free 139 KB shell. That was true but incomplete — `developer.xero.com/sitemap.xml` lists **server-rendered FAQ pages** carrying the same operational facts. Fetched `/faq/limits`, `/faq/oauth2`, `/faq/granular-scopes` and `/faq/getting-started`, which promoted nearly the whole [UNVERIFIED] tier to [VERIFIED] and left exactly one open item (the granular scope names, on the client-rendered Scopes page — § 10 #6).
- **Confirmed at source:** access token 30 minutes; refresh token 60 days when unused, single-use rotation; PKCE supported; redirect URIs must be absolute with no wildcards, 50 per app; Concurrent 5 / Minute 60 / Daily 5,000 per organisation; pagination 100 per page, explicitly supported on both `invoices` and `contacts`; Demo Company plus API Explorer as the dev environment.
- **Three findings that changed the design, not just the citations:**
  1. **Insufficient scope returns `401` with `WWW-Authenticate: insufficent_scope` (Xero's spelling), not `403`.** The first draft had it as `403`. This is load-bearing: a plain `401` means "refresh the token", but this one means "the token is fine, the grant is too narrow" — refreshing loops forever. The adapter must branch on the header, and the companion OAuth2 toolkit needs a third failure class beyond transient/reauth: **re-consent-with-new-scopes**. Updated § 0.1 and § 6.6.
  2. **Xero began a dated granular-scope migration on 2 March 2026.** Apps created on or after that date get granular scopes with no opt-out — which includes any app registered for this integration today. So `accounting.transactions` (broad, being retired) is wrong for us; Xero's own migration example is replacing it with `accounting.invoices`. Scopes are additive and adding one later requires **explicit re-consent** across every connected tenant. New Open Question #11; § 10 #6 reframed as "read the scope names" and raised to Medium because it gates the descriptor.
  3. **A 30-minute grace period exists for retrying a failed refresh** with the *old* refresh token. This contradicts the OAuth2 toolkit spec's invariant that a persist failure after a successful remote rotation is definitive — for Xero it is recoverable for 30 minutes. Recommended fix is a descriptor-level `refreshRetryGraceMinutes` rather than hard-coding one provider's grace period into a generic invariant. Carried as a note for the toolkit spec.
- **Also new: the app-wide rate limit and the quota headers.** Xero enforces an **App Minute Limit of 10,000 calls/minute across all tenants** (unknown to the first draft; the ceiling once OM runs many tenants from one registered app), and every response carries `X-MinLimit-Remaining`, `X-DayLimit-Remaining` and `X-AppMinLimit-Remaining`. § 6.6 now reads the quota from those headers instead of counting calls locally — strictly better, because a local counter cannot see parallel runs, restarts, or another client sharing the app registration. Also recorded: limits cannot be increased, and `summaryOnly=true` is deliberately declined for Contacts because it drops the `MergedToContactID` merge signal.
- **Third research pass — the scope question answered as far as any source allows, plus the Identity API verified.** Rather than wait on a screenshot of the client-rendered Scopes page, checked Xero's published OpenAPI directly: `securitySchemes.OAuth2.flows.authorizationCode` declares the full scope list with descriptions, and every operation declares its own `security` block. That yields the **exact per-endpoint mapping**: `GET /Contacts` needs `accounting.contacts` or `accounting.contacts.read`; `GET /Invoices` needs `accounting.transactions` or `accounting.transactions.read`. It also confirms both OAuth endpoint URLs verbatim (`https://login.xero.com/identity/connect/authorize`, `https://identity.xero.com/connect/token`). **Design consequence: since this integration is import-only, the `.read` variants are the correct ask** — the first draft mentioned them only parenthetically, but requesting read-write on an import-only integration is needless privilege and a worse consent screen.
- **The granular scope names have no machine-readable source yet, and that is now a documented fact rather than a gap.** Xero's own OpenAPI still declares only the broad scopes, so the granular model postdates their published spec. Open Question #6 is reframed around a **self-serve resolution taken from Xero's own FAQ**: create a test app in the Developer Portal, which after 2 March 2026 uses granular scopes by default and can be verified against the Demo Company — closing the question without the client-rendered docs page and validating the scope list in the same step. The per-endpoint *mapping* is known either way, so only the names are provisional.
- **Verified the Identity Service API from `xero-identity.yaml` (v19.0.0), which corrected one path and added two useful fields.** The endpoint is **`GET https://api.xero.com/Connections`** — capital `C`, where the first draft wrote it lowercase — and `DELETE /Connections/{id}` returns `204`. The `Connection` schema carries two fields the first draft lacked, both of which simplify existing designs: **`authEventId`** ("Identifier shared across connections authorised at the same time", filterable via `?authEventId=`) is a cleaner way to group the Organisations approved in one consent round than comparing timestamps, which matters for WF1's multi-Organisation picker; and **`updatedDateUtc`** ("May differ to the created date if the user has disconnected and subsequently reconnected") is a provider-supplied reconnect signal for Open Question #2 instead of inferring it locally. Xero's own example response names `"Demo Company (NZ)"`, independently corroborating the dev-environment section.
- **Net effect of three passes on § 0.1:** 27 [VERIFIED] citations against 3 remaining [UNVERIFIED] facts (Developer Portal UX, the localhost redirect allowance, and the granular scope names). Four corrections changed design rather than citations: the missing `PAID` status, `401`-not-`403` for insufficient scope, the `/Connections` capitalisation, and `.read` scopes as the correct ask. Two findings created new work: the contact-merge constraint and the granular-scope migration. One finding contradicts the companion OAuth2 toolkit spec (the 30-minute refresh grace period vs. its "persist failure is definitive" invariant) and is carried there as a descriptor-level capability rather than a generic rule.
- **Fourth pass — three documentation screenshots read by subagents (Scopes, HTTP Requests and Responses, Contacts), closing the last research gaps.** Delegated to keep the extraction out of the main context; each agent sliced the very tall PNGs with ImageMagick and transcribed tables verbatim.
- **The scope question is settled, and one of my own assumptions was wrong: `accounting.contacts` is NOT being deprecated.** Xero's deprecation table has exactly three rows — `accounting.transactions`, `accounting.transactions.read` and `accounting.reports.read` — so the granular migration touches only the *invoice* half of this integration. `accounting.transactions` splits into `accounting.invoices` + `accounting.payments` + `accounting.banktransactions` + `accounting.manualjournals`. **The set to request is `offline_access`, `accounting.contacts.read`, `accounting.invoices.read`**; `openid`/`profile`/`email` are documented as being for single sign-on and are deliberately omitted, since this integration reads accounting data and takes its connected-account label from `/Connections.tenantName`. Also recorded: scopes are additive and *"It's not possible to remove scopes from an existing access token"* — over-requesting is a one-way door needing a revoke plus re-consent per tenant to undo. Closes § 10 #6; § 10 #11 drops to a single test-app confirmation.
- **A design-changing finding: `If-Modified-Since` has a documented blind spot.** Xero states that `DueDate` and `SentToContact` changes on partially paid transactions, and `Balances`/`IsCustomer`/`IsSupplier` on contacts, **do not bump `UpdatedDateUTC`** and therefore never appear in an incremental run. Two consequences: an invoice's due date can go permanently stale in OM, quietly falsifying § 6.2's source-of-truth claim (new Open Question #12, recommending a slow full-resync backstop); and § 6.4's supplier filter could permanently exclude a contact who later becomes a customer — **safe only because § 6.5's invoice-side self-heal is immune to the blind spot**, now stated as load-bearing so it is not later removed as redundant.
- **Paging is a correctness requirement for Contacts, not a performance choice.** "GET Contacts without paging only returns a subset of elements", and the fields gated behind paging include **`MergedToContactID`** — so § 6.1's merge detection is impossible on an unpaged walk. This also closes § 10 #9 decisively: `summaryOnly=true` excludes ten documented fields, three of which this integration needs (`Addresses`, `IsCustomer`, `IsSupplier`), so it is rejected outright and its undefined interaction with `MergedToContactID` never needs resolving.
- **Corrected my own reasoning about Name matching.** This spec had claimed Xero does not enforce Name uniqueness. It currently *does* — `PUT /Contacts` errors on a duplicate `ContactName` or `ContactNumber`. But Xero's Contacts page carries an "Important Update" warning that *"'Contact Name' may no longer be a unique field"* and advising developers to key on `ContactID`. The recommendation never to auto-match on Name is unchanged; its justification is now the vendor's own deprecation notice rather than a mistaken premise.
- **Other verified corrections and additions:** `pageSize` maxes at **1000**, not 100 (default 100, min 1, out-of-range clamped) — an order-of-magnitude improvement to the § 6.6 rate-limit budget. **The Accounting API returns XML by default**; JSON requires `Accept: application/json` on every request, which the spec had never mentioned. Default ordering is already `UpdatedDateUTC ASC, ContactID ASC`, giving the stable page-boundary tiebreak the incremental walk needs for free. Only `Name`, `EmailAddress` and `AccountNumber` are optimised for filtering (equals only), and only `ContactID`, `UpdatedDateUTC`, `Name` for ordering; exceeding **100,000 contacts** in a response, or filtering/ordering on unoptimised fields at that volume, is rejected with a `400`. `searchTerm` is Xero's sanctioned substring-search path. Dates are epoch **milliseconds** in two shapes, `/Date(1439434356790)/` and `/Date(1419937200000+0000)/`.
- **Net after four passes: 42 [VERIFIED] citations, an empty verification checklist, and twelve open questions of which three are now answered.** The remaining pre-implementation step is confirmation rather than research — register a test app against the Demo Company and run the three-scope consent flow end to end.
- **Fifth pass — the Invoices documentation page, supplied as saved HTML rather than a screenshot, so it was parsed locally instead of transcribed.** It found the sharpest trap yet, and one the design escapes only by accident worth documenting.
  - **A plain list call returns no line items.** Xero: *"When you retrieve multiple invoices, only a summary of the contact is returned and no line details are returned… The line item details will be returned when you retrieve an individual invoice, either by specifying Invoice ID, Invoice Number, querying by Statuses, or by using the optional paging parameter."* § 6.3's MVP imports header **and** line items, so a naive `GET /Invoices?If-Modified-Since=…` would have produced invoices with zero lines — passing every count-based check while being useless. **The design survives because it already filters by status**, and Xero enforces pagination on status queries, which in turn returns line items. WF3 and § 6.6 now state `?Statuses=AUTHORISED,PAID,VOIDED` as a *required* query shape rather than an incidental one.
  - **`summaryOnly` is fatal on this side too**, excluding `LineItems`, `Payments`, `HasAttachments` and `CISDeduction`. With the Contacts exclusions already ruling it out, the parameter is now rejected for both entities for concrete mapped-field reasons rather than caution.
  - **Every filter this spec uses is on Xero's optimised list**, which is much richer for Invoices than Contacts: `Status`, `Type`, `InvoiceId`, `InvoiceNumber`, `Reference`, `Contact.ContactID`, `Contact.Name`, `Contact.ContactNumber`, `Date`, `DueDate`, `AmountDue`, `AmountPaid`, with range operators on the date and amount fields. So `Type=="ACCREC"` is safe rather than a threshold risk. Multi-value filtering must use the `Statuses`/`IDs`/`InvoiceNumbers`/`ContactIDs` list parameters, because Xero optimises `or` for `InvoiceId` only.
  - **A third independent confirmation of the `PAID` correction:** Xero's own worked example on this page is `?Statuses=AUTHORISED,PAID&ContactIDs=…`.
  - **Status transitions verified at source**, confirming § 6.4 rather than merely agreeing with it: the only terminal transitions are `AUTHORISED -> VOIDED` and `DRAFT|SUBMITTED -> DELETED`, so an import filtered to `AUTHORISED, PAID, VOIDED` can never encounter a `DELETED` invoice. `PAID` is system-set — *"Once an invoice is fully paid the status will change to PAID"*.
  - **Closes § 10 #10:** `UpdatedDateUTCString` is documented as "Last modified date in ISO-8601 format", so the adapter prefers the `*String` variants and parses the .NET `/Date(…)/` form only where none exists.
  - Also recorded: the same 100k high-volume threshold and `400`; optimised ordering on `InvoiceId`/`UpdatedDateUTC`/`Date` with default `UpdatedDateUTC ASC, InvoiceId ASC`; a record filter accepting `InvoiceNumber` as well as `InvoiceID`; and `SearchTerm` across `InvoiceNumber` and `Reference`.
- **Status after five passes: the verification checklist is empty, 10 of 12 open questions are answered or narrowed to a confirmation step, and every remaining item is a decision for the reader rather than research.** Four of the five passes changed a design rule; none merely added citations.
- **Two corrections after user review.** (1) The sample CSV file mentioned in the brief is **out of scope** — it was cited as a reference *approach*, not as test data, and § 6.1b derives its rules from reading `sync_excel`'s code (`buildEmailDedupeIndex`), so no data file was ever needed. Removed from the outstanding list. (2) **Open Question #11 was overstated and is reclassified as Phase 1's first implementation step**, not a research item. The scope names are verified from Xero's own tables; what remains are two inferences — that granular scopes are actually *assigned* to a newly registered app, and that the `.read` variants cover our GET calls — both settled by running the ordinary OAuth consent flow once by hand against the Demo Company. It is worth doing before writing code only because Xero does not allow narrowing scopes later without a revoke and per-tenant re-consent.
- **Sixth pass — open questions re-examined under user challenge, and four of them changed.**
  - **#1 (GDPR) sharpened by a repo finding:** `customers` and `shared` contain **no erasure or anonymisation mechanism whatsoever** — the only GDPR reference in the module is a comment anticipating "future GDPR additions". So the "overwrite with blanks" option would make a Xero adapter the platform's first erasure mechanism, unaudited and CRON-fired, on data it does not own. Recommendation (a) hardened from a preference to a boundary, with the decision narrowed to a single business call.
  - **#2 corrected — I had overstated a finding.** This spec claimed `Connection.updatedDateUtc` was the signal for detecting an organisation switch. It is not: it only reveals that the *same* tenant was reconnected. The decisive signal is comparing the stored `xeroOrganisationId`, which the design already persists. Also clarified that the failure mode is mess rather than corruption — Xero `ContactID`s are GUIDs, so two organisations' ids can never collide; the damage is a full set of duplicates plus silently rotting records.
  - **#7 downgraded from an open question to a documentation line.** The advice to pre-populate `xero_tax_number` does not scale precisely where it would matter, and § 6.1b's ambiguity reporting is the real safety net. It was over-weighted.
  - **#12's cost objection evaporated against the verified page size.** With `pageSize` maxing at **1000** rather than the 100 first assumed, a full resync costs ~10 calls for a 10k-invoice tenant and ~100 at Xero's 100k ceiling — 2% of the daily budget. Recommendation (a), a weekly full resync, is now clearly right rather than a trade-off, with a documented `Date`-range chunking path for tenants above the threshold.
- **Five open questions closed by user decision (2026-09-27): #1 GDPR, #2 organisation switch, #3 configurable mapping, #8 contact merges, #12 full resync.** Rationale for each is recorded inline in § 10 rather than only in this changelog, so an implementer reading the question sees why it was settled.
- **#12 gained a design from the user's counter-proposal.** The suggestion was a manual button showing the rate-limit consequences. Adopted **in addition to** the weekly schedule, not instead of it — a button-only design leaves the defect untouched, because the blind spot is silent and nobody triggers a refresh on a hunch. New § 6.7 specifies both, and the quantification behind it reframes the risk: against the verified 1000-row page size a full resync costs ~7 calls for a typical tenant and ~100 at Xero's ceiling (2% of the daily limit), so **the binding constraint is OM's write path, not Xero's rate limit**. The dialog can be precise rather than vague because `pagination.itemCount` plus the `X-DayLimit-Remaining`/`X-MinLimit-Remaining` response headers supply real numbers. Implementation is small: `data_sync` already provides on-demand triggering, run history and overlap detection, so only a "full" run-mode flag and a confirmation dialog are new.
- **§ 6.7 clarified after a user question exposed an ambiguity:** the first version of the section described the weekly schedule and the manual button together and then described "the confirmation dialog", reading as though a dialog preceded both. It does not — a CRON-triggered run has no human to confirm. The dialog belongs solely to the manual button; the **scheduled run gets a pre-flight quota check instead**, skipping with an explicit `skipped: insufficient daily quota` log entry rather than starting and failing halfway on a partially refreshed dataset. Same information, two consumers: a human reads it to decide, the scheduler uses it as a start condition. Also recorded: the weekly schedule is visible and editable in the Data Sync UI like any other, but **on by default**, because the blind spot it covers is silent.
- **§ 6.7 simplified on user challenge, and the challenge was right.** The proposal was to make this ordinary configuration — an on/off toggle for the weekly full resync, the reason it exists written next to it, and a "Run now" button — rather than a bespoke mechanism. Adopted, for a reason this document had already established and then ignored: the quota-estimating confirmation dialog specified an hour earlier was **refuted by these very numbers**, since a full resync consumes 0.14–2% of the daily limit and warning an admin about that is ceremony, not information. Two further points came out of the rework. First, the toggle writes a `SyncSchedule` row, so it is a **facade over the existing Data Sync scheduler, not a parallel one**, and the schedule stays visible and editable there for anyone wanting a different cadence. Second, the configuration screen beats the generic schedule list **because the explanation needs somewhere to live** — a schedule list has no room for a paragraph about `If-Modified-Since`, and without it the first admin to notice a weekly full sync will disable it as waste. What survives in code rather than UI: the pre-flight quota check and `Date`-range auto-chunking, which cover the only case where the rate limit genuinely bites (a tenant above Xero's 100k per-query threshold) and which the admin has no reason to reason about.
- **Sequencing decided (user, 2026-09-27): the OAuth2 provider toolkit ships first, and this document is rescored throughout rather than merely annotated.** Xero no longer builds an OAuth flow — it declares an `OAuth2ProviderDescriptor` and implements one Resource Selection hook for the Organisation picker. WF1 drops from 5 commits to **2** (the initiate/callback/disconnect routes and the Connect/disconnect widget are struck, both now the toolkit's), Phase 1 from 11 to **8**, and the total from 22 to **19**. Xero inherits PKCE, RFC 7009 revocation and cluster-safe token refresh it would otherwise not have had. **The relationship is now a hard dependency, not an optimisation**, so the toolkit's own gating questions — approval of `openid-client` as a `core` production dependency, and the `Ask First` sign-off on the descriptor type and canonical route shape — gate this spec's Phase 1 as well. § 4, § 7, § 8 and § 10 #4 all updated; the last open question in this document is now closed.
