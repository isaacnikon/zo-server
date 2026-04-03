import Link from 'next/link';
import { cookies } from 'next/headers';

import AdminCharacterWorkspace from '../../components/admin-character-workspace.js';
import AdminMapRouteWorkspace from '../../components/admin-map-route-workspace.js';
import { ADMIN_COOKIE_NAME, isValidAdminToken } from '../../lib/auth.js';
import {
  getAdminDashboard,
  getCharacterProfile,
  listCharacters,
  listMapCatalog,
  listMapRoutes,
} from '../../lib/portal-data.js';

export const dynamic = 'force-dynamic';

function pickSingle(value) {
  return Array.isArray(value) ? value[0] || '' : value || '';
}

function buildAdminPath(query, characterId) {
  const params = new URLSearchParams();
  if (query) {
    params.set('q', query);
  }
  if (characterId) {
    params.set('characterId', characterId);
  }
  const search = params.toString();
  return search ? `/admin?${search}` : '/admin';
}

function getAdminMessage(searchParams) {
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

function formatDate(value) {
  if (!value) {
    return 'n/a';
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
  }
}

function LoginView({ message }) {
  return (
    <main className="page-grid">
      <section className="hero-card">
        <p className="eyebrow">Restricted Access</p>
        <h1>Admin Access</h1>
        <p className="lede">Use the admin token to open the control panel.</p>
      </section>

      <section className="panel admin-auth-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Restricted Access</p>
            <h2>Admin sign-in</h2>
          </div>
          <p className="hint">
            The current version uses `ADMIN_PORTAL_TOKEN`. Redis-backed admin sessions are unnecessary at
            this stage because there is no live traffic and only one portal instance.
          </p>
        </div>

        {message ? (
          <p className={`status-banner ${message.tone}`}>{message.text}</p>
        ) : null}

        <form action="/api/admin/session" className="stack-form" method="post">
          <label className="field">
            <span>Admin token</span>
            <input
              autoComplete="current-password"
              name="token"
              placeholder="Paste ADMIN_PORTAL_TOKEN"
              required
              type="password"
            />
          </label>
          <input name="redirectTo" type="hidden" value="/admin" />
          <button className="primary-button" type="submit">
            Open Admin Portal
          </button>
        </form>
      </section>
    </main>
  );
}

export default async function AdminPage({ searchParams }) {
  const cookieStore = await cookies();
  const adminToken = cookieStore.get(ADMIN_COOKIE_NAME)?.value || '';
  const resolvedSearchParams = await searchParams;
  const message = getAdminMessage(resolvedSearchParams);

  if (!isValidAdminToken(adminToken)) {
    return <LoginView message={message} />;
  }

  const query = pickSingle(resolvedSearchParams?.q).trim();
  const characterId = pickSingle(resolvedSearchParams?.characterId).trim();
  const [dashboard, characters, profile, mapCatalog, mapRoutes] = await Promise.all([
    getAdminDashboard(),
    listCharacters(query),
    characterId ? getCharacterProfile(characterId) : Promise.resolve(null),
    listMapCatalog(),
    listMapRoutes(),
  ]);

  return (
    <main className="admin-page">
      <section className="hero-card admin-hero">
        <div className="section-heading">
          <div>
            <h1>Admin Portal</h1>
          </div>
          <form action="/api/admin/session/logout" method="post">
            <button className="secondary-button" type="submit">
              Sign Out
            </button>
          </form>
        </div>
        <p className="lede">Live operations, character management, and player visibility in one place.</p>
        <div className="hero-metrics">
          <article className="stat-card compact-stat-card">
            <span>Total accounts</span>
            <strong>{dashboard.totalAccounts}</strong>
          </article>
          <article className="stat-card compact-stat-card">
            <span>Portal users</span>
            <strong>{dashboard.totalPortalUsers}</strong>
          </article>
          <article className="stat-card compact-stat-card">
            <span>Total characters</span>
            <strong>{dashboard.totalCharacters}</strong>
          </article>
          <article className="stat-card compact-stat-card">
            <span>Logged in players</span>
            <strong>{dashboard.loggedInPlayers}</strong>
          </article>
        </div>
      </section>

      {message ? (
        <p className={`status-banner ${message.tone}`}>{message.text}</p>
      ) : null}

      <section className="ops-grid">
        <aside className="control-rail">
          <section className="panel rail-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Lookup</p>
                <h2>Character search</h2>
              </div>
              <span className="rail-count">{characters.length} shown</span>
            </div>
            <form action="/admin" className="inline-form admin-search-form" method="get">
              <input
                defaultValue={query}
                name="q"
                placeholder="Search by character or account"
                type="text"
              />
              <button className="primary-button" type="submit">
                Search
              </button>
            </form>
            <div className="list-stack rail-list">
              {characters.length < 1 ? (
                <article className="list-card muted-card">No characters matched the current search.</article>
              ) : (
                characters.map((character) => (
                  <Link
                    className={`list-card character-card ${character.character_id === profile?.character_id ? 'selected-card' : ''}`}
                    href={buildAdminPath(query, character.character_id)}
                    key={character.character_id}
                  >
                    <div className="character-card-row">
                      <div>
                        <strong>{character.char_name}</strong>
                        <p>{character.account_id}</p>
                      </div>
                      <span className={`pill ${character.is_online ? 'pill-live' : 'pill-idle'}`}>
                        {character.is_online ? 'Online' : 'Offline'}
                      </span>
                    </div>
                    <p>
                      Level {character.level} on {character.map_name} at {character.x}, {character.y}
                    </p>
                  </Link>
                ))
              )}
            </div>
          </section>

          <section className="panel rail-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Live Runtime</p>
                <h2>Online players</h2>
              </div>
              <span className="rail-count">{dashboard.onlinePlayers.length} live</span>
            </div>
            <div className="list-stack rail-list compact-rail-list">
              {dashboard.onlinePlayers.length < 1 ? (
                <article className="muted-card">No active world sessions are currently recorded.</article>
              ) : (
                dashboard.onlinePlayers.map((player) => (
                  <article className="list-card compact-card" key={player.character_id}>
                    <div className="character-card-row">
                      <div>
                        <strong>{player.char_name}</strong>
                        <p>{player.account_id}</p>
                      </div>
                      <span className="pill pill-live">Live</span>
                    </div>
                    <p>
                      {player.map_name} at {player.x}, {player.y}
                    </p>
                    <p>Updated {formatDate(player.updated_at)}</p>
                  </article>
                ))
              )}
            </div>
          </section>

          <section className="panel rail-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Recent Writes</p>
                <h2>Freshly updated characters</h2>
              </div>
            </div>
            <div className="list-stack rail-list compact-rail-list">
              {dashboard.recentCharacters.map((character) => (
                <Link
                  className="list-card compact-card"
                  href={buildAdminPath(query, character.character_id)}
                  key={character.character_id}
                >
                  <strong>{character.char_name}</strong>
                  <p>{character.account_id}</p>
                  <p>
                    Level {character.level} · {character.map_name}
                  </p>
                  <p>Updated {formatDate(character.updated_at)}</p>
                </Link>
              ))}
            </div>
          </section>
        </aside>

        <section className="profile-stack">
          {!profile ? (
            <section className="panel profile-empty-panel">
              <p className="eyebrow">Character Workspace</p>
              <h2>Select a character</h2>
              <p className="lede">
                Choose a character from the search rail to inspect vitals, inventory, skills, and mutation tools.
              </p>
            </section>
          ) : (
            <AdminCharacterWorkspace mapCatalog={mapCatalog} profile={profile} />
          )}

          <AdminMapRouteWorkspace mapCatalog={mapCatalog} routes={mapRoutes} />
        </section>
      </section>
    </main>
  );
}
