# UDIP Request Desk (`public_info_requests`)

A staff-only assistant that helps Bydgoszcz City Hall (Biuro Komunikacji Społecznej) handle
requests for access to public information (UDIP). It registers requests, finds similar past
cases, proposes which departments to ask, drafts a sourced answer, anonymises personal data,
exports the letter, and tracks the statutory deadline. **It never sends anything.**

- Spec: `.ai/specs/2026-11-21-udip-request-desk.md`
- Clickable prototype: `.ai/prototypes/udip-request-desk/`

## Running the demo

1. Configure the app (`apps/mercato/.env`) as usual, then run `yarn initialize`. This seeds the
   departments, the deadline settings and 10 demo requests with deadlines relative to today.
2. Optional local OCR for scanned requests: install `tesseract` and `poppler` (`pdftoppm`), and
   point `PUBLIC_INFO_TESSDATA_DIR` at a folder that contains `pol.traineddata`
   (from `tesseract-ocr/tessdata_fast`). Without Polish data, English OCR is used. Without
   Tesseract, scans fall back to manual typing (or to the built-in LLM OCR when an OpenAI key is
   configured). PDFs with a text layer are read with `pdftotext` (poppler) so lines and paragraphs
   survive; without it the shared attachments extractor is used, which flattens each page.
3. Import the answer knowledge base (past requests and answers), for example the UMB samples. Skip the cases
   you want to register live during the demo:

   ```bash
   yarn mercato public_info_requests import-archive --tenant <tenantId> --org <orgId> \
     --dir "<folder with Wniosek/Odpowiedź files>" --skip 599,543,17,16
   ```

4. Reseed the calendar for another day: `yarn mercato public_info_requests seed-demo-calendar --tenant <id> --org <id> [--today YYYY-MM-DD]`.
5. Open **Informacja publiczna (UDIP) → Kalendarz wniosków** (switch the UI language to Polish).

## Officers and assignment

- A request can be assigned to anyone holding `public_info_requests.manage` (`GET /api/public_info_requests/assignees`),
  or left unassigned at registration. Unassigned open requests show a **Przejmij** (claim) button in the calendar
  and on the case page; the "Tylko nieprzypisane" filter lists them. Claiming fails with 409 when someone else
  already holds the case; reassignment goes through the officer selector on the case page.
- For a UDIP-only demo, create a role with just the `public_info_requests.view/manage/approve` features, give it
  to the officers, and hide every other module through role sidebar preferences (Settings → Sidebar customization
  or `PUT /api/auth/sidebar/preferences` with `scope: { type: 'role', roleId }` and `hiddenItems`). After changing
  role preferences run `yarn mercato configs cache structural --all-tenants` so cached sidebars refresh.

## Verification scripts

- `scripts/udip/verify-samples.mjs` drives the API through the whole flow for every UMB sample,
  plus an anonymisation probe:
  `UDIP_EMAIL=… UDIP_PASSWORD=… node scripts/udip/verify-samples.mjs "<samples dir>"`
- `scripts/udip/ui-walkthrough.mjs` drives the UI with Playwright and saves screenshots.

## AI

The assistant works without any model. Intake parsing, routing (department scopes, keywords,
contract codes and similar cases), drafting (letter templates plus department replies) and PII
detection (rules with checksums) are all deterministic. When a provider is configured through the
standard AI settings (`OM_AI_PROVIDER`, `OLLAMA_BASE_URL` for a local model, and so on), the four
agents in `ai-agents.ts` refine these steps. Their output goes through the same validation and
grounding checks. `PUBLIC_INFO_AI_DISABLED=true` forces deterministic mode.
