import { NextResponse } from 'next/server';

import { requireAdminApi, portalDataErrorResponse, readJsonBody } from '../../../../../../../lib/admin-api';
import { removeCharacterSkill, updateCharacterSkill } from '../../../../../../../lib/portal-data';

export const runtime = 'nodejs';

export async function PATCH(request, { params }) {
  const resolvedParams = await params;
  const unauthorized = requireAdminApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const body = await readJsonBody(request);
    const result = await updateCharacterSkill({
      ...body,
      characterId: resolvedParams.characterId,
      skillId: resolvedParams.skillId,
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
    const result = await removeCharacterSkill({
      characterId: resolvedParams.characterId,
      skillId: resolvedParams.skillId,
    });
    return NextResponse.json({ ok: true, result });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}
