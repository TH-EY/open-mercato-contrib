# UDIP Request Desk — public-information request assistant for Bydgoszcz City Hall (demo)

## TLDR

**Key Points:**
- A staff-only Open Mercato app module, `public_info_requests`. It helps Biuro Komunikacji
  Społecznej (BKS, the "AIP") handle requests for access to public information (*wnioski o
  udostępnienie informacji publicznej*, UDIP):
  - register a request from an uploaded PDF, DOCX or scan, with OCR;
  - find similar past requests;
  - get a proposal of which departments to ask and what to ask them;
  - upload department replies;
  - generate a sourced draft letter and anonymise it;
  - export the letter;
  - track the statutory deadline in a request calendar.
- **Purpose of this spec:** a stable, working **demo** for the Hacknation 2026 UMB challenge. It
  should run end to end on the ten sample requests and responses UMB provided, follow the platform
  conventions, and leave a clean path to production. Edge cases a demo does not need are listed under "Deferred for the demo" rather than designed.

**Scope:**
- Request calendar (list and month view) with deadline highlighting, statuses, officer initials
  and a year filter.
- Intake: upload, text extraction and OCR, AI field and question extraction, live deadline
  calculation.
- Similar-request search over an archive seeded from the sample cases.
- Routing proposal: departments plus the scope to request, with sources and legal flags.
- Department replies as attachments, mapped to the request's questions.
- Draft letter generation with source citations and a deterministic grounding check.
- Anonymisation of the draft and the department replies: suggestions shown grey, accepted marks
  black, and export removes the text for real.
- Export of the final letter as DOCX, PDF and TXT. Recording that it was sent, plus extension
  (*kwerenda*) and clarification flows.
- Knowledge base and admin screens kept to what the demo needs: departments, archive import, a
  deadline setting.

**Concerns:**
- Built-in OCR currently calls an OpenAI vision model. That is acceptable for the hackathon
  (synthetic data, explicitly allowed), but production must run offline (see Configuration and risk R1).
- The platform has no PII detector, so this module adds one: deterministic rules plus an LLM pass.
  Recall on free-text names depends on the model (risk R3).
- The brief says "14 working days", but UDIP art. 13 says 14 days. The default follows the
  statute and the rule is a setting (D1).

## Overview

The module serves BKS officers, the BKS supervisor, and a knowledge admin at Urząd Miasta
Bydgoszczy. It replaces a spreadsheet register ("kalendarium") and hand-written letters with an
assistant that never acts on its own: every suggestion is accepted, edited or rejected by an
officer, and the system never sends anything.

Inputs come from the UMB challenge package:
- the challenge brief;
- Zarządzenie Prezydenta Miasta Bydgoszczy nr 535/2024 (§9–§12 define the AIP workflow);
- the UMB list of 28 categories of data subject to anonymisation;
- the request register spreadsheet;
- ten sample requests (DOCX and scanned PDF) with their anonymised responses.

The interactive prototype at `.ai/prototypes/udip-request-desk/` and its requirements and story
map, `.ai/prototypes/udip-request-desk.requirements.md`, are the UX source of truth. This spec
references their screen numbers (s1–s21) and story IDs (US-*). Where the prototype shows something
this demo defers, "Deferred for the demo" says so.

> **Market reference.** We looked at FOI case-management tools: Alaveteli/WhatDoTheyKnow (public
> FOI portal), GovQA and NextRequest (US public-records request management), and Polish document
> management systems (EZD RP, SIDAS).
> - **Adopted:** a request register with statutory clocks, routing to internal owners, a reusable
>   archive of past answers, redaction before release, and a full audit trail.
> - **Rejected:** a public requester portal and automatic outbound messaging (the brief forbids
>   both), and integration with SIDAS or ePUAP (explicitly out of scope).

## Problem Statement

1. **Deadlines are tracked by hand.** The 14-day clock is read off a spreadsheet. Extensions
   (art. 13 ust. 2) and clarification pauses are recorded as free text ("19.08.2026/18.09.2026 —
   doprecyzowanie wniosku").
2. **Repeated research.** The same topics come back: primary-school pupils in 307/2025 and
   599/2026, homeless animals in 293/2025 and 543/2026. Past answers are found from memory.
3. **Routing depends on individual knowledge.** Choosing the right department, or recognising
   that the city doesn't hold the information (15/2026 goes to the voivodeship conservator,
   17/2026 to ZDMiKP), depends on individual experience.
4. **Letters are written from scratch**, even though they follow a few fixed patterns: answer
   ("Ad 1 … Ad n"), extension notice, clarification request, "not held, please contact X".
5. **Anonymisation is manual and error-prone.** Contracts, construction logs and department
   replies contain private names, signatures, phone numbers and addresses (590/2026).

## Proposed Solution

One app module, `apps/mercato/src/modules/public_info_requests/`, built from platform primitives:

| Need | Platform primitive reused | New in this module |
|---|---|---|
| Upload, extraction, OCR | `attachments` module (`attachmentService`, `AttachmentsSection`, `extractAttachmentContent`, queued `OcrService`) | Partition `publicInfoRequests` with `requiresOcr: true` |
| AI field extraction, routing, drafting, PII | `@open-mercato/ai-assistant`: `defineAiAgent` with `executionMode: 'object'`, `runAiAgentObject` (accepts `attachmentIds`); providers include `ollama`, `lm-studio` and any OpenAI-compatible base URL | Four object agents in `ai-agents.ts` |
| Similar requests | `@open-mercato/search` vector strategy (pgvector/qdrant/chroma; embeddings include `ollama`) via `searchService.search(text, { tenantId, organizationId, entityTypes, strategies: ['vector'] })` | `search.ts` that indexes **only closed or imported cases**, using anonymised text |
| Calendar | `DataTable`, `ScheduleView` (`@open-mercato/ui/backend/schedule`, month view) | Deadline row styling |
| Forms and CRUD | `makeCrudRoute`, `CrudForm`, optimistic locking (default on) | Entities in Data Models |
| DOCX and PDF export | `@open-mercato/documents` `renderDocxWithCapacity(html)` and the HTML→PDF renderer (`puppeteer-core`, `DOCUMENTS_PDF_CHROMIUM_PATH`) | BKS letterhead HTML template |
| Deadlines | — (no shared holiday utility exists) | `lib/deadlines.ts`: pure functions plus a Polish public-holiday generator |
| PII detection and redaction | — (only log redaction exists) | `lib/pii/`: rule detectors plus an LLM detector; redaction marks with burn-in on export |

### Design Decisions

These carry over the prototype's defaults (requirements §4). They were confirmed by the product
owner as "looks good" on 2026-11-21.

| # | Decision | Rationale |
|---|---|---|
| D1 | Deadline = receipt date + 14 **calendar** days (KPA art. 57 §1). If the last day is a Saturday, Sunday or public holiday it moves to the next working day (art. 57 §4). Org setting `deadlineMode: calendar \| working`, default `calendar`. | The statute wins. The brief's "14 working days" stays available as a setting. |
| D2 | Extension: new date ≤ receipt + 2 months (shifted the same way). Requires a reason and a drafted notice. | UDIP art. 13 ust. 2. Matches sample notice 543. |
| D3 | Clarification pauses the clock. The requester has 7 days from delivery. A reply sets a new deadline of reply date + 14 days (officer may override). No reply → *left unprocessed*. | Matches sample 509 and common practice. |
| D4 | Similar matches never skip routing. The officer picks one of: reuse the answer structure, start the draft from the past answer, or refer to BIP. | Data goes stale (2024 vs 2026 figures). |
| D5 | Case number `BKS.IV.1431.<seq>.<year>` is suggested as max+1 per org and year, editable, unique. | SIDAS assigns the official number; no integration. |
| D6 | Letter types: `answer`, `extension_notice`, `clarification_request`, `not_held_referral`, `bip_referral`, `refusal_decision_draft`, `left_unprocessed`. | Covers every sample letter. |
| D7 | Anonymisation covers the draft and department-reply text. Accepted marks are removed (not overlaid) on export. | Challenge criterion, weighted 20%. |
| D8 | UI language Polish (`pl` locale file is primary), English keys as the fallback. | Staff and letters are Polish. |
| D9 | Nothing is ever sent. "Mark as sent" only records a date and channel. | Hard constraint from the brief. |
| D10 | One module, one spec. The calendar, generator and anonymiser are not deployed separately. | They share one entity and one flow, and the demo is evaluated as a whole. |

### Alternatives Considered

