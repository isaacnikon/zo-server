import crypto from 'node:crypto';

export const ADMIN_COOKIE_NAME = 'zo_admin_session';
export const ADMIN_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/',
  secure: process.env.ADMIN_COOKIE_SECURE === '1',
  maxAge: 60 * 60 * 12,
};

export function isValidAdminToken(candidate) {
  const expected = String(process.env.ADMIN_PORTAL_TOKEN || 'change-me-dev-token').trim();
  const actual = String(candidate || '').trim();
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(actual);

  if (expectedBuffer.length < 1 || expectedBuffer.length !== actualBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return { salt, hash };
}

export function createGamePasswordDigest(password) {
  return crypto.createHash('md5').update(String(password || ''), 'utf8').digest('hex').toUpperCase();
}
