import { redirect } from 'next/navigation';

import {
  buildCharacterSectionPath,
  pickSingle,
  requireAdminSession,
} from '../../../../../lib/admin-portal';

export const dynamic = 'force-dynamic';

export default async function AdminCharacterInventoryPage({ params, searchParams }) {
  await requireAdminSession();

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const characterId = pickSingle(resolvedParams?.characterId).trim();
  const query = pickSingle(resolvedSearchParams?.q).trim();

  redirect(buildCharacterSectionPath(characterId, 'items', query));
}
