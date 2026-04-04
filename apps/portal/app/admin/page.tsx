import Link from 'next/link';

import AdminLoginView from '../../components/admin-login-view';
import AdminPageFrame from '../../components/admin-page-frame';
import AdminSidebar from '../../components/admin-sidebar';
import AdminSignOutForm from '../../components/admin-signout-form';
import { formatAdminDate } from '../../lib/format';
import {
  buildCharacterSectionPath,
  getAdminMessage,
  hasAdminSession,
  pickSingle,
} from '../../lib/admin-portal';
import { getAdminDashboard } from '../../lib/portal-data';

export const dynamic = 'force-dynamic';

export default async function AdminPage({ searchParams }) {
  const resolvedSearchParams = await searchParams;
  const message = getAdminMessage(resolvedSearchParams);
  const validSession = await hasAdminSession();

  if (!validSession) {
    return <AdminLoginView message={message} />;
  }

  const dashboard = await getAdminDashboard();
  const selectedHighlight = dashboard.onlinePlayers[0] || dashboard.recentCharacters[0] || null;
  const query = pickSingle(resolvedSearchParams?.q).trim();

  return (
    <AdminPageFrame
      actions={<AdminSignOutForm />}
      description="Use focused pages for character editing, map routing, and quest review instead of a single overloaded operations screen."
      eyebrow="Dashboard"
      message={message}
      sidebar={<AdminSidebar query={query} section="dashboard" />}
      title="Portal operations"
    >
      <section className="dashboard-grid">
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
      </section>

      <section className="dashboard-columns">
        <section className="panel dashboard-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Live Activity</p>
              <h2>Online players</h2>
            </div>
            <span className="rail-count">{dashboard.onlinePlayers.length} live</span>
          </div>

          <div className="dashboard-list">
            {dashboard.onlinePlayers.length < 1 ? (
              <article className="muted-card">No active world sessions are currently recorded.</article>
            ) : (
              dashboard.onlinePlayers.map((player) => (
                <Link
                  className="list-card compact-card"
                  href={buildCharacterSectionPath(player.character_id, 'overview')}
                  key={player.character_id}
                >
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
                  <p>Updated {formatAdminDate(player.updated_at)}</p>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="panel dashboard-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent Writes</p>
              <h2>Latest character updates</h2>
            </div>
            <span className="rail-count">{dashboard.recentCharacters.length} tracked</span>
          </div>

          <div className="dashboard-list">
            {dashboard.recentCharacters.length < 1 ? (
              <article className="muted-card">No character writes have been recorded yet.</article>
            ) : (
              dashboard.recentCharacters.map((character) => (
                <Link
                  className="list-card compact-card"
                  href={buildCharacterSectionPath(character.character_id, 'overview')}
                  key={character.character_id}
                >
                  <strong>{character.char_name}</strong>
                  <p>{character.account_id}</p>
                  <p>
                    Level {character.level} on {character.map_name}
                  </p>
                  <p>Updated {formatAdminDate(character.updated_at)}</p>
                </Link>
              ))
            )}
          </div>
        </section>
      </section>

      <section className="dashboard-shortcut-grid">
        <Link className="panel dashboard-shortcut-card" href="/admin/characters">
          <p className="eyebrow">Character tools</p>
          <h3>Open focused editors</h3>
          <p className="hint">
            Search for a character, then move through overview, inventory items, equipments, and skills without carrying the whole admin surface on one page.
          </p>
        </Link>

        <Link className="panel dashboard-shortcut-card" href="/admin/maps">
          <p className="eyebrow">Maps</p>
          <h3>Maintain route data</h3>
          <p className="hint">
            Map routing now lives on its own page so route changes stop competing with character administration.
          </p>
        </Link>

        <Link className="panel dashboard-shortcut-card" href="/admin/quests">
          <p className="eyebrow">Quests</p>
          <h3>Review quest flow</h3>
          <p className="hint">
            Quest definitions and adoption now sit on their own page, with search, category filters, and drill-in detail.
          </p>
        </Link>

        <article className="panel dashboard-shortcut-card">
          <p className="eyebrow">Current highlight</p>
          <h3>{selectedHighlight ? selectedHighlight.char_name : 'No current highlight'}</h3>
          <p className="hint">
            {selectedHighlight
              ? `Most recent activity is tied to ${selectedHighlight.account_id}.`
              : 'Once activity appears, the latest live or persisted character update will surface here.'}
          </p>
        </article>
      </section>
    </AdminPageFrame>
  );
}
