export const features = [
  { id: 'public_info_requests.view', title: 'View public-information requests', module: 'public_info_requests' },
  {
    id: 'public_info_requests.manage',
    title: 'Handle public-information requests',
    module: 'public_info_requests',
    dependsOn: ['public_info_requests.view'],
  },
  {
    id: 'public_info_requests.approve',
    title: 'Supervise public-information requests',
    module: 'public_info_requests',
    dependsOn: ['public_info_requests.manage'],
  },
  {
    id: 'public_info_requests.knowledge.manage',
    title: 'Manage UDIP knowledge base and settings',
    module: 'public_info_requests',
    dependsOn: ['public_info_requests.view'],
  },
]

export default features
