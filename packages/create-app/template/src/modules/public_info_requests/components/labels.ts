import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { DeadlineTone } from './api'

export const STATUS_VARIANT: Record<string, StatusBadgeVariant> = {
  new: 'neutral',
  sent_to_departments: 'info',
  extended: 'warning',
  awaiting_clarification: 'neutral',
  in_preparation: 'warning',
  prepared: 'success',
  sent: 'success',
  left_unprocessed: 'neutral',
}

export const STATUS_FALLBACK: Record<string, string> = {
  new: 'New — no action yet',
  sent_to_departments: 'Sent to departments',
  extended: 'Extended (kwerenda)',
  awaiting_clarification: 'Awaiting clarification',
  in_preparation: 'Answer in preparation',
  prepared: 'Answer prepared',
  sent: 'Answer sent',
  left_unprocessed: 'Left unprocessed',
}

export const TONE_ROW_CLASS: Record<DeadlineTone, string> = {
  overdue: 'bg-status-error-bg',
  today: 'bg-status-error-bg',
  tomorrow: 'bg-status-warning-bg',
  paused: 'bg-status-info-bg',
  normal: '',
  done: 'text-muted-foreground',
}

export const TONE_VARIANT: Record<DeadlineTone, StatusBadgeVariant> = {
  overdue: 'error',
  today: 'error',
  tomorrow: 'warning',
  paused: 'info',
  normal: 'neutral',
  done: 'success',
}

export const LETTER_TYPES = [
  'answer',
  'no_statistics',
  'not_held_referral',
  'bip_referral',
  'extension_notice',
  'clarification_request',
  'refusal_decision_draft',
  'left_unprocessed',
] as const

export const CHANNELS = ['email', 'epuap', 'post', 'in_person', 'phone'] as const
export const DELIVERY_FORMS = ['email', 'post', 'epuap', 'inspection'] as const
export const REQUESTER_KINDS = ['person', 'organisation', 'media', 'councillor'] as const
export const PII_CATEGORIES = [
  'private_person_name',
  'pesel',
  'id_document',
  'private_nip',
  'birth_data',
  'private_address',
  'private_phone',
  'private_email',
  'bank_account',
  'signature',
  'health',
  'property_register_number',
  'land_parcel',
  'vehicle_registration',
  'business_secret',
  'other',
] as const
