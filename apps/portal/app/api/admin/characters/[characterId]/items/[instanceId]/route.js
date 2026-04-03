import { NextResponse } from 'next/server';

import { requireAdminApi, portalDataErrorResponse, readJsonBody } from '../../../../../../../lib/admin-api.js';
import { removeCharacterItem, updateCharacterItem } from '../../../../../../../lib/portal-data.js';

export const runtime = 'nodejs';

export async function PATCH(request, { params }) {
  const resolvedParams = await params;
  const unauthorized = requireAdminApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = await readJsonBody(request);
    const result = await updateCharacterItem({
      ...body,
      actor: 'admin-portal',
      characterId: resolvedParams.characterId,
      instanceId: resolvedParams.instanceId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}

export async function DELETE(request, { params }) {
  const resolvedParams = await params;
  const unauthorized = requireAdminApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = await readJsonBody(request);
    const result = await removeCharacterItem({
      ...body,
      inventoryScope: request.nextUrl.searchParams.get('inventoryScope') || body.inventoryScope,
      actor: 'admin-portal',
      characterId: resolvedParams.characterId,
      instanceId: resolvedParams.instanceId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}
