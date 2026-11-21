export const metadata = {
  requireAuth: true,
  requireFeatures: ['public_info_requests.view'],
  pageTitle: 'Request',
  pageTitleKey: 'public_info_requests.nav.detail',
  navHidden: true,
  breadcrumb: [
    { label: 'Request calendar', labelKey: 'public_info_requests.nav.calendar', href: '/backend/public_info_requests' },
    { label: 'Request', labelKey: 'public_info_requests.nav.detail' },
  ],
}
