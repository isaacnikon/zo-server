import { NextResponse } from 'next/server';

import { requireAdminApi, portalDataErrorResponse } from '../../../../lib/admin-api.js';
import { searchItemCatalog } from '../../../../lib/portal-data.js';

export const runtime = 'nodejs';

export async function GET(request) {
  const unauthorized = requireAdminApi(request);
  if (unauthorized) {
    return unauthorized;
  }

  try {
    const search = request.nextUrl.searchParams.get('search') || '';
    const items = await searchItemCatalog(search);
    return NextResponse.json({ ok: true, items });
  } catch (error) {
    return portalDataErrorResponse(error);
  }
}
