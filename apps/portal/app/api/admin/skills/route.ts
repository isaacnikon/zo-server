import { NextResponse } from 'next/server';

import { requireAdminApi, portalDataErrorResponse } from '../../../../lib/admin-api';
import { searchSkillCatalog } from '../../../../lib/portal-data';

export const runtime = 'nodejs';

export async function GET(request) {
  const unauthorized = requireAdminApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const search = request.nextUrl.searchParams.get('search') || '';
    const skills = await searchSkillCatalog(search);
    return NextResponse.json({ ok: true, skills });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}
