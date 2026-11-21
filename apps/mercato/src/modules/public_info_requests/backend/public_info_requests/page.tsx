import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import RequestsCalendar from '../../components/RequestsCalendar'

export default function PublicInfoRequestsPage() {
  return (
    <Page>
      <PageBody>
        <RequestsCalendar />
      </PageBody>
    </Page>
  )
}
