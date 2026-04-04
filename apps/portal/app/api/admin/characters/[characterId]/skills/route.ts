import { NextResponse } from 'next/server';

import { requireAdminApi, portalDataErrorResponse, readJsonBody } from '../../../../../../lib/admin-api';
import { addCharacterSkill } from '../../../../../../lib/portal-data';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const resolvedParams = await params;
  const unauthorized = requireAdminApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = await readJsonBody(request);
    const result = await addCharacterSkill({
      ...body,
      characterId: resolvedParams.characterId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}
