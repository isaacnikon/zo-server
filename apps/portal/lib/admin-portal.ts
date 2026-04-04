import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { ADMIN_COOKIE_NAME, isValidAdminToken } from './auth';

export function pickSingle(value) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

export function appendQuery(path: string, query?: string) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) {
    return path;
  }

  const params = new URLSearchParams();
  params.set('q', normalizedQuery);
  return `${path}?${params.toString()}`;
}

export function buildCharacterBasePath(characterId: string) {
  return `/admin/characters/${encodeURIComponent(characterId)}`;
}

export function buildCharacterSectionPath(
  characterId: string,
  section: 'overview' | 'items' | 'equipments' | 'skills' = 'overview',
  query?: string
) {
  const basePath = buildCharacterBasePath(characterId);

  if (section === 'overview') {
    return appendQuery(basePath, query);
  }

  if (section === 'skills') {
    return appendQuery(`${basePath}/skills`, query);
  }

  return appendQuery(`${basePath}/inventory/${section}`, query);
}

export function buildCharacterDirectoryPath(query?: string) {
  return appendQuery('/admin/characters', query);
}

export function getAdminMessage(searchParams) {
  const status = pickSingle(searchParams?.status);
  const error = pickSingle(searchParams?.error);

  if (status === 'logged-in') {
    return { tone: 'success', text: 'Admin session established.' };
  }
  if (status === 'logged-out') {
    return { tone: 'success', text: 'Admin session cleared.' };
  }
  if (status === 'item-added') {
    return { tone: 'success', text: 'Item added to the stored character inventory.' };
  }
  if (status === 'item-removed') {
    return { tone: 'success', text: 'Item removed from the stored character inventory.' };
  }
  if (error === 'invalid-admin-token') {
    return { tone: 'error', text: 'The admin token did not match ADMIN_PORTAL_TOKEN.' };
  }
  if (error === 'character-online') {
    return {
      tone: 'error',
      text: 'That character is currently online. Edit inventory only while the character is offline so the in-memory game session does not drift from the database.',
    };
  }
  if (error === 'character-not-found') {
    return { tone: 'error', text: 'The requested character does not exist.' };
  }
  if (error === 'inventory-item-not-found') {
    return { tone: 'error', text: 'That inventory entry was not found.' };
  }
  if (error === 'item-not-found') {
    return { tone: 'error', text: 'The requested item template does not exist in the imported static data.' };
  }
  if (error === 'invalid-item') {
    return { tone: 'error', text: 'Provide a valid template id, quantity, and inventory scope.' };
  }
  if (error === 'mutation-failed') {
    return { tone: 'error', text: 'The portal could not update that character. Check the portal logs for the database error.' };
  }

  return null;
}

export async function hasAdminSession() {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value || '';
  return isValidAdminToken(adminToken);
}

export async function requireAdminSession() {
  const validSession = await hasAdminSession();
  if (!validSession) {
    redirect('/admin?error=invalid-admin-token');
  }
}
