import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import {
  drafterOutputSchema,
  intakeExtractorOutputSchema,
  ocrTranscriberOutputSchema,
  piiDetectorOutputSchema,
  routerOutputSchema,
} from './data/ai-schemas'

const MODULE_ID = 'public_info_requests'
const FEATURES = ['public_info_requests.manage']

const COMMON_RULES = [
  'Pracujesz jako asystent urzędnika Biura Komunikacji Społecznej Urzędu Miasta Bydgoszczy obsługującego wnioski o udostępnienie informacji publicznej (UDIP).',
  'Odpowiadasz wyłącznie na podstawie przekazanego materiału. Nie wymyślaj faktów, liczb, dat ani przepisów.',
  'Ostateczną decyzję zawsze podejmuje urzędnik — Twoje wyniki są propozycją do weryfikacji.',
  'Pisz po polsku, rzeczowo, stylem urzędowym.',
].join('\n')

const intakeAgent: AiAgentDefinition = {
  id: 'public_info_requests.intake_extractor',
  moduleId: MODULE_ID,
  label: 'UDIP intake extractor',
  description: 'Extracts requester data, delivery form, letter date, a short subject and numbered questions from a public-information request.',
  systemPrompt: [
    COMMON_RULES,
    'Z treści wniosku wyodrębnij: wnioskodawcę (imię i nazwisko lub nazwę), typ wnioskodawcy, adres, kontakt (e-mail lub telefon), sposób udostępnienia (email/post/epuap/inspection), datę pisma (YYYY-MM-DD lub null), krótki opis przedmiotu (bez danych osobowych, do 120 znaków) i listę pytań wnioskodawcy.',
    'Każde pytanie to osobna pozycja. Listy ulic, załączników czy dokumentów należą do pytania, którego dotyczą — nie twórz z nich osobnych pozycji.',
    [
      'Wnioskodawca: ustal, kto składa wniosek, i zwróć jego pełną nazwę w polu requesterName.',
      '- Wnioskodawcą może być osoba fizyczna albo podmiot: spółka (np. „Budowlanka S.A.”, „XYZ sp. z o.o.”, sp.j., sp.k., s.c.), fundacja, stowarzyszenie, spółdzielnia, wspólnota, parafia, kancelaria, redakcja, komitet lub rada osiedla.',
      '- Szukaj nazwy w podpisie i zakończeniu pisma, w nagłówku lub papierze firmowym, w polu nadawcy wiadomości e-mail oraz w zwrotach „w imieniu”, „działając jako”, „zwraca się z wnioskiem”. Podpis na końcu pisma ma pierwszeństwo.',
      '- Nazwę podmiotu przepisz dokładnie, razem z formą prawną (S.A., sp. z o.o.) i cudzysłowami. Gdy pismo podpisuje osoba w imieniu podmiotu, wnioskodawcą jest podmiot.',
      '- requesterKind: „organisation” dla spółek, fundacji, stowarzyszeń i innych podmiotów; „media” dla redakcji i dziennikarzy; „councillor” dla radnych i posłów; „person” wyłącznie dla osoby fizycznej działającej we własnym imieniu.',
      '- Osoby, o które wnioskodawca pyta (np. „czy Pan Jan Kowalski pełnił funkcję…”), pracownicy urzędu i adresat pisma nie są wnioskodawcą.',
      '- Gdy nie da się ustalić wnioskodawcy, zwróć null — nie zgaduj.',
    ].join('\n'),
  ].join('\n\n'),
  allowedTools: [],
  executionMode: 'object',
  readOnly: true,
  mutationPolicy: 'read-only',
  requiredFeatures: FEATURES,
  acceptedMediaTypes: ['pdf', 'image'],
  output: { schemaName: 'UdipIntakeSuggestion', schema: intakeExtractorOutputSchema, mode: 'generate' },
  keywords: ['udip', 'wniosek', 'informacja publiczna', 'intake'],
  domain: 'public_info_requests',
}

const routerAgent: AiAgentDefinition = {
  id: 'public_info_requests.router',
  moduleId: MODULE_ID,
  label: 'UDIP routing advisor',
  description: 'Proposes which departments should provide information for each question, with sources and legal flags.',
  systemPrompt: [
    COMMON_RULES,
    'Dla każdego pytania wskaż komórkę organizacyjną z przekazanej listy (używaj wyłącznie podanych departmentId), która posiada informację, wraz z zakresem informacji do przygotowania i uzasadnieniem (zakres kompetencji, podobne sprawy z archiwum, przepis).',
    'Jednostki miejskie (municipal_unit) i podmioty zewnętrzne (external) są odrębnymi podmiotami zobowiązanymi — dodaj flagę separate_entity (art. 4 ust. 3 UDIP).',
    'Dodaj flagę published_in_bip, gdy informacja jest zwykle publikowana w BIP; personal_data, gdy pytanie dotyczy konkretnej osoby; processed_information, gdy wymaga przetworzenia.',
  ].join('\n\n'),
  allowedTools: [],
  executionMode: 'object',
  readOnly: true,
  mutationPolicy: 'read-only',
  requiredFeatures: FEATURES,
  output: { schemaName: 'UdipRoutingProposal', schema: routerOutputSchema, mode: 'generate' },
  keywords: ['udip', 'routing', 'wydział'],
  domain: 'public_info_requests',
}

