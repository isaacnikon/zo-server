import { NextResponse } from 'next/server';

import {
  ADMIN_COOKIE_NAME,
  ADMIN_COOKIE_OPTIONS,
  isValidAdminToken,
} from '../../../../lib/auth.js';
import { buildRedirectUrl, resolveRedirectPath } from '../../../../lib/redirect.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const formData = await request.formData();
  const token = String(formData.get('token') || '').trim();
  const redirectTo = resolveRedirectPath(formData.get('redirectTo'), '/admin');

  if (!isValidAdminToken(token)) {
    return NextResponse.redirect(
      buildRedirectUrl(request, redirectTo, { error: 'invalid-admin-token' }),
      { status: 303 }
    );
  }

  const response = NextResponse.redirect(
    buildRedirectUrl(request, redirectTo, { status: 'logged-in' }),
    { status: 303 }
  );
  response.cookies.set(ADMIN_COOKIE_NAME, token, ADMIN_COOKIE_OPTIONS);
  return response;
}
