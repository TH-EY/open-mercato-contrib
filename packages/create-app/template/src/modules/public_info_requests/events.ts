import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'public_info_requests.request.created', label: 'Public-information request registered', entity: 'request', category: 'crud' },
  { id: 'public_info_requests.request.updated', label: 'Public-information request updated', entity: 'request', category: 'crud' },
  { id: 'public_info_requests.request.deleted', label: 'Public-information request deleted', entity: 'request', category: 'crud' },
  { id: 'public_info_requests.request.status_changed', label: 'Public-information request status changed', entity: 'request', category: 'lifecycle' },
  { id: 'public_info_requests.request.responded', label: 'Public-information request answered', entity: 'request', category: 'lifecycle' },
  { id: 'public_info_requests.department.created', label: 'UDIP department created', entity: 'department', category: 'crud' },
  { id: 'public_info_requests.department.updated', label: 'UDIP department updated', entity: 'department', category: 'crud' },
  { id: 'public_info_requests.department.deleted', label: 'UDIP department deleted', entity: 'department', category: 'crud' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'public_info_requests',
  events,
})

export const emitPublicInfoRequestsEvent = eventsConfig.emit

export type PublicInfoRequestsEventId = typeof events[number]['id']

export default eventsConfig
