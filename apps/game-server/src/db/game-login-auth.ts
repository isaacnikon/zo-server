import crypto from 'node:crypto';

import { GAME_LOGIN_REQUIRE_PORTAL_AUTH } from '../config.js';
import { queryOptionalJson, queryOptionalScalar } from './postgres-cli.js';
import { sqlText } from './sql-literals.js';

type PortalAuthRecord = {
  accountId: string;
  username: string;
  gamePasswordMd5: string | null;
};

export type GameLoginAuthResult =
  | {
      ok: true;
      accountId: string;
      accountKey: string;
      mode: 'portal' | 'legacy';
    }
  | {
      ok: false;
      reason: 'invalid-credentials' | 'portal-account-required' | 'invalid-login-packet';
    };

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeGamePasswordDigest(value: unknown): string {
  const normalized = normalizeText(value).toUpperCase();
  return /^[0-9A-F]{32}$/.test(normalized) ? normalized : '';
}

function timingSafeDigestEquals(expected: string, actual: string): boolean {
  const expectedBuffer = Buffer.from(expected, 'utf8');
  const actualBuffer = Buffer.from(actual, 'utf8');
  if (expectedBuffer.length !== actualBuffer.length || expectedBuffer.length < 1) {
    return false;
  }
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

function getPortalAuthRecord(username: string): PortalAuthRecord | null {
  return queryOptionalJson<PortalAuthRecord>(
    `SELECT json_build_object(
      'accountId', COALESCE(account_id, username),
      'username', username,
      'gamePasswordMd5', game_password_md5
    )
    FROM portal_users
    WHERE username = ${sqlText(username)}
       OR account_id = ${sqlText(username)}
    ORDER BY CASE WHEN username = ${sqlText(username)} THEN 0 ELSE 1 END
    LIMIT 1`
  );
}

function getExistingLegacyAccount(username: string): string | null {
  return queryOptionalScalar(
    `SELECT account_id
     FROM accounts
     WHERE account_id = ${sqlText(username)}
     LIMIT 1`
  );
}

export function authenticateGameLogin(input: {
  username: unknown;
  passwordDigest: unknown;
}): GameLoginAuthResult {
  const username = normalizeText(input.username);
  const passwordDigest = normalizeGamePasswordDigest(input.passwordDigest);

  if (!username) {
    return {
      ok: false,
      reason: 'invalid-login-packet',
    };
  }

  const portalUser = getPortalAuthRecord(username);
  if (portalUser) {
    const expectedDigest = normalizeGamePasswordDigest(portalUser.gamePasswordMd5);
    if (!expectedDigest || !passwordDigest || !timingSafeDigestEquals(expectedDigest, passwordDigest)) {
      return {
        ok: false,
        reason: 'invalid-credentials',
      };
    }
    const accountId = normalizeText(portalUser.accountId) || username;
    return {
      ok: true,
      accountId,
      accountKey: accountId,
      mode: 'portal',
    };
  }

  const legacyAccountId = getExistingLegacyAccount(username);
  if (legacyAccountId) {
    return {
      ok: true,
      accountId: legacyAccountId,
      accountKey: legacyAccountId,
      mode: 'legacy',
    };
  }

  if (GAME_LOGIN_REQUIRE_PORTAL_AUTH) {
    return {
      ok: false,
      reason: 'portal-account-required',
    };
  }

  return {
    ok: true,
    accountId: username,
    accountKey: username,
    mode: 'legacy',
  };
}
