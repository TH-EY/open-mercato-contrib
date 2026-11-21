# UDIP Request Desk — Bydgoszcz City Hall

> Requirements for a staff-only assistant that helps the Bydgoszcz City Hall (Urząd Miasta
> Bydgoszczy, UMB) process requests for access to public information (wnioski o udostępnienie
> informacji publicznej, "UDIP"). Drafted 2026-11-21 as input for an interactive prototype and a
> later specification. Source material: the Hacknation 2026 UMB challenge brief, Zarządzenie
> Prezydenta Miasta Bydgoszczy nr 535/2024, the UMB list of data subject to anonymisation, the
> UMB request register spreadsheet ("kalendarium"), and ten anonymised sample requests with their
> responses. All prototype data is synthetic.

## 1. Context

UMB receives dozens of public-information requests per month from residents, NGOs and
journalists. Requests arrive by e-mail, ePUAP, post, in person, or by phone. Under Zarządzenie
535/2024 (§9–§11):

- the **AIP** (Administrator Informacji Publicznej, staffed by Biuro Komunikacji Społecznej — BKS)
  registers every request and coordinates the answer;
- the AIP forwards the scope of the request to the **competent departments** (wydziały, biura);
- departments return a draft answer or documentation, **already anonymised**, by the AIP's
  deadline; if they do not hold the information they say who does; if the information is
  protected they draft a refusal decision; if it is "processed information" they justify it;
- the AIP assembles and sends the final reply. Decisions are signed by the President or an
  authorised person (§12).

Today this is tracked in a spreadsheet (Lp., Numer sprawy, Wnioskodawca, Przedmiot zapytania,
Data wpływu, Termin odpowiedzi, Data odpowiedzi, Osoba odpowiedzialna, Pozostało dni). Letters
are written from scratch, and past answers are found by memory.

## 2. Product boundaries (fixed by the brief)

1. **Staff only.** No public portal, no requester access. Only UMB staff with explicit features.
2. **Manual intake, assisted entry.** Staff enter requests that arrived by any channel. The system
   does **not** monitor mailboxes, ePUAP or any other source. It helps with data entry: OCR of
   scans/photos, text extraction from PDF/DOCX, field suggestion.
3. **Never sends anything.** No e-mail, no ePUAP, no export to departments. The system produces
   drafts, cover notes and documents that staff copy, download and send themselves, then record
   that they did.
4. **No integration** with other UMB systems (incl. SIDAS document management).
5. **Assistant, not decision maker.** Every suggestion (match, routing, draft, anonymisation) is
   reviewed and accepted by an officer; the officer's decision is final and recorded.
6. **Target deployment is offline.** The hackathon prototype may use a hosted model; production
   runs a local model with no Internet access, learning from uploaded laws, ordinances, past
   requests and answers.

## 3. Roles

| Role | Who | Can |
|---|---|---|
| **Officer (Prowadzący)** | BKS staff handling requests | Register, check similarity, route, record department replies, draft, anonymise, export, record sending, extend, request clarification |
| **Supervisor (Kierownik BKS)** | Head of the AIP team | Everything an officer can + reassign, see team workload, approve extensions and refusal drafts, unlock closed cases |
| **Knowledge admin** | Designated BKS/IT staff | Maintain knowledge base (laws, ordinances, archive), organisational structure and department scopes, letter templates, deadline settings, holiday calendar |

Department staff have **no access**; any other authenticated user without the features sees a
no-access state.

## 4. Scope decisions (defaults taken 2026-11-21, overridable in review)

- **D1 Deadline counting.** Default: 14 **calendar** days from the day after receipt (UDIP art. 13
  ust. 1 + KPA art. 57 §1); if the last day falls on a Saturday or a public holiday, it moves to
  the next working day (KPA art. 57 §4). The brief states "14 working days" — this contradicts the
  statute, so the rule is a **knowledge-admin setting** with *calendar days* as default and
  *working days* as an alternative. Open question Q1.
- **D2 Extension (kwerenda).** Up to **2 months from receipt** (art. 13 ust. 2). Requires a notice
  to the requester with the reason and the new date, sent **before** the original deadline. The
  system computes the maximum date, proposes a date, and drafts the notice.