| Alternative | Why rejected |
|---|---|
| Static HTML or SPA demo outside Open Mercato | No auth, RBAC, tenancy, attachments, search or AI plumbing. Rebuilding them would cost more than using the module system. |
| Put the module in `packages/core` | It is city-specific. App modules belong in `apps/mercato/src/modules/`. |
| Add `docx`/`docxtemplater` | `@open-mercato/documents` already renders HTML → DOCX/PDF, and a new production dependency needs approval. |
| Tesseract for OCR now | A new binary dependency. The built-in OCR pipeline already works for the demo. Tesseract or a local vision model is the production follow-up (R1). |

## User Stories / Use Cases

The full story map is in requirements §5. The demo implements:

| Story | Demo scope |
|---|---|
| US-A1 calendar list, oldest→newest, highlight today and tomorrow, year filter | Full |
| US-A2 month view | Full, using `ScheduleView` month mode |
| US-A3 supervisor workload | Deferred |
| US-B1 upload, OCR, phone note | Full |
| US-B2 pre-filled fields, live deadline, case number, split into questions | Full |
| US-B3 same requester has an open case | Simple: name match warning |
| US-C1 similar requests and actions | Full |
| US-C2 archive search page | Full (same search API) |
| US-D1 routing proposal with sources and flags | Full |
| US-D2 copy or download note, mark as sent | Full |
| US-E1/E2 upload department reply, map to questions, detect PII | Full |
| US-F1/F2 sourced draft, letter types | Full |
| US-G1 anonymisation grey→black, categories, public-function exemption | Full for draft and reply text. Visual PDF redaction deferred. |
| US-H1/H2 export, record sending, add to archive | Full |
| US-H3 extension | Full |
| US-H4 clarification | Full |
| US-I1 knowledge base | Archive import CLI and UI list. Law versioning deferred. |
| US-I2 departments | Full CRUD plus seed |
| US-I3 deadline settings | `deadlineMode`, internal offset, holidays read-only |

## Architecture

```
Backend pages (Polish UI)                         Server (module public_info_requests)
──────────────────────────                        ─────────────────────────────────────────
s1/s2 Calendar  ── GET /requests, /calendar ──▶   makeCrudRoute(PublicInfoRequest) + lib/deadlines
s4–s6 Intake    ── POST /attachments (core) ──▶   attachments: extract text / queue OCR
                ── POST /intake/extract ─────▶    runAiAgentObject(intake_extractor)
                ── GET  /requests/:id/similar ▶   searchService.search(vector) over anonymised index
s7/s8 Routing   ── POST /requests/:id/routing/suggest ▶ runAiAgentObject(router) + departments + matches
                ── POST /requests/:id/routing/accept ─▶ DepartmentQuery rows (command)
s9/s10 Case     ── POST /attachments + PUT /department-queries/:id ▶ reply mapped to questions
s11 Draft       ── POST /requests/:id/drafts ────▶ runAiAgentObject(drafter) → lib/grounding check
s12 Anonymise   ── POST /drafts/:id/pii/detect ──▶ lib/pii rules + runAiAgentObject(pii_detector)
                ── PUT  /redaction-marks/:id ────▶ accept / reject / keep (with reason)
s13 Export      ── POST /drafts/:id/export ──────▶ burn-in redaction → HTML → documents renderers
                ── POST /requests/:id/actions/mark-sent ▶ status=sent, archive snapshot, reindex
s14/s15         ── POST /requests/:id/actions/{extend,request-clarification,register-clarification,leave-unprocessed}
```

Rules:
- AI calls are synchronous with a spinner (demo volumes are small). Each call to
  `runAiAgentObject` is wrapped in `try/catch`, covering agent policy errors, an unconfigured
  provider and timeouts. On failure the step **degrades**: the officer fills fields by hand and the
  draft starts from the template. This follows the pattern in
  `packages/core/src/modules/workflows/lib/ai-draft-runner.ts`.
- **Intake identity.** The create page generates the request UUID on the client before uploading,
  so the first file is stored with `recordId=<uuid>`. `POST /requests` accepts that `id`, and step 3
  (similar requests) runs after the request is saved. There is no draft status: files uploaded for a
  request that is never saved are released after 24 hours by a cleanup worker, or deleted by hand
  in the demo.
- OCR uses the attachments queue. The intake page polls the attachment until `content` is set,
  using the existing list API.
- **No cross-module ORM relations.** Attachments are linked by `entityId =
  'public_info_requests:public_info_request'` plus `recordId`. Users are referenced by
  `assignee_user_id` (FK id only).

### Status transitions

| From | Trigger | To |
|---|---|---|
| — | `request.create` | `new` |
| `new` | `routing.accept` | `new` (queries exist but are not sent yet) |
| `new`, `in_preparation` | `department_query.mark_sent` (first query sent) | `sent_to_departments` |
| `sent_to_departments`, `extended` | First department reply recorded, or first draft generated | `in_preparation` |
| `new` | First draft generated (e.g. reuse or not-held cases without routing) | `in_preparation` |
| any open | `request.extend` | `extended`. The next reply or draft moves it on as above; the calendar badge keeps "Kwerenda +n dni" via `extended_at`. |
| any open | `request.request_clarification` | `awaiting_clarification` |
| `awaiting_clarification` | `register_clarification` / `leave_unprocessed` | `in_preparation` / `left_unprocessed` |
| `in_preparation` | Draft set to `ready` | `prepared` |
| `prepared` | Draft edited back to `draft` | `in_preparation` |
| `prepared` | `request.mark_sent` | `sent` |

### Commands & Events

Mutations go through commands, using `runCrudCommandWrite` for CRUD and custom commands for
actions. Every command checks the optimistic lock (`enforceCommandOptimisticLock`) against the
request's `updated_at`.

| Command | Effect | Undo |
|---|---|---|
| `public_info_requests.request.create/update/delete` | CRUD | Standard CRUD undo |
| `public_info_requests.routing.accept` | Creates `DepartmentQuery` rows from the proposal | Deletes the created rows |
| `public_info_requests.department_query.mark_sent` | Sets `sent_at`; request status → `sent_to_departments` | Restores the previous values |
| `public_info_requests.request.extend` | Sets `current_due_date`, `extended_at`, reason; status → `extended` | Restores the previous due date and status |
| `public_info_requests.request.request_clarification` | Sets `paused_at`, `clarification_due_date`; status → `awaiting_clarification` | Restores |
| `public_info_requests.request.register_clarification` | Clears pause; new `current_due_date` (D3); status → `in_preparation` | Restores |
| `public_info_requests.request.leave_unprocessed` | Status → `left_unprocessed` (allowed only after `clarification_due_date`) | Restores |
| `public_info_requests.draft.generate` | New `ResponseDraft` version | Deletes the version |
| `public_info_requests.redaction_mark.decide` | Sets state `accepted`/`rejected`/`kept` (reason required)/`suggested` | Restores the previous state |
| `public_info_requests.department.create/update/delete`, `public_info_requests.settings.update` | CRUD via `runCrudCommandWrite` | Standard CRUD undo |
| `public_info_requests.department_query.record_reply` | Sets `reply_kind`, `received_at`, `reply_attachment_ids`, `point_positions`; may move the status | Restores previous values and status |
| `public_info_requests.request.record_similar_choice` | Writes `similar_choice` | Restores previous value |
| `public_info_requests.draft.update` | Officer edits; regrounds; invalidates marks of changed paragraphs | Restores the previous paragraphs and marks |
| `public_info_requests.draft.regenerate_paragraph` | Replaces one paragraph; invalidates its marks | Restores the paragraph and marks |
| `public_info_requests.redaction_mark.detect` | Creates `suggested` marks; keeps decided marks whose `source_hash` still matches | Deletes the created marks |
| `public_info_requests.request.mark_sent` | Sets `responded_at`, channel; status → `sent` (or the terminal status implied by the letter type); writes the archive snapshot; reindexes | Restores status, clears `responded_at`, removes the archive snapshot |

Events (`events.ts`, `createModuleEvents`):
- `public_info_requests.request.created`
- `public_info_requests.request.status_changed` (payload: `id`, `from`, `to`)
- `public_info_requests.request.responded`

A subscriber on `status_changed` and `responded` reindexes the request for search. Events are not
broadcast to clients, which keeps the demo simple.

**Guards.**
- Every custom write route calls `runMutationGuards` before its command, as `makeCrudRoute` does
  for CRUD.
