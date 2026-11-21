import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption'

export const defaultEncryptionMaps: ModuleEncryptionMap[] = [
  {
    entityId: 'public_info_requests:public_info_request',
    fields: [
      { field: 'requester_name' },
      { field: 'requester_address' },
      { field: 'requester_contact' },
      { field: 'body_text' },
    ],
  },
  {
    entityId: 'public_info_requests:public_info_request_point',
    fields: [{ field: 'text' }],
  },
  {
    entityId: 'public_info_requests:public_info_document',
    fields: [{ field: 'extracted_text' }],
  },
  {
    entityId: 'public_info_requests:public_info_redaction_mark',
    fields: [{ field: 'text_excerpt' }],
  },
]

export default defaultEncryptionMaps
