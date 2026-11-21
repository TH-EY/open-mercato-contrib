import type { AiAgentDefinition } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-agent-definition'
import {
  drafterOutputSchema,
  intakeExtractorOutputSchema,
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

export const aiAgents: AiAgentDefinition[] = [intakeAgent, routerAgent, drafterAgent, piiAgent]

export default aiAgents