- Every non-`CrudForm` write in the UI goes through
  `useGuardedMutation(...).runMutation(...)` with `retryLastMutation` in the injection context:
  draft editor saves, action dialogs, mark decisions, routing accept, mark-sent.
- Conflicts are surfaced with `surfaceRecordConflict`.

## Data Models

All entities carry `id` (uuid), `tenant_id`, `organization_id`, `created_at`, `updated_at` and
`deleted_at`. Class names are singular and table names plural. Every list and detail API returns
`updatedAt` so `CrudForm` gets optimistic locking.

### PublicInfoRequest (`public_info_requests`)

| Column | Type | Notes |
|---|---|---|
| `case_number` | text | `BKS.IV.1431.<seq>.<year>`. Unique per org (partial index where `deleted_at is null`). |
| `case_seq`, `case_year` | int | Parsed from `case_number`. Used for the suggestion (D5) and the year filter. |
| `channel` | enum `email \| epuap \| post \| in_person \| phone` | Required. |
| `received_at` | date | Required. Drives every deadline. |
| `letter_date` | date null | Date printed on the request letter. |
| `requester_name` | text | **Encrypted.** |
| `requester_kind` | enum `person \| organisation \| media \| councillor` | |
| `requester_address` | text null | **Encrypted.** |
| `requester_contact` | text null | **Encrypted.** Email or phone. |
| `delivery_form` | enum `email \| post \| epuap \| inspection` | Art. 14: the form the requester asked for. |
| `subject_summary` | text | Short description for the calendar. Must not contain personal data (LLM is instructed accordingly; officer edits). |
| `body_text` | text | **Encrypted.** Full request text after OCR and officer corrections. |
| `status` | enum `new \| sent_to_departments \| extended \| awaiting_clarification \| in_preparation \| prepared \| sent \| left_unprocessed` | D9 status model. A `not_held_referral` or `refusal_decision_draft` letter still ends in `sent`; `final_letter_type` records which kind. |
| `assignee_user_id` | uuid null | Officer. Initials are computed in the API from the auth user. |
| `statutory_due_date` | date | Computed at creation (D1). |
| `current_due_date` | date | The deadline in force. Equals `statutory_due_date` until extended or clarified. |
| `max_extension_date` | date | Receipt + 2 months, shifted (D2). |
| `extended_at`, `extension_reason` | timestamptz null, text null | |
| `paused_at`, `clarification_delivered_at`, `clarification_due_date` | timestamptz/date null | D3. |
| `responded_at`, `response_channel` | date null, text null | Set by `mark_sent` (D9). |
| `final_letter_type` | enum (D6) null | |
| `similar_choice` | jsonb null | `{ matchedRequestId, similarity, action: 'reuse_structure' \| 'start_from_answer' \| 'bip_referral' \| 'none' }`. |
| `archive_text` | text null | **Anonymised** snapshot of request and answer, written when the case is closed or imported. The only text that reaches the similarity index besides `subject_summary` and the points. |
| `source` | enum `manual \| import` | Imported archive cases are read-only in the UI. |

Indexes: `(organization_id, case_year, current_due_date)` for the calendar and
`(organization_id, status)`.

### PublicInfoRequestPoint (`public_info_request_points`)

One numbered question ("Ad n") of a request.
- Columns: `request_id` (FK, same module), `position` (int), `text` (text). Unique on
  `(request_id, position)`.
- Points are edited inside the request form as a list and saved in the same command as the request
  (graph save, so there is no partial state).

### PublicInfoDepartment (`public_info_departments`)

The organisational units that routing proposes.
- `name`, `symbol`, `kind` (`department | office | municipal_unit | external`), `competence_scope`
  (text, from the org regulation), `keywords` (jsonb string[]), `contact_hint` (text, e.g.
  mailbox, shown for copying only), `is_active`.
- `municipal_unit` and `external` mean a separate obligated entity. They trigger the "not held /
  forward" flag in routing (samples 15 and 17).

### PublicInfoDepartmentQuery (`public_info_department_queries`)

- `request_id`, `department_id` (both FKs within the module).
- `point_positions` (jsonb int[]), `scope_text`, `internal_due_date`, `sent_at`, `received_at`.
- `reply_kind`: `answered | partial | not_held | protected | null`.
- `ai_confidence` (numeric null) and `ai_sources` (jsonb: `[{ kind: 'department_scope' | 'archive'
  | 'law', ref, label }]`).
- Reply files are attachments on the **request** record, and this row references them by
  `reply_attachment_ids` (jsonb uuid[]). That keeps the single-attachment-entity convention.

### PublicInfoResponseDraft (`public_info_response_drafts`)

- `request_id`, `version` (int, unique per request), `letter_type` (D6).
- `status`: `draft | ready | exported`. Ready requires no unresolved `gap` or `unsupported` flags,
  or an explicit confirmation of each.
- `paragraphs` (jsonb): `[{ id, kind: 'intro' | 'point' | 'closing' | 'note', pointPosition?, text,
  contentHash, sources: [{ attachmentId, page?, quote }], flags: ('unsupported' | 'number_mismatch' |
  'gap' | 'assistant_only')[], confirmedBy? }]`. `text` is plain text with blank-line paragraph
  breaks. HTML is produced only at render and export time, from the template plus escaped text.
  `contentHash` is a sha256 of `text`.
- `attachment_list` (jsonb string[]), `generated_by` (`ai | template`), `exported_at`.

### PublicInfoRedactionMark (`public_info_redaction_marks`)

- `request_id` and `target_kind`: `draft` (with `draft_id`, `paragraph_id`) or `attachment` (with
  `attachment_id`).
- `start`, `end`: int offsets into the paragraph's plain `text`, or into the attachment's
  extracted `content`.
- `source_hash`: the `contentHash` of the paragraph (or a sha256 of the attachment content) that
  the offsets refer to.
- `text_excerpt` (**encrypted**): the exact covered text, used for display and for the export
  check.
- `category`: a key from the UMB list, e.g. `private_person_name`, `pesel`, `id_document`,
  `private_nip`, `birth_data`, `private_address`, `private_phone`, `private_email`,
  `bank_account`, `signature`, `health`, `property_register_number`, `land_parcel`,
  `vehicle_registration`, `business_secret`, `other`.
- `detector` (`rule | ai | manual`) and `state` (`suggested | accepted | kept | rejected`).
- `reason` (required for `kept`), `decided_by_user_id`, `decided_at`.

### PublicInfoSettings (`public_info_settings`, one row per org)

- `deadline_mode` (`calendar | working`, default `calendar`).
- `internal_due_offset_working_days` (int, default 5).
- `clarification_days` (int, default 7).
- `similarity_threshold` (numeric, default 0.55) and `similarity_window_months` (int, default 24).
- `extra_holidays` (jsonb `YYYY-MM-DD[]`).
- `public_officials` (jsonb string[]): names that hold a public function and are never suggested
  for redaction.
- `letterhead` (jsonb: office name, address, footer email).

### PublicInfoRequestEvent (`public_info_request_events`)

The case timeline (s9 "Historia").
- `request_id`, `kind` (e.g. `registered`, `ai_suggestion`, `suggestion_accepted`,
  `suggestion_rejected`, `status_changed`, `file_uploaded`, `exported`, `marked_sent`),
  `actor_user_id` (null for system), `payload` (jsonb, **no personal data**), `occurred_at`.
- Written by the commands. This is the explicit audit that answers "what did the assistant
  suggest and what did the officer do".

### Encryption (`encryption.ts`)

`defaultEncryptionMaps` covers:
- `public_info_request`: `requester_name`, `requester_address`, `requester_contact`, `body_text`;
- `public_info_request_point`: `text`;
- `public_info_redaction_mark`: `text_excerpt`.

