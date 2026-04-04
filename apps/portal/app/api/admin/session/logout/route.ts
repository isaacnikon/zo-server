import { NextResponse } from 'next/server';

import { ADMIN_COOKIE_NAME, ADMIN_COOKIE_OPTIONS } from '../../../../../lib/auth';
import { buildRedirectUrl } from '../../../../../lib/redirect';

export const runtime = 'nodejs';

export async function POST(request) {
  const response = NextResponse.redirect(
    buildRedirectUrl(request, '/admin', { status: 'logged-out' }),
    { status: 303 }
  );
  response.cookies.set(ADMIN_COOKIE_NAME, '', {
    ...ADMIN_COOKIE_OPTIONS,
    expires: new Date(0),
    maxAge: 0,
  });
  return response;
}
