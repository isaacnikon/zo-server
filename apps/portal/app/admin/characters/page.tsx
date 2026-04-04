import Link from 'next/link';

import AdminPageFrame from '../../../components/admin-page-frame';
import AdminSidebar from '../../../components/admin-sidebar';
import AdminSignOutForm from '../../../components/admin-signout-form';
import {
  buildCharacterSectionPath,
  pickSingle,
  requireAdminSession,
} from '../../../lib/admin-portal';
import { listCharacters } from '../../../lib/portal-data';

export const dynamic = 'force-dynamic';

export default async function AdminCharactersPage({ searchParams }) {
  await requireAdminSession();

  const resolvedSearchParams = await searchParams;
  const query = pickSingle(resolvedSearchParams?.q).trim();
  const characters = await listCharacters(query);
  const onlineCount = characters.filter((character) => character.is_online).length;

  return (
    <AdminPageFrame
      actions={<AdminSignOutForm />}
      description="Open a character first, then move into focused pages for overview, inventory items, equipments, or skills."
      eyebrow="Character"
      sidebar={<AdminSidebar characters={characters} query={query} section="characters" />}
      title="Character directory"
    >
      <section className="directory-summary-grid">
        <article className="snapshot-card directory-summary-card">
          <span>Shown</span>
          <strong>{characters.length}</strong>
          <p>Current search results across character name, account, and map.</p>
        </article>
        <article className="snapshot-card directory-summary-card">
          <span>Online</span>
          <strong>{onlineCount}</strong>
          <p>Characters with a currently tracked runtime session.</p>
        </article>
        <article className="snapshot-card directory-summary-card">
          <span>Offline</span>
          <strong>{Math.max(characters.length - onlineCount, 0)}</strong>
          <p>Stored characters available for offline-only edits.</p>
        </article>
      </section>

      <section className="panel directory-panel">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Selection</p>
            <h2>Pick a character</h2>
          </div>
          <span className="rail-count">{characters.length} shown</span>
        </div>

        <p className="hint">
          The left rail keeps the search form and quick directory visible. Use the cards below when you want a larger browsing surface.
        </p>

        {characters.length < 1 ? (
          <article className="muted-card">No characters matched the current search.</article>
        ) : (
          <div className="directory-card-grid">
            {characters.map((character) => (
              <Link
                className="directory-card"
                href={buildCharacterSectionPath(character.character_id, 'overview', query)}
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
                  Level {character.level} on {character.map_name}
                </p>
                <p>
                  Position {character.x}, {character.y}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </AdminPageFrame>
  );
}
