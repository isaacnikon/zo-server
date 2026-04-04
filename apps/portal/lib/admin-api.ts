import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

import { ADMIN_COOKIE_NAME, isValidAdminToken } from './auth';
import { PortalDataError } from './portal-data';

function getStatusForCode(code: string) {
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

export function requireAdminApi(request: NextRequest) {
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

export async function readJsonBody<T extends Record<string, unknown> = Record<string, unknown>>(
  request: Request
): Promise<T> {
  try {
    return await request.json();
  } catch {
    return {} as T;
  }
}

export function portalDataErrorResponse(error: unknown) {
  const code =
    error instanceof PortalDataError && error.code
      ? error.code
      : 'mutation-failed';

  return NextResponse.json(
    {
      ok: false,
      error: code,
      message: String(error instanceof Error ? error.message : code),
    },
    { status: getStatusForCode(code) }
  );
}
