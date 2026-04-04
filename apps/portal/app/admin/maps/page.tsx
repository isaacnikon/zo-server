import AdminMapRouteWorkspace from '../../../components/admin-map-route-workspace';
import AdminPageFrame from '../../../components/admin-page-frame';
import AdminSidebar from '../../../components/admin-sidebar';
import AdminSignOutForm from '../../../components/admin-signout-form';
import { requireAdminSession } from '../../../lib/admin-portal';
import { listMapCatalog, listMapRoutes } from '../../../lib/portal-data';

export const dynamic = 'force-dynamic';

export default async function AdminMapsPage() {
  await requireAdminSession();

  const [mapCatalog, mapRoutes] = await Promise.all([
    listMapCatalog(),
    listMapRoutes(),
  ]);

  return (
    <AdminPageFrame
      actions={<AdminSignOutForm />}
      description="Route editing is isolated here so map work stays independent from character management."
      eyebrow="Maps"
      sidebar={<AdminSidebar section="maps" />}
      title="Route directory"
    >
      <AdminMapRouteWorkspace mapCatalog={mapCatalog} routes={mapRoutes} />
    </AdminPageFrame>
  );
}
