import { Page, PageBody } from '@open-mercato/ui/backend/Page'
import CreateRequestWizard from '../../../components/CreateRequestWizard'

export default function CreatePublicInfoRequestPage() {
  return (
    <Page>
      <PageBody>
        <CreateRequestWizard />
      </PageBody>
    </Page>
  )
}
