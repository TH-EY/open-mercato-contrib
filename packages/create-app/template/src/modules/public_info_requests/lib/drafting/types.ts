export type LetterType =
  | 'answer'
  | 'extension_notice'
  | 'clarification_request'
  | 'not_held_referral'
  | 'bip_referral'
  | 'refusal_decision_draft'
  | 'left_unprocessed'
  | 'no_statistics'

export const LETTER_TYPES: readonly LetterType[] = [
  'answer',
  'extension_notice',
  'clarification_request',
  'not_held_referral',
  'bip_referral',
  'refusal_decision_draft',
  'left_unprocessed',
  'no_statistics',
] as const

export type DraftFlag = 'unsupported' | 'number_mismatch' | 'gap' | 'assistant_only'

export type DraftSource = { attachmentId: string; page?: number; quote: string }

export type DraftParagraphKind = 'intro' | 'point' | 'closing' | 'note'

export type DraftParagraph = {
  id: string
  kind: DraftParagraphKind
  pointPosition?: number
  text: string
  contentHash: string
  sources: DraftSource[]
  flags: DraftFlag[]
  mismatchTokens?: string[]
  confirmedBy?: string | null
}

export type Salutation = 'pan' | 'pani' | 'panstwo'

export type Letterhead = { officeName: string; unitName: string; address: string; email: string }

export const DEFAULT_LETTERHEAD: Letterhead = {
  officeName: 'URZĄD MIASTA BYDGOSZCZY',
  unitName: 'Biuro Komunikacji Społecznej',
  address: '85-102 Bydgoszcz, ul. Jezuicka 1',
  email: 'bip@um.bydgoszcz.pl',
}

export type LetterContext = {
  caseNumber: string
  letterDate: string
  requesterName: string | null
  requesterAddressLines?: string[]
  salutation: Salutation
  requestDate?: string | null
  receivedAt: string
  subjectSummary: string
  points: { position: number; text: string }[]
  departments: string[]
  letterhead?: Letterhead
  extension?: { newDueDate: string; reason: string }
  referral?: { entityName: string; contactBlock: string }
  bipUrl?: string
  clarification?: { departmentName: string; question: string; days: number; newDueDate?: string | null }
  refusal?: { legalBasis: string; reason: string }
}

export type ReplyText = { attachmentId: string; departmentName: string; text: string; pointPositions: number[] }

export type GroundingSource = { attachmentId: string; text: string }
