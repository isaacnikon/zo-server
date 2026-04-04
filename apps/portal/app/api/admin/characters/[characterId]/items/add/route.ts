import { NextResponse } from 'next/server';

import { ADMIN_COOKIE_NAME, isValidAdminToken } from '../../../../../../../lib/auth';
import { addCharacterItem, PortalDataError } from '../../../../../../../lib/portal-data';
import { buildRedirectUrl, resolveRedirectPath } from '../../../../../../../lib/redirect';

export const runtime = 'nodejs';

export async function POST(request, { params }) {
  const resolvedParams = await params;
  const formData = await request.formData();
  const redirectTo = resolveRedirectPath(formData.get('redirectTo'), '/admin');
  const adminToken = request.cookies.get(ADMIN_COOKIE_NAME)?.value || '';

  if (!isValidAdminToken(adminToken)) {
    return NextResponse.redirect(
      buildRedirectUrl(request, redirectTo, { error: 'invalid-admin-token' }),
      { status: 303 }
    );
  }

  try {
    await addCharacterItem({
      characterId: resolvedParams.characterId,
      templateId: formData.get('templateId'),
      quantity: formData.get('quantity'),
      inventoryScope: formData.get('inventoryScope'),
      actor: 'admin-portal',
    });
    return NextResponse.redirect(
      buildRedirectUrl(request, redirectTo, { status: 'item-added' }),
      { status: 303 }
    );
  } catch (error) {
    const code =
      error instanceof PortalDataError && error.code
        ? error.code
        : 'mutation-failed';
    return NextResponse.redirect(buildRedirectUrl(request, redirectTo, { error: code }), { status: 303 });
  }
}
