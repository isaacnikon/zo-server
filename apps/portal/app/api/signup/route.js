import { NextResponse } from 'next/server';

import { createPortalUser, PortalDataError } from '../../../lib/portal-data.js';
import { buildRedirectUrl } from '../../../lib/redirect.js';

export const runtime = 'nodejs';

export async function POST(request) {
  const formData = await request.formData();

  try {
    await createPortalUser({
      username: formData.get('username'),
      email: formData.get('email'),
      password: formData.get('password'),
    });
    return NextResponse.redirect(buildRedirectUrl(request, '/signup', { status: 'created' }), { status: 303 });
  } catch (error) {
    const code =
      error instanceof PortalDataError && error.code
        ? error.code
        : 'signup-failed';
    return NextResponse.redirect(buildRedirectUrl(request, '/signup', { error: code }), { status: 303 });
  }
}
