# Execution plan — UDIP Request Desk demo (`public_info_requests`)

Source doc: .ai/specs/2026-11-21-udip-request-desk.md
Prototype: .ai/prototypes/udip-request-desk/

## Goal

Implement the spec's demo scope as the app module `apps/mercato/src/modules/public_info_requests/`
so that every UMB example document in "Przykładowe wnioski i odpowiedzi" (10 requests + their
responses) passes the jury walkthrough: intake (text extraction / OCR), similar-request match
against the imported archive, routing proposal, sourced draft, anonymisation + export, and the
deadline calendar.

## Scope

- Module scaffold, entities, migration, ACL, setup seeds (departments, settings, partition).
- Deadline engine with Polish holidays (pure, unit-tested).
- CRUD + custom API routes from the spec; backend pages in Polish.
- **Deterministic first, AI second.** No AI keys are configured in this environment, so every
  assistant step has a deterministic implementation that makes the sample documents pass on its
  own (heuristic intake parser, keyword/archive-based routing, template drafting, rule-based PII
  detection). The four AI agents are registered and used when a provider is configured; their
  output goes through the same validation and grounding.
- Local OCR: when the attachments module leaves `content` empty for a scan and the `tesseract` +
  `pdftoppm` binaries are present, the module OCRs the file itself (no new npm dependency). The
  handwritten sample 16/2026 cannot be read by Tesseract; the demo path there is "wpisz ręcznie"
  (or the built-in LLM OCR when an OpenAI key is configured).
- Archive import CLI that reads the UMB folder from disk (files are never committed).
- A verification script + integration test that runs all 10 samples through the pipeline.

## Non-goals

Everything listed under "Deferred for the demo" in the spec (supervisor dashboard, fees, refusal
sign-off workflow, visual PDF redaction, law versioning, notifications, statistics).

## Risks

- No AI keys → AI agents are exercised only through DI-faked tests; demo relies on deterministic
  paths (documented in the PR).
- Handwritten scan 16/2026 is not machine-readable offline → manual text entry path.
- PR target: company fork `TH-EY/open-mercato-contrib`, base branch
  `base/upstream-main-2026-11-21` (= upstream main 56d0700f9b), because the fork's `main` is 112
  commits behind upstream and this city-specific demo does not belong upstream.

## Progress

PR: none — draft #9 closed at the user's request; work stays on branch feat/udip-request-desk

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles.

### Phase 1: Register and calendar

- [x] 1.1 Module scaffold, entities, validators, ACL, migration — a7942cb5ea
- [x] 1.2 Deadline engine with Polish holidays and unit tests — a7942cb5ea
- [x] 1.3 Request/department/settings APIs, case number, deadline preview, calendar feed — a7942cb5ea
- [x] 1.4 Calendar list + month view, create form, case detail page — 6d968000c4
- [x] 1.5 Seeds: departments, settings, partition, demo calendar CLI — a7942cb5ea

### Phase 2: Intake

- [x] 2.1 Attachment upload, text extraction and local OCR fallback — a7942cb5ea
- [x] 2.2 Intake extraction (heuristic parser + AI agent) and suggestion UI — a7942cb5ea

### Phase 3: Archive and similar requests

- [x] 3.1 PII rules and anonymised archive text — a7942cb5ea
- [x] 3.2 Archive import CLI, search indexing and similar-request API — a7942cb5ea
- [x] 3.3 Similar-request step and archive search page — 6d968000c4

### Phase 4: Routing and department replies

- [x] 4.1 Department queries, routing proposal (keywords + archive + AI), notes, mark-sent — a7942cb5ea
- [x] 4.2 Routing page and department reply upload — 6d968000c4

### Phase 5: Draft and grounding

- [x] 5.1 Letter templates, drafting service (template + AI) and grounding check — a7942cb5ea
- [x] 5.2 Draft editor page — 6d968000c4

### Phase 6: Anonymisation and export

- [x] 6.1 Redaction marks, detection, decisions — a7942cb5ea
- [x] 6.2 Export (DOCX/PDF/TXT) with burn-in and mark-sent with archive snapshot — a7942cb5ea
- [x] 6.3 Anonymisation tab and export dialog — 6d968000c4

### Phase 7: Extension and clarification

- [x] 7.1 Extend / clarification actions and dialogs — a7942cb5ea

### Phase 8: Sample-document verification

- [x] 8.1 Verification script and integration test over all 10 UMB samples — a7942cb5ea, 6d968000c4