- **D3 Clarification (wezwanie do doprecyzowania).** The deadline clock **pauses** when the
  clarification request is recorded as sent. The requester has 7 days from delivery. On reply, a
  new 14-day period starts from the reply date. Without a reply, the case closes as *left
  unprocessed* (pozostawiony bez rozpoznania) with a drafted notice. Staff may override the new
  date manually (the 509/2026 sample sets a date explicitly).
- **D4 Similar requests.** On registration the system searches the archive (default: last
  24 months, filterable) and shows ranked matches. When a match exists the officer may (a) start
  the draft from the past answer, (b) still route to departments (e.g. for fresh figures), or
  (c) refer the requester to a BIP page. Matches never auto-skip routing.
- **D5 Case number.** Format `BKS.IV.1431.<seq>.<year>`. The system **suggests** the next number
  in the yearly sequence; the officer can overwrite it to match the official register (SIDAS).
  Duplicates are blocked.
- **D6 Letter types.** Final answer; extension notice; clarification request; BIP referral;
  "not public information / not held" letter; refusal decision draft (art. 16, privacy, business
  secret, processed information without public interest); left-unprocessed notice.
- **D7 Anonymisation.** Applies to the generated letter **and** to uploaded department files that
  will be attached. Detection uses the UMB list of data subject to anonymisation (§8). Suggested
  spans are grey; accepted spans turn black; the officer can add spans manually. Export produces a
  redacted copy; originals stay internal.
- **D8 UI language.** Polish. Letters are Polish on the BKS letterhead.
- **D9 Status model.** `Nowy (brak działań)` → `Wysłano do wydziałów` → `Kwerenda (+n dni)` /
  `Oczekuje na doprecyzowanie` → `Odpowiedź w przygotowaniu` → `Odpowiedź przygotowana` →
  `Odpowiedź wysłana`. Side exits: `Pozostawiony bez rozpoznania`, `Odmowa (decyzja)`,
  `Przekazano wg właściwości`.
- **D10 Out of prototype scope.** Fees for costs of providing information (art. 15), appeals and
  complaints to the administrative court, statistics/reporting exports. Listed as open questions.

## 5. Story map

### Epic A — Know what is due (request calendar)

- **US-A1** As an officer, I want all requests of the selected year listed oldest to newest by
  deadline with days remaining, so that I answer the most urgent first.
  - AC: columns Lp., Nr sprawy, Wnioskodawca, Przedmiot (short), Data wpływu, Termin, Pozostało
    dni, Status, Prowadzący (initials), Data odpowiedzi.
  - AC: rows due **today** are highlighted error, due **tomorrow** warning, **overdue** error with
    an icon; paused (clarification) rows show "wstrzymany" instead of a day count.
  - AC: year selector (default current year); filters: status, officer, "tylko moje", "termin w
    ciągu 3 dni"; search by number, requester, subject.
  - AC: empty year shows a first-run empty state with "Zarejestruj wniosek"; a search with no hits
    shows a no-results state with "Wyczyść filtry".
  - AC: keyboard — `/` focuses search, arrow keys move the row focus, Enter opens the case.
- **US-A2** As an officer, I want a month calendar of deadlines, so that I can plan the week.
  - AC: each day lists due cases; weekends and public holidays are shaded; today is outlined;
    clicking a case opens it.
- **US-A3** As a supervisor, I want to see team workload and at-risk cases, so that I can reassign
  in time.
  - AC: per officer: open cases, due ≤ 3 days, overdue; reassign action with reason; reassignment
    is logged.

### Epic B — Register a request quickly and correctly

- **US-B1** As an officer, I want to upload a scan, PDF, DOCX, e-mail export or type a phone note,
  so that any channel ends up in one register.
  - AC: channel is mandatory (e-mail, ePUAP, poczta/papier, osobiście, telefon); phone/in-person
    allow typing the note directly.
  - AC: scans/photos run OCR; text layer from PDF/DOCX is extracted; the officer sees the original
    and the extracted text side by side and can correct the text.
  - AC: unreadable files show an error with "spróbuj ponownie / wpisz ręcznie".
