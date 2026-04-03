import { NextResponse } from 'next/server';

import { portalDataErrorResponse, readJsonBody, requireAdminApi } from '../../../../lib/admin-api.js';
import { saveMapRoute } from '../../../../lib/portal-data.js';

export async function POST(request) {
  const authFailure = requireAdminApi(request);
  if (authFailure) {
    return authFailure;
  }

  try {
    const body = await readJsonBody(request);
    const route = await saveMapRoute(body);
    return NextResponse.json({ ok: true, route });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}