**Demo trade-off:** draft `paragraphs` (jsonb) are stored in clear. They may contain the
requester's address block and unredacted reply facts until export. Encrypting them, or moving the
paragraph text to an encrypted text column, is a production follow-up (see "Deferred for the
demo").

All reads of these go through `findWithDecryption` / `findOneWithDecryption`. `archive_text` is
stored anonymised and in clear, so it can be indexed.

## Deadline Engine (`lib/deadlines.ts`)

Pure, synchronous and unit-tested. No I/O, so the same code runs on the server and in the intake
form for the live preview.

```ts
type DeadlineMode = 'calendar' | 'working'
polishPublicHolidays(year: number, extra?: string[]): Set<string>
isNonWorkingDay(date: Date, holidays: Set<string>): boolean
statutoryDueDate(receivedAt: Date, mode: DeadlineMode, holidays): { due: Date; shiftedFrom?: Date; explanation: string }
maxExtensionDate(receivedAt: Date, holidays): { due: Date; shiftedFrom?: Date }
addWorkingDays(date: Date, n: number, holidays): Date
internalDueDate(currentDue: Date, offsetWorkingDays: number, holidays): Date
clarificationDueDate(deliveredAt: Date, days: number, holidays): Date   // delivered + days, shifted (art. 57 §4)
dueAfterClarification(replyAt: Date, mode, holidays): Date              // same rule as statutoryDueDate
daysRemaining(today: Date, due: Date): number
deadlineTone(today, request): 'overdue' | 'today' | 'tomorrow' | 'paused' | 'normal' | 'done'
```

- **Polish public holidays.** Fixed: 01-01, 01-06, 05-01, 05-03, 08-15, 11-01, 11-11, 12-24
  (from 2025), 12-25, 12-26. Moveable: Easter Sunday, Easter Monday, Pentecost (Easter + 49) and
  Corpus Christi (Easter + 60). The two Sundays don't change any calculation but are listed so the
  holiday list in settings is complete. Easter is
  computed with the anonymous Gregorian algorithm. Saturdays count as non-working days for the
  KPA art. 57 §4 shift.
- **Calendar mode:** `due = received + 14`, then shift forward while the day is non-working.
- **Working mode:** add 14 working days.
- **Extension:** `received + 2 calendar months` (day-of-month clamping per KPA art. 57 §3), then
  shift.
- **`explanation`** is a Polish sentence for the UI, e.g. "07.11 + 14 dni = 21.11 (sobota) →
  23.11".
- **Paused requests** (`awaiting_clarification`) report tone `paused` and the
  `clarification_due_date` instead of a day count.

Unit tests cover 2026–2027:
- weekend shift: 07.11.2026 → 23.11.2026;
- holiday chain: 10.12.2026 → 28.12.2026;
- extension landing on a Saturday: 23.11.2026 → 25.01.2027;
- Easter Monday 2027 (29.03.2027);
- working-day mode: 23.11.2026 → 11.12.2026.

## AI Agents (`ai-agents.ts`)

All four agents:
- use `executionMode: 'object'` with `output: { schemaName, schema }`, where the Zod schemas live
  in `data/ai-schemas.ts`;
- are `readOnly: true`;
- set `requiredFeatures: ['public_info_requests.manage']`;
- take their model from env through the standard provider resolution (see Configuration).

They are called with `runAiAgentObject` from module services. Prompts are in Polish and instruct
the model to answer only from the provided material.

| Agent id | Input | Output (schema) | Used in |
|---|---|---|---|
| `public_info_requests.intake_extractor` | Extracted or OCR text (the attachment itself is also passed via `attachmentIds`, `acceptedMediaTypes: ['pdf','image']`) | `{ requesterName, requesterKind, requesterAddress?, requesterContact?, deliveryForm, letterDate?, subjectSummary, points: string[] }` | s5 |
| `public_info_requests.router` | Request points; active departments (`name`, `kind`, `competence_scope`, `keywords`); top 5 similar archive cases with their departments and `final_letter_type` | `{ proposals: [{ departmentId, pointPositions, scopeText, confidence, sources[] }], flags: [{ kind: 'separate_entity' \| 'published_in_bip' \| 'personal_data' \| 'processed_information', message, departmentId? }] }` | s7 |
| `public_info_requests.drafter` | Letter type; points; department reply texts with attachment ids and page markers; letterhead; for `start_from_answer`, the matched archive answer | `{ paragraphs: [{ kind, pointPosition?, text, sources: [{ attachmentId, page?, quote }] }], attachmentList: string[] }` | s11 |
| `public_info_requests.pii_detector` | Paragraph or attachment text (chunked to ~6k chars), UMB categories, `public_officials` list | `{ spans: [{ start, end, category, confidence }] }` | s12 |

**Validation (server side).**
- Router `departmentId` values not in the active list are dropped.
- Drafter `attachmentId` values not on the case are stripped, and the paragraph is flagged
  `unsupported`.
- PII spans with invalid offsets are dropped.

**Degradation.**
- If the AI module is not configured or the call throws, intake falls back to empty fields and
  routing falls back to keyword matching on `departments.keywords`.
- Drafting falls back to the letter template with one empty paragraph per point. PII detection
  falls back to rules only.
- The UI shows "Asystent niedostępny — tryb ręczny".

## Grounding Check (`lib/grounding.ts`)

This deterministic post-check of drafter output answers the brief's "exclude errors and AI
hallucinations":
1. **Point coverage.** Every point must have a paragraph whose `pointPosition` matches, or the
   point is flagged `gap`.
2. **Sources.** A paragraph with no valid source gets `unsupported`. Template boilerplate
   (intro and closing) is exempt.
3. **Facts.** Numbers, amounts (`1 132 500,00 zł`), dates and case or contract numbers are
   extracted from the paragraph text and normalised (spaces, comma decimals, date formats). Each
   must occur in at least one cited source's text, or the paragraph gets `number_mismatch` and the
   offending token is highlighted.
4. **Assistant-only content.** Paragraphs the model marks as its own suggestion (e.g. a referral
   note derived from a routing flag) get `assistant_only` and need officer confirmation.

## PII Detection (`lib/pii/`)

1. **Rules** (`rules.ts`), each with a validator:
   - PESEL: 11 digits with checksum;
   - NIP: 10 digits with checksum, `private_nip` only when not prefixed by a company name;
   - ID card: `[A-Z]{3}\d{6}`;
   - Polish bank account: 26 digits or IBAN `PL`;
   - phone: `(\+48)?[ -]?\d{3}[ -]?\d{3}[ -]?\d{3}`, excluding the configured office numbers such
     as `52 58 58 …`;
   - email: excluding the `@um.bydgoszcz.pl` domain;
   - land-register number: `[A-Z]{2}\d[A-Z]/\d{8}/\d`;
   - vehicle registration: `C[A-Z]{1,2} ?[0-9A-Z]{4,5}` (Kujawsko-Pomorskie prefixes);
   - postal address after "ul." / "zam." / "zamieszkały".
2. **AI detector** for names of private persons, signatures and sensitive categories (health,
   social benefits, convictions, beliefs, …).
3. **Merge.** Overlapping spans are unioned. Rule hits win on category. Exemptions are applied:
   - `public_officials` names;
   - names followed by a public-function marker ("insp.", "dyrektor", "kierownik wydziału",
     "Prezydent");
   - the BKS letterhead block.
4. **Draft vs archive.** For the draft letter the requester's own name and address in the address
   block are **not** suggested, since the letter is addressed to them. For the archive snapshot
   (`archive_text`) they are always removed.

**Edits invalidate marks.** When `PUT /drafts/:id` or a paragraph regenerate changes a
paragraph's `text`, that paragraph's marks are deleted and detection runs again for that
paragraph. New suggestions start as `suggested`. If a removed accepted mark's `text_excerpt` still
occurs in the new text, the new mark is pre-set to `accepted`, so earlier decisions are not lost
silently.

**Export.**
- Each `accepted` span is replaced with `[dane zanonimizowane]`, configurable, or with a run of
  `█`. The original text never reaches the exported file.
- Before replacing, export checks that each mark's `source_hash` matches the current content and
  that the slice equals the decrypted `text_excerpt`. Otherwise it returns 409 `pii_marks_stale`.
- Export is also blocked (409 `pii_undecided`) while any mark is still `suggested`.

## Similar-Request Search (`search.ts`)

- **Entity:** `public_info_requests:public_info_request`. Strategies: `vector`, plus `tokens` (the
  database-backed strategy, no external service) as the fallback.
- **What gets indexed:** only requests with `status = sent` or `source = import`, i.e. cases with
  an `archive_text`. Open requests are never indexed. They are only used as query text, so
  unredacted points and summaries of live cases never enter the index.
- **`buildSource.text`:** `archive_text` only. It already contains an anonymised copy of the
  subject, the points and the answer, produced at `mark_sent` or import. `fieldPolicy.excluded`
  lists every requester column, `body_text`, `subject_summary` and the points.
- **Query** (`GET /requests/:id/similar`): build the query text from the new request's subject and
  points, then call `searchService.search(text, { tenantId, organizationId, entityTypes: [entityId],
  strategies: ['vector'], limit: 10 })`.
  - Filter out the request itself and anything older than `similarity_window_months`.
  - Keep hits above `similarity_threshold`, enrich them with departments and `final_letter_type`,
    and return the top 5.
- **Per-point coverage:** each point's text is searched separately (limit 3). A point counts as
  covered by a match if that match is in its results.
- **Fallback:** if the vector strategy is not configured, use the `tokens` strategy and report
  `similarity` as `null`. The UI then shows "dopasowanie tekstowe" instead of a percentage. CI uses
  `tokens`, because Meilisearch (`fulltext`) and embeddings are not provisioned there.

## API Contracts

All routes live under `/api/public_info_requests/…`, export `openApi`, validate with Zod
(`data/validators.ts`), and are scoped by tenant and organization. Page size is ≤ 100.

### CRUD (`makeCrudRoute`)

| Route | Entity | Feature | Notes |
|---|---|---|---|
| `GET/POST/PUT/DELETE /requests` | PublicInfoRequest (+ points graph) | view / manage | List query: `year`, `status[]`, `assigneeUserId`, `mine`, `dueWithinDays`, `q`, `hideClosed` (default true), `sort=currentDueDate:asc`. List items add `daysRemaining`, `deadlineTone`, `assigneeInitials`, `shiftedFrom`. POST computes `case_seq`, `case_year` and the deadlines server-side; the client never sends due dates. |
| `GET/POST/PUT/DELETE /departments` | PublicInfoDepartment | view / knowledge.manage | |
| `GET/PUT /department-queries` | PublicInfoDepartmentQuery | manage | PUT sets `reply_kind`, `received_at`, `reply_attachment_ids`, `point_positions`. |
| `GET/PUT /redaction-marks` | PublicInfoRedactionMark | manage | PUT goes through `redaction_mark.decide`. |
| `GET/PUT /settings` | PublicInfoSettings | knowledge.manage | Single row, created on first read. |

### Custom routes

| Method and path | Request | Response | Notes |
|---|---|---|---|
| `GET /calendar` | `from`, `to` (ISO dates) | `{ items: [{ id, caseNumber, subjectSummary, currentDueDate, deadlineTone, assigneeInitials }] }` | Feeds `ScheduleView` items. |
| `GET /next-case-number` | `year` | `{ caseNumber, seq }` | D5 |
| `POST /deadline-preview` | `{ receivedAt }` | `{ statutoryDueDate, shiftedFrom?, explanation, maxExtensionDate, internalDueDate }` | Also usable without saving. |
| `POST /intake/extract` | `{ attachmentId }` | `{ suggestions: IntakeExtractorOutput, text, ocrPending: boolean }` | `ocrPending: true` means poll again. |
| `GET /requests/:id/similar` | — | `{ matches: [{ requestId, caseNumber, receivedAt, subjectSummary, similarity, coveredPoints[], departments[], finalLetterType, answerExcerpt }], searched: number, mode: 'vector' \| 'tokens' }` | |
| `GET /archive/search` | `text`, `limit?` (≤ 50) | same match shape as `/similar`, without `coveredPoints` | Free-text archive search (s18); shares `lib/similar.ts`. |
| `POST /requests/:id/similar-choice` | `{ matchedRequestId?, action }` | `{ ok }` | Writes `similar_choice` and an event. |
| `POST /requests/:id/routing/suggest` | — | `RouterOutput` enriched with department names | Not persisted until accepted. |
| `POST /requests/:id/routing/accept` | `{ queries: [{ departmentId, pointPositions, scopeText, internalDueDate }] }` | `{ queries }` | Command `routing.accept`. |
| `GET /requests/:id/routing/notes` | — | `{ notes: [{ departmentId, subject, bodyText }] }` | Note text from a template. |
| `GET /requests/:id/routing/notes/:departmentId/docx` | — | DOCX file stream | Rendered with `renderDocxWithCapacity`. |
| `POST /department-queries/mark-sent` | `{ ids[], sentAt }` | `{ ok }` | |
| `POST /requests/:id/drafts` | `{ letterType, baseOn?: 'department_replies' \| 'archive_answer' }` | `PublicInfoResponseDraft` | Runs drafter → grounding. |
| `PUT /drafts/:id` | `{ paragraphs, attachmentList, status? }` | draft | Officer edits. Re-runs grounding on save. Optimistic lock. |
| `POST /drafts/:id/paragraphs/:pid/regenerate` | — | paragraph | |
| `POST /drafts/:id/pii/detect` | `{ includeAttachments: boolean }` | `{ marks: PublicInfoRedactionMark[] }` | Idempotent: re-detect keeps decided marks. |
| `POST /drafts/:id/export` | `{ format: 'docx' \| 'pdf' \| 'txt', target: 'letter' \| { attachmentId } }` | File stream (one file per call). The UI calls it once per listed file. | 409 `pii_undecided`, 409 `draft_not_ready`. PDF returns 501 when no Chromium executable is found. |
| `POST /requests/:id/actions/mark-sent` | `{ respondedAt, channel, addToArchive: boolean }` | request | Writes `archive_text` (anonymised) and reindexes. |
| `POST /requests/:id/actions/extend` | `{ newDueDate, reason, notice: { draftId? } }` | request | 422 if > `max_extension_date`. 422 if the request is already overdue (note in the error, D2). |
| `POST /requests/:id/actions/request-clarification` | `{ sentAt, deliveredAt? }` | request | Without `deliveredAt` the case is paused with an unknown reply window, and the detail page shows "Uzupełnij datę doręczenia". |
| `POST /requests/:id/actions/record-clarification-delivery` | `{ deliveredAt }` | request | Sets `clarification_delivered_at` and `clarification_due_date = clarificationDueDate(deliveredAt)`. |
| `POST /requests/:id/actions/register-clarification` | `{ receivedAt, overrideDueDate? }` | request | |
| `POST /requests/:id/actions/leave-unprocessed` | — | request | 422 before `clarification_due_date + 1`. |

Attachment upload and listing use the core `POST/GET /api/attachments` with
`entityId=public_info_requests:public_info_request` and partition `publicInfoRequests`. The client
never calls AI providers directly.

## Access Control (`acl.ts`) and Setup (`setup.ts`)

| Feature | Grants |
|---|---|
| `public_info_requests.view` | Calendar, case detail, archive search |
| `public_info_requests.manage` | Everything an officer does (s4–s15) |
| `public_info_requests.approve` | Supervisor: reassign, confirm refusal drafts (demo: only reassign) |
| `public_info_requests.knowledge.manage` | Departments, settings, archive import |

- **`setup.ts`:**
  - `defaultRoleFeatures` grants all four features to `admin` and `superadmin`.
  - `seedDefaults` creates the settings row and the department list (see Demo Data). It also
    idempotently creates the `publicInfoRequests` attachment partition (private, `requiresOcr:
    true`, `indexDocumentSections: false`) through the attachments partition helpers, because
    only the default partitions are seeded by the attachments module.
  - `seedExamples` loads the synthetic demo cases (see Demo Data) when `yarn initialize` runs with examples
    enabled.
- **Page metadata** uses `requireFeatures`. Users without the feature see the standard no-access
  page (s3).
- **Wildcard grants** (`public_info_requests.*`) are honoured through the shared RBAC matcher.

## UI/UX

Backend pages live in `backend/public_info_requests/`. Every page uses `Page`/`PageHeader`,
`DataTable` and `CrudForm`, `LoadingMessage`/`ErrorMessage`, DS status tokens and lucide icons.
Dialogs support `Ctrl/Cmd+Enter` to submit and `Escape` to cancel. Strings come from
`i18n/pl.json` and `i18n/en.json`.

| Route | Prototype | Composition |
|---|---|---|
| `/backend/public_info_requests` | s1, s2, s3 | KPI row (overdue, today, tomorrow, open). `DataTable` with columns Lp., Nr sprawy, Wnioskodawca, Przedmiot, Wpływ, Termin, Pozostało, Status, Prow. and optional Data odp. Row class by `deadlineTone`: `overdue`/`today` → `status-error` bg, `tomorrow` → `status-warning`, `paused` → `status-info`. Year filter, toggle to `ScheduleView` month mode, empty and no-results states. |
| `/backend/public_info_requests/create` | s4, s5, s6 | Three-step page: (1) channel picker + `FileUploadArea` (uploaded against the client-generated request id) with original preview and extracted text side by side; (2) `CrudForm` with AI-suggested fields marked "sugestia", editable points list, live `deadline-preview`, suggested case number; (3) similar matches with side-by-side comparison and choice. |
| `/backend/public_info_requests/[id]` | s9, s14, s15, s16 | Header with status badge and actions (Przedłuż, Doprecyzowanie, Przygotuj projekt). Status track, deadline countdown, department queries table (upload reply drawer = s10), points with coverage badges, `AttachmentsSection`, timeline from `PublicInfoRequestEvent`. Extension and clarification dialogs. |
| `/backend/public_info_requests/[id]/routing` | s7, s8 | Proposal cards (checkbox, editable scope, sources, confidence), legal flags, internal due date. Notes dialog with copy, DOCX and mark-as-sent. |
| `/backend/public_info_requests/[id]/draft` | s11, s12, s13 | Letter editor (paragraph list on the letterhead, source chips, flag highlighting, per-paragraph regenerate/confirm/delete). Letter type select. Anonymisation tab with grey/black/kept marks and category panel. Export dialog with record-sending fields. |
| `/backend/public_info_requests/archive` | s18 | Search box + results from `GET /archive/search`. |
| `/backend/public_info_requests/departments` | s20 | `DataTable` + `CrudForm` drawer. |
| `/backend/public_info_requests/settings` | s19 (env info), s21 | Settings `CrudForm`, holiday list (read-only, generated), archive import status, AI provider status (read from existing AI settings, not editable here). |

- **Sidebar:** group "Wnioski UDIP" with Kalendarz, Zarejestruj wniosek and Archiwum, plus
  Departments and Settings under the module's settings section.
- **Top-bar indicator:** a badge "Asystent lokalny · offline" shows when the configured provider is
  `ollama`/`lm-studio` or a private base URL. Otherwise it shows "Asystent: <provider>".
- **Frontend architecture.** List and detail pages are client components (`"use client"`), as is
  the standard for interactive DataTable/CrudForm pages. No new global providers. The heavy
  pieces (letter editor, PDF preview) are lazy-loaded with `next/dynamic` on the draft page only.

## Internationalization

- Keys: `public_info_requests.*` in `i18n/pl.json` (primary) and `i18n/en.json`.
- Letter templates are Polish-only content in `lib/templates/*.ts`, in the same family as legal
  copy, and are listed in `i18n/.hardcoded-allowlist.json`.
- Status labels:
  - `new` → "Nowy — brak działań"
  - `sent_to_departments` → "Wysłano do wydziałów"
  - `extended` → "Kwerenda (+n dni)"
  - `awaiting_clarification` → "Oczekuje na doprecyzowanie"
  - `in_preparation` → "Odpowiedź w przygotowaniu"
  - `prepared` → "Odpowiedź przygotowana"
  - `sent` → "Odpowiedź wysłana"
  - `left_unprocessed` → "Pozostawiony bez rozpoznania"

## Letter Templates (`lib/templates/`)

HTML fragments rendered on the BKS letterhead (office name, address and footer from settings).
Wording follows the sample letters:

| Letter type | Based on sample | Fixed parts |
|---|---|---|
| `answer` | 307/2025, 18/2026, 293/2025 | "W odpowiedzi na wystosowany przez Pana/Panią/Państwa wniosek … na podstawie materiału przygotowanego przez komórkę merytoryczną, tj. {departments} …", "Ad n" paragraphs, attachment list, closing "Łączę wyrazy szacunku" |
| `extension_notice` | Kwerenda 543/2025 | Reason + "w terminie wskazanym w art. 13 ust. 2 … orientacyjny termin udzielenia odpowiedzi: {date}" |
| `clarification_request` | Doprecyzowanie 509/2026 | Title "WEZWANIE DO DOPRECYZOWANIA ZAKRESU OTRZYMANEGO WNIOSKU", quoted request scope, department's question, 7-day notice |
| `not_held_referral` | 15/2026, 17/2026 | "Urząd Miasta Bydgoszczy nie jest dysponentem wnioskowanych danych … art. 4 ust. 3 …", target entity contact block (from `PublicInfoDepartment` of kind `external`/`municipal_unit`) |
| `bip_referral` | — (Zarządzenie §8 ust. 1) | BIP URL |
| `refusal_decision_draft` | — | Decision skeleton, marked "PROJEKT — wymaga podpisu osoby upoważnionej" (§12) |
| `left_unprocessed` | — | Notice after missed clarification |
| `no_statistics` (variant of `answer`) | 16/2026 | "Urząd Miasta Bydgoszczy nie prowadzi statystyk, które umożliwiłyby udzielenie odpowiedzi" |

The salutation (Pan/Pani/Państwo) comes from `requester_kind` plus an AI-suggested gender form,
and the officer can edit it.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| AI provider and model | from existing `ai-assistant` settings/env | Demo: any configured provider. Offline: `OLLAMA_BASE_URL` + a Polish-capable model (proposal: Bielik 11B via Ollama). |
| `PUBLIC_INFO_AI_MODEL` | unset | Optional `modelOverride` for the four agents. |
| OCR | `OM_DEFAULT_ATTACHMENT_OCR_ENABLED`, `OCR_MODEL`, `OPENAI_API_KEY` | Demo uses the built-in OCR. Offline path: R1. |
| Search embeddings | existing search env | Offline: `ollama` embedding provider (proposal: `bge-m3` or `multilingual-e5`). |
| `DOCUMENTS_PDF_CHROMIUM_PATH` / `PUPPETEER_EXECUTABLE_PATH` | auto-detected | PDF export through `@open-mercato/documents/modules/documents/lib/pdfRenderer`, with the same Chromium lookup the documents export route uses (env, then common install paths). If no browser is found, only DOCX/TXT are offered. |

## Demo Data (`setup.ts` seed + `cli.ts`)

1. **Departments (`seedDefaults`).** Units named in the samples:
   - Wydział Edukacji i Sportu, Wydział Spraw Obywatelskich, Wydział Gospodarki Odpadami,
     Wydział Zieleni i Gospodarki Komunalnej, Wydział Administracji Budowlanej, Wydział Inwestycji
     Miasta, Biuro Komunikacji Społecznej, Biuro Rady Miasta;
   - municipal units: Schronisko dla Zwierząt w Bydgoszczy, Zarząd Dróg Miejskich i Komunikacji
     Publicznej;
   - external: Kujawsko-Pomorski Wojewódzki Konserwator Zabytków (Delegatura w Bydgoszczy).

   Each gets a short competence scope and keywords. The full list is imported later from BIP (Q5).
2. **Archive import CLI:** `yarn mercato public_info_requests import-archive --dir <path>
   [--org <id>]`.
   - Reads files named like the UMB package (`Wniosek - <case>.{docx,pdf}`, `Odpowiedź - <case>…`,
     `Kwerenda - …`, `Doprecyzowanie - …`) and pairs them by case number.
   - Extracts text (OCR is queued for scans), runs intake extraction and PII rules, then stores
     each pair as a `source=import` request with status `sent`, `archive_text` (anonymised) and
     `final_letter_type` inferred by keyword ("nie jest dysponentem" → `not_held_referral`).
   - Indexes everything for search.
   - **Auth context.** AI calls need an `authContext`, so the CLI requires `--user <id>` (a user
     holding `public_info_requests.manage`) and builds the context from that user's tenant,
     organization and features. Without `--user`, AI steps are skipped and only rules are used.
   - **OCR.** For scanned files the CLI waits for the queued OCR job (polling the attachment's
     `content`, 120 s timeout per file). On timeout it imports the pair without that text and
     prints a warning; `--retry-missing` re-processes such pairs later.
   - The UMB sample files stay on the operator's machine and are **never committed**.
3. **Calendar demo CLI:** `yarn mercato public_info_requests seed-demo-calendar [--today
   YYYY-MM-DD]`.
   - Creates 10 open requests with received dates re-based relative to "today", so the calendar
     shows one overdue, one due today, one due tomorrow, one paused, one extended, and the rest
     spread over the next two weeks.
   - Subjects are taken from the sample topics, with fictional requester names.
4. **Synthetic examples (`seedExamples`).** The same 10 calendar requests plus 3 synthetic archive
   cases (the prototype's tree-felling, green-maintenance contract and pupil-count cases), so the
   demo works without the UMB files.

### Jury walkthrough (acceptance scenario)

This mirrors challenge §6:
1. Upload `Wniosek - BKS.IV.1431.599.2026.docx`. Intake fills the fields and the system finds
   **307/2025** as the top match (pupil counts). Choose "use structure", route to Wydział
   Edukacji i Sportu.
2. Upload a department reply (any DOCX with figures). The draft cites it; editing a number in the
   draft flags `number_mismatch`.
3. Upload a reply containing a PESEL, a private phone number and a person's name (like 590/2026).
   The marks are suggested grey; accept them (black) and export DOCX. The values are absent from
   the file.
4. Use the calendar: 10 requests oldest→newest, today and tomorrow highlighted, statuses and
   initials visible, year filter works.
5. Upload `Wniosek - BKS.IV.1431.17.2026.docx`. Routing flags ZDMiKP as a separate entity, and
   the `not_held_referral` letter matches the sample answer.
6. Upload the scanned `Wniosek - BKS.IV.1431.16.2026.pdf`. OCR runs, then intake extraction.

## Migration & Compatibility

- New module with new tables only: one migration generated by `yarn db:generate`, plus the
  module's `.snapshot-open-mercato.json`.
- No changes to existing contracts. New ACL features, event IDs and an attachment partition code
  are additive.
- The module is enabled in `apps/mercato/src/modules.ts`. It depends on `attachments`, `search`,
  `ai_assistant` and `documents`, which are already enabled in the app. `ai_assistant` and
  `documents` are used soft-optionally: errors from `runAiAgentObject` and the renderers are caught
  and the feature degrades (manual mode, or TXT-only export), so the module still works without
  them.

## Implementation Plan

Each phase leaves a runnable app. Integration tests for each phase ship in the same phase.

**Demo cut line.** Phases 1–6 are **must-have**: together they cover every step of the jury
walkthrough. Phase 7 (extension and clarification) and the routing-note DOCX are **stretch**, the
first things to drop if time runs short. The calendar already displays extended and paused cases
from seed data.

### Phase 1: Register and calendar (US-A1, A2, B1 manual, B2, I3)
1. Scaffold the module: `index.ts`, `acl.ts`, `setup.ts`, `events.ts`, `encryption.ts`,
   `data/entities.ts` (request, point, department, settings, event), `data/validators.ts`. Run
   `yarn db:generate` and `yarn generate`.
2. `lib/deadlines.ts` with unit tests (cases in §Deadline Engine).
3. CRUD routes `/requests` (with points graph), `/departments`, `/settings`, `/next-case-number`,
   `/deadline-preview`, `/calendar`. Server-side deadline computation.
4. Calendar page (DataTable + `ScheduleView` toggle, highlighting, filters, empty states).
5. Create page step 2 (manual form) and the detail page skeleton with the timeline.
6. Seed departments, settings and `seed-demo-calendar`.
7. Integration tests: create request → deadline correct (weekend shift); list sorted by
   `currentDueDate` with correct tones; duplicate case number → 422 with a field error on `caseNumber`; no-access user gets 403.

### Phase 2: Intake with OCR and extraction (US-B1, B2, B3)
1. Attachment partition `publicInfoRequests` (`requiresOcr: true`). Upload in create step 1 with
   original/text preview and OCR polling.
2. `intake_extractor` agent and `POST /intake/extract` with degradation.
3. "Sugestia" markers in the form and the same-requester warning.
4. Integration tests: DOCX upload → text extracted and suggestions returned (AI mocked via DI
   override); AI unavailable → manual mode.

### Phase 3: Archive and similar requests (US-C1, C2, I1)
1. `lib/pii/rules.ts` with unit tests (PESEL/NIP checksum, phone and email exclusions,
   addresses). `lib/archive.ts` builds `archive_text`: request + answer text with rule hits
   removed and the requester block dropped.
2. `search.ts` (closed and imported cases only), reindex subscriber, and the `import-archive` CLI.
3. `GET /requests/:id/similar`, `GET /archive/search`, `POST /similar-choice`, create step 3 UI,
   archive page.
4. Integration tests: an imported 307/2025-like case is found for a 599/2026-like query
   (`tokens` strategy in CI); an open request is not indexed; a requester name never appears in
   the index source.

### Phase 4: Routing and department replies (US-D1, D2, E1)
1. `PublicInfoDepartmentQuery` entity, `router` agent, `routing/suggest`, `routing/accept`,
   notes + DOCX, `mark-sent`.
2. Routing page and notes dialog. Reply drawer on the detail page (attachment, department,
   points, reply kind).
3. Integration tests: accept proposal → queries created, status still `new`; mark notes sent →
   `sent_to_departments`; reply upload sets `received_at` and moves to `in_preparation`; a
   `not_held` reply offers the `not_held_referral` letter type.

### Phase 5: Draft and grounding (US-F1, F2)
1. `PublicInfoResponseDraft`, templates, `drafter` agent, `lib/grounding.ts` with unit tests
   (number normalisation, missing source, gap).
2. Draft page editor with flags, regenerate and confirm, and letter type switch.
3. Integration tests: generate draft from two replies → every point covered, sources valid;
   edited number → `number_mismatch`; template fallback without AI.

### Phase 6: Anonymisation and export (US-G1, H1, H2)
1. `PublicInfoRedactionMark`, `pii_detector` agent, merge with the Phase 3 rules, and
   exemptions (public officials, function markers, letterhead, requester block in the draft).
2. Anonymisation tab: a click cycles suggested → accepted → rejected (false positive); "Zostaw
   jawne" sets `kept` with a required reason. Category bulk accept.
3. Export: stale-mark check → burn-in → HTML → `renderDocxWithCapacity` / PDF renderer / TXT,
   one file per call. Redacted reply text exported as DOCX. `mark-sent` with archive snapshot.
4. Integration tests: export blocked while undecided (409); accepted PESEL absent from DOCX bytes
   (unzip + search); editing a paragraph after accepting a mark re-detects, and a forged stale
   mark returns 409 `pii_marks_stale`; public-official name not suggested; mark-sent closes the
   case and reindexes.

### Phase 7: Extension and clarification (US-H3, H4)
1. `extend`, `request-clarification`, `register-clarification`, `leave-unprocessed` commands with
   undo. Dialogs using the `extension_notice` and `clarification_request` templates.
2. Integration tests: extension beyond 2 months → 422; clarification pauses (tone `paused`) and
   reply sets reply + 14; leave-unprocessed refused before the window ends.

### File Manifest (main files)

| File | Action | Purpose |
|---|---|---|
| `apps/mercato/src/modules/public_info_requests/{index,acl,setup,events,encryption,search,ai-agents,cli,di}.ts` | Create | Module contracts |
| `…/data/{entities,validators,ai-schemas}.ts` | Create | ORM, Zod, agent schemas |
| `…/commands/{requests,routing,drafts,redaction,actions}.ts` | Create | Mutations with undo and lock |
| `…/lib/{deadlines,grounding,similar,export}.ts`, `…/lib/pii/*`, `…/lib/templates/*` | Create | Domain logic |
| `…/api/**/route.ts` | Create | Routes from §API Contracts |
| `…/backend/public_info_requests/**` | Create | Pages from §UI/UX |
| `…/subscribers/reindex-request.ts` | Create | Search reindex |
| `…/i18n/{pl,en}.json`, `…/i18n/.hardcoded-allowlist.json` | Create | Strings |
| `…/migrations/*` | Generate | Tables |
| `apps/mercato/src/modules.ts` | Modify | Enable module |

### Testing Strategy
- **Unit:** deadlines, holidays, grounding, PII rules, case-number parsing, template rendering.
- **Integration** (Playwright and API, self-contained fixtures created through the API and
  cleaned up in teardown): the phase tests above. AI agents are replaced with deterministic fakes
  through a DI override so CI needs no model.
- **Manual demo check:** the jury walkthrough on a real model before recording the 3-minute
  video.

## Deferred for the demo (explicitly out of scope)

These were decided against for now, not forgotten. The prototype shows some of them.
- Supervisor dashboard and reassignment workflow (s17). Assignee is a simple field for now.
- Fees under art. 15, appeals, complaints, administrative-court tracking (Q3).
- Refusal decision approval and signing workflow (Q6). Only the draft letter type exists.
- Visual redaction of the original PDF/scan layout (burn-in on page images). The demo exports
  redacted **text** of attachments.
- Law versioning per case, bulk re-pairing UI for the archive, retention policies (Q7).
- Notifications and reminders in the bell for internal deadlines.
- Merging or linking cases, multi-requester cases, statistics exports.
- Fully offline OCR (R1).
- Encryption of draft paragraphs at rest.

## Risks & Impact Review

#### R1 — OCR leaves the closed environment
- **Scenario:** the built-in `OcrService` calls OpenAI (`createOpenAI`, `OCR_MODEL=gpt-4o`). In
  production a scan with personal data would be sent outside the city network.
- **Severity:** High (production), Low (demo with synthetic/test data, allowed by the brief).
- **Affected area:** intake of scanned requests and replies.
- **Mitigation:** demo uses only the UMB test files. Production follow-up: point the OCR SDK at a
  local OpenAI-compatible vision endpoint (verify `OPENAI_BASE_URL` support) or add a
  Tesseract-based worker behind the same queue. Either way, disable OCR on the partition until
  then.
- **Residual risk:** OCR quality of local models on Polish scans is unverified.

#### R2 — AI hallucination in the draft
- **Scenario:** the drafter invents a figure or a legal statement.
- **Severity:** High.
- **Affected area:** outgoing letters.
- **Mitigation:** source citations are required. The grounding check flags unsupported paragraphs
  and numbers absent from sources. "Ready" requires every flag to be resolved or explicitly
  confirmed. Officer review is mandatory (the system never sends).
- **Residual risk:** paraphrased non-numeric claims can pass the numeric check. Officer review
  remains the control.

#### R3 — Personal data missed by anonymisation
- **Scenario:** a private person's name in free text is not detected and is released.
- **Severity:** High.
- **Affected area:** exported letters and attachments.
- **Mitigation:** rules plus an AI detector. The officer sees every suggestion and can mark
  manually. Department replies are expected to be pre-anonymised (§11 ust. 8 of the Zarządzenie).
  The archive snapshot is always anonymised.
- **Residual risk:** detector recall below 100%. Acceptable for a demo; production needs
  measuring on real anonymised samples.

#### R4 — Wrong deadline
- **Scenario:** holiday or shift miscalculation leads to a late answer.
- **Severity:** High.
- **Affected area:** calendar and actions.
- **Mitigation:** a pure engine with unit tests for every rule, an explanation shown to the
  officer, and editable holidays.
- **Residual risk:** the calendar/working-day policy (Q1) is still undecided, so the setting
  defaults to the statute.

#### R5 — Concurrent edits
- **Scenario:** two officers edit the same case or draft.
- **Severity:** Medium.
- **Mitigation:** optimistic locking on the request and the draft (default on). Commands check the
  lock, and the conflict bar uses `surfaceRecordConflict`.
- **Residual risk:** none significant at demo scale.

#### R6 — Requester PII in the search index
- **Scenario:** the requester name or body text gets embedded and returned in similar results.
- **Severity:** High.
- **Mitigation:** only closed or imported cases are indexed, and only their anonymised
  `archive_text` (PII rules plus accepted marks applied). Every other field is excluded by
  `fieldPolicy`. An integration test asserts that a requester name and a PESEL from the request
  are absent from the indexed source.
- **Residual risk:** an unredacted name the PII rules missed can reach `archive_text`. This is
  bounded by R3.

#### R7 — AI or search unavailable during the demo
- **Scenario:** the provider times out live.
- **Severity:** Medium.
- **Mitigation:** every AI step degrades to manual or template mode, and similar search falls back
  to the `tokens` strategy.
- **Residual risk:** the demo then shows less automation.

### Tenant & data isolation
All entities are org-scoped. Every query filters by `organization_id`. Attachments are read via
`checkAttachmentAccess`. The search index is queried with `tenantId`/`organizationId`, and there
are no global caches or counters: the case sequence is computed per org and year inside the
create transaction (unique index as the final guard).

### Operational
Demo volume is a few hundred records. AI calls are synchronous with 60 s timeouts, and OCR runs on
the existing queue. Storage growth is small (attachments dominate).

## Final Compliance Report — 2026-11-21

### AGENTS.md Files Reviewed
- `AGENTS.md` (root), `.ai/specs/AGENTS.md`
- `packages/core/AGENTS.md` (API routes, setup, events, encryption, access control)
- `packages/core/src/modules/attachments/AGENTS.md`
- `packages/ai-assistant/AGENTS.md`, `packages/search/AGENTS.md`, `packages/ui/AGENTS.md`
- `.ai/ui-backend-components.md` (Schedule), `.ai/ds-rules.md`

### Compliance Matrix

| Rule Source | Rule | Status | Notes |
|---|---|---|---|
| root | User/app modules in `apps/mercato/src/modules/` | Compliant | `public_info_requests` |
| root | Modules plural snake_case; event IDs `module.entity.action` singular | Compliant | `public_info_requests.request.status_changed` |
| root | No cross-module ORM relations | Compliant | Attachments by `entityId`/`recordId`, users by FK id |
| root | Filter by `organization_id` | Compliant | All entities scoped |
| root | Optimistic locking on new editable entities | Compliant | `updated_at` + `updatedAt` in APIs; commands enforce |
| root | Zod validation, types via `z.infer` | Compliant | `data/validators.ts`, `data/ai-schemas.ts` |
| root | `findWithDecryption` + encryption maps for PII | Compliant | §Encryption |
| root | `apiCall`, `CrudForm`, `DataTable`, `LoadingMessage` | Compliant | §UI/UX |
| root | No hard-coded strings; DS tokens only | Compliant | i18n pl/en; template copy allowlisted |
| root | Dialog Ctrl/Cmd+Enter, Escape | Compliant | §UI/UX |
| root | Ask before new production dependencies | Compliant | None added (reuses documents, attachments, search, ai-assistant) |
| root | Integration tests ship with each feature | Compliant | Per phase |
| core | API routes export `openApi` | Compliant | All routes |
| core | Commands with undo for mutations | Compliant | §Commands & Events |
| root | Non-`CrudForm` writes wrapped in `useGuardedMutation`; custom routes run mutation guards | Compliant | §Commands & Events → Guards |
| attachments | `readUploadForm`, `releaseScoped`, `checkAttachmentAccess` | Compliant | Upload via core route; deletes via core |
| ai-assistant | Agents via `defineAiAgent` in `ai-agents.ts`, `requiredFeatures` | Compliant | Four object agents |
| search | Sensitive fields excluded via `fieldPolicy` | Compliant | R6 |

### Internal Consistency Check

| Check | Status | Notes |
|---|---|---|
| Data models match API contracts | Pass | |
| API contracts match UI/UX | Pass | Every page action maps to a route |
| Risks cover all write operations | Pass | Exports, actions, AI-assisted writes |
| Commands defined for all mutations | Pass | Command table covers CRUD, actions, draft edits, detection and decisions; custom routes run mutation guards |
| Cache strategy covers read APIs | Pass | No module cache; demo volume |

### Verdict
**Fully compliant for a demo implementation.** The open product questions (Q1–Q7 in the
prototype requirements) are captured as settings or deferred scope, and none blocks
implementation.

## Changelog
### 2026-11-21
- Implemented as the app module `apps/mercato/src/modules/public_info_requests/` (plan:
  `.ai/runs/2026-11-21-udip-request-desk.md`). All 10 UMB samples and an anonymisation probe
  pass `scripts/udip/verify-samples.mjs`. Deviations from the spec:
  - Similar requests use an in-module TF-IDF cosine over stemmed archive text instead of the
    search module. That is enough for the demo archive and needs no vector provider.
  - Case actions are flattened into `POST /api/public_info_requests/requests/{id}/{action}`
    routes, each backed by an undoable command.
  - Uploaded files are tracked by a `PublicInfoDocument` entity that links attachments to the
    case, its kind (request, reply, other) and the extracted text.
  - Scans are read with local Tesseract (`pdftoppm` + `tesseract`, `PUBLIC_INFO_TESSDATA_DIR`)
    when the attachments module returns no text. The handwritten sample 16/2026 falls back to
    manual typing.
  - Export and "record as sent" require a draft marked as prepared, whose current paragraph
    hashes passed the personal data check (`letterOptions.piiChecked`), with all suggestions
    decided. Edited paragraphs are re-checked automatically.
  - Without an AI provider, every assistant step runs deterministically: heuristic intake,
    keyword and contract-code routing, template drafting and PII rules with checksums.
- Revised after an independent review:
  - client-generated request id for intake;
  - status transition table;
  - only closed or imported cases indexed;
  - `tokens` fallback strategy;
  - PII rules moved to Phase 3;
  - redaction marks bound to a content hash and invalidated on edit;
  - archive search route, single-file export streams, clarification delivery action;
  - CLI auth context and OCR wait;
  - commands and guards for every write;
  - partition provisioning;
  - demo cut line.
- Initial specification, derived from the clickable prototype
  (`.ai/prototypes/udip-request-desk/`), its requirements and story map, and the UMB Hacknation
  2026 challenge materials. Scope limited to a working demo; deferred items listed.
