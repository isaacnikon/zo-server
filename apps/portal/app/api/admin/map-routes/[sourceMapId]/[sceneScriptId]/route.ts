import { NextResponse } from 'next/server';

import { portalDataErrorResponse, readJsonBody, requireAdminApi } from '../../../../../../lib/admin-api';
import { deleteMapRoute, saveMapRoute } from '../../../../../../lib/portal-data';

async function resolveParams(context) {
  return context?.params ? await context.params : {};
}

export async function PATCH(request, context) {
  const authFailure = requireAdminApi(request);
  if (authFailure) {
    return authFailure;
  }

  try {
    const params = await resolveParams(context);
    const body = await readJsonBody(request);
    const route = await saveMapRoute({
      ...body,
      sourceMapId: params?.sourceMapId,
      sourceSceneScriptId: params?.sceneScriptId,
    });
    return NextResponse.json({ ok: true, route });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}

export async function DELETE(request, context) {
  const authFailure = requireAdminApi(request);
  if (authFailure) {
    return authFailure;
  }

  try {
    const params = await resolveParams(context);
    const route = await deleteMapRoute({
      sourceMapId: params?.sourceMapId,
      sourceSceneScriptId: params?.sceneScriptId,
    });
    return NextResponse.json({ ok: true, route });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}