- **US-B2** As an officer, I want the system to pre-fill requester, contact, preferred delivery
  form, date of receipt and a short subject, so that I only verify.
  - AC: every pre-filled field shows a "sugestia" marker until confirmed or edited.
  - AC: date of receipt defaults to today and can be changed (e.g. post received earlier).
  - AC: the deadline is computed live with an explanation ("wpływ 23.11 + 14 dni = 07.12,
    poniedziałek") and holidays/weekend shift shown.
  - AC: case number suggested (D5); duplicate number → inline error.
  - AC: request split into numbered **points** (pytania) — used later for routing and drafting.
- **US-B3** As an officer, I want to be warned if the same requester already has an open request
  on the same topic, so that I can merge or link instead of duplicating.

### Epic C — Reuse what we already answered

- **US-C1** As an officer, I want ranked similar past requests with their answers, so that I don't
  research again.
  - AC: each match shows number, date, subject, similarity %, which **points** it covers, the
    departments that answered, and whether the answer included attachments.
  - AC: side-by-side comparison of the new request and the past request+answer.
  - AC: actions per D4; the chosen action is logged on the case.
  - AC: no matches → explicit "brak podobnych wniosków w archiwum" and the flow continues to
    routing.
- **US-C2** As an officer, I want to search the archive freely, so that I can answer ad-hoc
  questions from colleagues.

### Epic D — Route to the right departments

- **US-D1** As an officer, I want the system to propose which departments must contribute and what
  each should provide, based on the org structure, the knowledge base and law, so that I send
  precise asks.
  - AC: proposal per point: department, scope of information to provide, reasoning with sources
    (department scope from the org regulation, past answers, statute), confidence.
  - AC: flags for: information already in BIP (suggest referral), municipal units that are
    separate obligated entities (suggest informing the requester / forwarding), possibly protected
    data (privacy, business secret), possibly processed information.
  - AC: officer can add/remove departments, edit the scope text, set the internal deadline
    (default: 5 working days before the statutory deadline).
- **US-D2** As an officer, I want a ready-to-copy internal note per department, so that I can send
  it from my own mailbox.
  - AC: "Kopiuj treść" and "Pobierz .docx"; the system never sends. "Oznacz jako wysłane" records
    date and recipient; status becomes `Wysłano do wydziałów`.

### Epic E — Collect department replies

- **US-E1** As an officer, I want to upload each department's reply (PDF, DOCX, XLSX, scan) to the
  case, so that all material is in one place.
  - AC: file is assigned to a department and to points it answers; OCR/extraction runs.
  - AC: tracker shows per department: asked on, internal deadline, received on, status
    (oczekuje / otrzymano / po terminie / brak informacji – wskazano inny podmiot).
  - AC: a reply marked "nie posiadamy informacji" lets the officer pick the follow-up letter type.
- **US-E2** As an officer, I want the system to detect personal data in uploaded attachments, so
  that nothing leaks when they are forwarded.

### Epic F — Draft the answer

- **US-F1** As an officer, I want a draft letter assembled from the department replies on the BKS
  template, so that I only review and polish.
  - AC: draft cites the source document for every factual paragraph; unsupported sentences are
    flagged ("brak źródła").
  - AC: points without a department answer are flagged as gaps; draft cannot be marked ready while
    gaps exist unless the officer confirms explicitly.
  - AC: letter type selector (D6); switching type regenerates with a warning.
  - AC: rich-text editing; regeneration of a single paragraph; version history.
- **US-F2** As an officer, I want to choose the letter type when the case needs something else than
  an answer (extension, clarification, BIP referral, not held, refusal), so that every outgoing
  letter comes from the same place.

### Epic G — Anonymise

- **US-G1** As an officer, I want suggested personal data highlighted grey in the letter and the
  attachments, so that I can accept or reject each in one click.
  - AC: categories from the UMB list (name of private person, PESEL, ID number, address, private
    phone/e-mail, bank account, signature, health, … business secret).
  - AC: click toggles grey (suggested) ↔ black (accepted); "Akceptuj wszystkie w kategorii";
    manual selection adds a span; every decision logged with user and time.
  - AC: names of persons performing public functions are **not** suggested (shown with reason).
  - AC: export is blocked while suggestions remain undecided.

### Epic H — Finish and record

- **US-H1** As an officer, I want to export the final letter and redacted attachments as DOCX/PDF,
  so that I can send them myself.
- **US-H2** As an officer, I want to record that the answer was sent (date, channel), so that the
  calendar and archive are correct.
  - AC: status `Odpowiedź wysłana`; Data odpowiedzi filled; case enters the archive (with the
    anonymised answer) and becomes a future similarity source.
- **US-H3** As an officer, I want to extend the deadline with a drafted notice, so that the
  requester is informed lawfully (D2).
  - AC: cannot exceed 2 months from receipt; warns if the notice is recorded after the original
    deadline.
- **US-H4** As an officer, I want to request clarification and have the clock paused (D3).

### Epic I — Teach the assistant

- **US-I1** As a knowledge admin, I want to upload laws, law amendments, ordinances and archive
  answers, so that suggestions are based on current sources.
  - AC: document list with type, version/date in force, indexing status; superseding a law
    version keeps the old one for cases registered under it.
  - AC: bulk import of the archive (PDF/DOCX pairs request+answer) with automatic pairing by case
    number.
- **US-I2** As a knowledge admin, I want to maintain departments and their competence scopes, so
  that routing stays accurate after reorganisations.
- **US-I3** As a knowledge admin, I want to configure deadline counting and the holiday calendar
  (D1).

### Cross-cutting rules

- Every case has an audit trail: who did what, when, which suggestion was accepted or changed.
- AI output is labelled "Propozycja asystenta" and never changes case data without an explicit
  officer action.
- Optimistic locking on cases: two officers editing → conflict bar.
- No outbound channels exist in the product (no SMTP, no ePUAP client).
- Requester personal data is stored internally, excluded from the archive similarity index and
  from exported answers unless explicitly kept.
- All dialogs: `Ctrl/Cmd+Enter` confirm, `Escape` cancel.

## 6. Screen inventory

| # | Screen | Covers |
|---|---|---|
| s1 | Kalendarz wniosków — lista | US-A1 |
| s2 | Kalendarz — widok miesiąca | US-A2 |
| s3 | Stany puste: nowy rok / brak wyników / brak dostępu | US-A1, §3 |
| s4 | Rejestracja 1/3 — wgranie dokumentu i OCR | US-B1 |
| s5 | Rejestracja 2/3 — dane wniosku i termin | US-B2, US-B3, D1, D5 |
| s6 | Rejestracja 3/3 — podobne wnioski | US-C1, D4 |
| s7 | Propozycja ścieżki — wydziały i zakres | US-D1 |
| s8 | Notatka do wydziału (dialog, kopiuj/pobierz) | US-D2 |
| s9 | Sprawa — przegląd i odpowiedzi wydziałów | US-E1, D9 |
| s10 | Wgranie odpowiedzi wydziału (drawer) | US-E1, US-E2 |
| s11 | Projekt odpowiedzi | US-F1, US-F2 |
| s12 | Anonimizacja | US-G1, D7 |
| s13 | Eksport i oznaczenie wysyłki (dialog) | US-H1, US-H2 |
| s14 | Przedłużenie terminu — kwerenda (dialog) | US-H3, D2 |
| s15 | Wezwanie do doprecyzowania (dialog) | US-H4, D3 |
| s16 | Sprawa zagrożona — błąd OCR / konflikt numeru / po terminie | US-B1, US-B2, US-A1 |
| s17 | Pulpit kierownika | US-A3 |
| s18 | Archiwum — wyszukiwarka | US-C2 |
| s19 | Baza wiedzy | US-I1 |
| s20 | Struktura organizacyjna | US-I2 |
| s21 | Ustawienia terminów | US-I3, D1 |

## 7. Open questions

- **Q1** Calendar vs working days (D1) — the statute says 14 days; the brief says 14 working days.
- **Q2** Does the clarification reply restart the full 14 days (D3) or does BKS set the date
  manually as in sample 509/2026?
- **Q3** Do fees under art. 15 need tracking (14-day notice, payment wait)?
- **Q4** Is the case number always taken from SIDAS (no own sequence)?
- **Q5** Official department list and scopes — to be imported from the BIP pages
  (`bip.um.bydgoszcz.pl/artykuly/198/wydzialy`, `/1158/biura`); prototype names are illustrative.
- **Q6** Who signs refusal decisions in the workflow (§12) and must the tool capture approval?
- **Q7** Retention period for internal copies of requester data and unredacted department files.
