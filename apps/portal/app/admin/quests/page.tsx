import AdminPageFrame from '../../../components/admin-page-frame';
import AdminQuestWorkspace from '../../../components/admin-quest-workspace';
import AdminSidebar from '../../../components/admin-sidebar';
import AdminSignOutForm from '../../../components/admin-signout-form';
import { requireAdminSession } from '../../../lib/admin-portal';
import { listQuestDefinitions } from '../../../lib/portal-data';

export const dynamic = 'force-dynamic';

export default async function AdminQuestsPage() {
  await requireAdminSession();

  const quests = await listQuestDefinitions();

  return (
    <AdminPageFrame
      actions={<AdminSignOutForm />}
      description="Quest definitions and adoption live on their own page now, the same way maps do."
      eyebrow="Quests"
      sidebar={<AdminSidebar section="quests" />}
      title="Quest directory"
    >
      <AdminQuestWorkspace quests={quests} />
    </AdminPageFrame>
  );
}
