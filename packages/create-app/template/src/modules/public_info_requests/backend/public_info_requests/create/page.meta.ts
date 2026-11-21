export const metadata = {
  requireAuth: true,
  requireFeatures: ['public_info_requests.manage'],
  pageTitle: 'Register request',
  pageTitleKey: 'public_info_requests.nav.create',
  pageGroup: 'Public information (UDIP)',
  pageGroupKey: 'public_info_requests.nav.group',
  pageOrder: 110,
  icon: 'file-pen-line',
  breadcrumb: [
    { label: 'Request calendar', labelKey: 'public_info_requests.nav.calendar', href: '/backend/public_info_requests' },
    { label: 'Register request', labelKey: 'public_info_requests.nav.create' },
  ],
}
