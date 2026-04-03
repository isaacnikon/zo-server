import { NextResponse } from 'next/server';

import { requireAdminApi, portalDataErrorResponse, readJsonBody } from '../../../../../../lib/admin-api.js';
import { updateCharacterProfile } from '../../../../../../lib/portal-data.js';

export const runtime = 'nodejs';

export async function PATCH(request, { params }) {
  const resolvedParams = await params;
  const unauthorized = requireAdminApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = await readJsonBody(request);
    const result = await updateCharacterProfile({
      ...body,
      characterId: resolvedParams.characterId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}
