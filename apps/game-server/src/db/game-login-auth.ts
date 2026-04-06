import crypto from 'node:crypto';

import { GAME_LOGIN_REQUIRE_PORTAL_AUTH } from '../config.js';
import { queryOnePostgres, queryOptionalScalarPostgres } from './postgres-pool.js';

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

async function getPortalAuthRecord(username: string): Promise<PortalAuthRecord | null> {
  const row = await queryOnePostgres<{
    account_id: string | null;
    username: string;
    game_password_md5: string | null;
  }>(
    `SELECT account_id, username, game_password_md5
     FROM portal_users
     WHERE LOWER(username) = LOWER($1)
        OR LOWER(COALESCE(account_id, '')) = LOWER($1)
     ORDER BY CASE
       WHEN username = $1 THEN 0
       WHEN account_id = $1 THEN 1
       WHEN LOWER(username) = LOWER($1) THEN 2
       ELSE 3
     END
     LIMIT 1`,
    [username]
  );
  if (!row) {
    return null;
  }
  return {
    accountId: row.account_id || row.username,
    username: row.username,
    gamePasswordMd5: row.game_password_md5,
  };
}

function getExistingLegacyAccount(username: string): Promise<string | null> {
  return queryOptionalScalarPostgres(
    `SELECT account_id
     FROM accounts
     WHERE LOWER(account_id) = LOWER($1)
     ORDER BY CASE WHEN account_id = $1 THEN 0 ELSE 1 END
     LIMIT 1`,
    [username]
  );
}

export async function authenticateGameLogin(input: {
  username: unknown;
  passwordDigest: unknown;
}): Promise<GameLoginAuthResult> {
  const username = normalizeText(input.username);
  const passwordDigest = normalizeGamePasswordDigest(input.passwordDigest);

  if (!username) {
    return {
      ok: false,
      reason: 'invalid-login-packet',
    };
  }

  const portalUser = await getPortalAuthRecord(username);
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

  const legacyAccountId = await getExistingLegacyAccount(username);
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
