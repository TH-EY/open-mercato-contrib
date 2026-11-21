"use client"
import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import RequestDetail from '../../../components/detail/RequestDetail'

export default function PublicInfoRequestDetailPage({ params }: { params?: { id?: string } }) {
  const id = typeof params?.id === 'string' ? params.id : ''
  return (
    <Page>
      <PageBody>
        {id ? <RequestDetail id={id} /> : null}
      </PageBody>
    </Page>
  )
}