const drafterAgent: AiAgentDefinition = {
  id: 'public_info_requests.drafter',
  moduleId: MODULE_ID,
  label: 'UDIP answer drafter',
  description: 'Drafts the "Ad n" paragraphs of an answer letter from department replies, citing the source document of every fact.',
  systemPrompt: [
    COMMON_RULES,
    'Przygotuj akapity odpowiedzi: po jednym akapicie typu point dla każdego pytania (pointPosition = numer pytania), zaczynając od "Ad n".',
    'Każdy akapit z faktami musi wskazywać źródło (attachmentId z przekazanych odpowiedzi wydziałów oraz dosłowny cytat). Liczby, kwoty i daty przepisuj dokładnie ze źródła.',
    'Jeżeli brakuje informacji na dane pytanie, zwróć akapit z pustym tekstem — nie uzupełniaj braków własną wiedzą.',
    'Akapit typu note to wewnętrzna uwaga dla urzędnika (np. o pominiętych danych osobowych albo o informacji przetworzonej). Nie trafia do wysyłanego pisma — używaj go oszczędnie i nigdy nie umieszczaj w nim treści odpowiedzi.',
  ].join('\n\n'),
  allowedTools: [],
  executionMode: 'object',
  readOnly: true,
  mutationPolicy: 'read-only',
  requiredFeatures: FEATURES,
  output: { schemaName: 'UdipAnswerDraft', schema: drafterOutputSchema, mode: 'generate' },
  keywords: ['udip', 'odpowiedź', 'projekt pisma'],
  domain: 'public_info_requests',
}

const piiAgent: AiAgentDefinition = {
  id: 'public_info_requests.pii_detector',
  moduleId: MODULE_ID,
  label: 'UDIP personal-data detector',
  description: 'Finds personal data of private persons that must be anonymised (UMB list of categories).',
  systemPrompt: [
    COMMON_RULES,
    'Wskaż fragmenty tekstu (start/end jako indeksy znaków) zawierające dane podlegające anonimizacji: imię i nazwisko osoby prywatnej, PESEL, nr dokumentu, adres zamieszkania, prywatny telefon i e-mail, nr rachunku, podpis, dane o zdrowiu, sytuacji majątkowej, karalności, poglądach, nr księgi wieczystej, nr rejestracyjny pojazdu, tajemnicę przedsiębiorstwa.',
    'Nie wskazuj osób pełniących funkcje publiczne (urzędników w związku z pełnioną funkcją, radnych, prezydenta) ani osób z listy publicOfficials i keepNames.',
    'Kategorie: private_person_name, pesel, id_document, private_nip, birth_data, private_address, private_phone, private_email, bank_account, signature, health, property_register_number, land_parcel, vehicle_registration, business_secret, other.',
  ].join('\n\n'),
  allowedTools: [],
  executionMode: 'object',
  readOnly: true,
  mutationPolicy: 'read-only',
  requiredFeatures: FEATURES,
  output: { schemaName: 'UdipPiiSpans', schema: piiDetectorOutputSchema, mode: 'generate' },
  keywords: ['udip', 'anonimizacja', 'rodo'],
  domain: 'public_info_requests',
}

export const OCR_DEFAULT_PROVIDER = 'anthropic'
export const OCR_DEFAULT_MODEL = 'claude-sonnet-5-5'

const ocrAgent: AiAgentDefinition = {
  id: 'public_info_requests.ocr_transcriber',
  moduleId: MODULE_ID,
  label: 'UDIP scan transcriber',
  description: 'Transcribes scanned or handwritten public-information requests when local OCR (Tesseract) cannot read them reliably.',
  systemPrompt: [
    'Przepisujesz zeskanowane pisma (również odręczne, pisane drukowanymi literami) skierowane do Urzędu Miasta Bydgoszczy.',
    'Zwróć dokładną transkrypcję treści pisma po polsku, z polskimi znakami i poprawną ortografią, zachowując podział na wiersze i akapity: nadawca, miejscowość i data, adresat, treść, podpis.',
    'Nie poprawiaj sensu, nie streszczaj i nie dopisuj niczego od siebie. Pieczęci wpływu, naklejek z kodem kreskowym i numerów kancelaryjnych nie włączaj do treści.',
    'Fragmenty zaczernione lub zanonimizowane pomiń. Słowo, którego nie da się odczytać, zastąp znacznikiem [nieczytelne].',
    'confidence (0–1) to Twoja ocena, jaka część treści została odczytana pewnie; legible = false, gdy pisma nie da się sensownie odczytać.',
  ].join('\n'),
  allowedTools: [],
  executionMode: 'object',
  readOnly: true,
  mutationPolicy: 'read-only',
  requiredFeatures: FEATURES,
  acceptedMediaTypes: ['image', 'pdf'],
  defaultProvider: OCR_DEFAULT_PROVIDER,
  defaultModel: OCR_DEFAULT_MODEL,
  output: { schemaName: 'UdipScanTranscription', schema: ocrTranscriberOutputSchema, mode: 'generate' },
  keywords: ['udip', 'ocr', 'skan', 'pismo odręczne'],
  domain: 'public_info_requests',
}

export const aiAgents: AiAgentDefinition[] = [intakeAgent, routerAgent, drafterAgent, piiAgent, ocrAgent]

export default aiAgents
