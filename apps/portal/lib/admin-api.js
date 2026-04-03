import { NextResponse } from 'next/server';

import { ADMIN_COOKIE_NAME, isValidAdminToken } from './auth.js';
import { PortalDataError } from './portal-data.js';

function getStatusForCode(code) {
  if (code === 'invalid-admin-token') {
    return 401;
  }
  if (code === 'character-online') {
    return 409;
  }
  if (code === 'character-live-timeout') {
    return 504;
  }
  if (code.startsWith('invalid-')) {
    return 400;
  }
  if (code.endsWith('not-found')) {
    return 404;
  }
  return 500;
}

export function requireAdminApi(request) {
  const adminToken = request.cookies.get(ADMIN_COOKIE_NAME)?.value || '';
  if (!isValidAdminToken(adminToken)) {
    return NextResponse.json(
      {
        ok: false,
        error: 'invalid-admin-token',
      },
      { status: 401 }
    );
  }

  return null;
}

export async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export function portalDataErrorResponse(error) {
  const code =
    error instanceof PortalDataError && error.code
      ? error.code
      : 'mutation-failed';

  return NextResponse.json(
    {
      ok: false,
      error: code,
      message: String(error?.message || code),
    },
    { status: getStatusForCode(code) }
  );
}
