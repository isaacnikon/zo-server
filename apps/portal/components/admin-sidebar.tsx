import Link from 'next/link';

import {
  buildCharacterDirectoryPath,
  buildCharacterSectionPath,
} from '../lib/admin-portal';

function NavCard({ href, title, detail, active = false }) {
  return (
    <Link className={`admin-nav-card ${active ? 'admin-nav-card-active' : ''}`} href={href}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </Link>
  );
}

export default function AdminSidebar({
  section,
  query = '',
  characters = [],
  selectedCharacterId = '',
  selectedCharacterName = '',
  characterSection = 'overview',
  children = null,
}) {
  return (
    <div className="admin-sidebar-stack">
      <section className="panel admin-nav-panel">
        <div className="admin-nav-heading">
          <p className="eyebrow">Admin Pages</p>
          <h2>Navigate</h2>
        </div>

        <div className="admin-nav-list">
          <NavCard
            active={section === 'dashboard'}
            detail="Health, live activity, and shortcuts."
            href="/admin"
            title="Dashboard"
          />
          <NavCard
            active={section === 'characters'}
            detail="Search characters and open focused tools."
            href={buildCharacterDirectoryPath(query)}
            title="Character"
          />
          <NavCard
            active={section === 'maps'}
            detail="Review and edit route links."
            href="/admin/maps"
            title="Maps"
          />
          <NavCard
            active={section === 'quests'}
            detail="Review quest definitions and live adoption."
            href="/admin/quests"
            title="Quests"
          />
        </div>
      </section>

      {selectedCharacterId ? (
        <section className="panel admin-context-panel">
          <div className="admin-nav-heading">
            <p className="eyebrow">Character Pages</p>
            <h3>{selectedCharacterName || selectedCharacterId}</h3>
            <p className="hint">Move between the character overview and focused editing pages.</p>
          </div>

          <div className="admin-subnav-list">
            <Link
              className={`admin-subnav-link ${characterSection === 'overview' ? 'admin-subnav-link-active' : ''}`}
              href={buildCharacterSectionPath(selectedCharacterId, 'overview', query)}
            >
              Dashboard
            </Link>
            <Link
              className={`admin-subnav-link ${characterSection === 'items' ? 'admin-subnav-link-active' : ''}`}
              href={buildCharacterSectionPath(selectedCharacterId, 'items', query)}
            >
              Inventory Items
            </Link>
            <Link
              className={`admin-subnav-link ${characterSection === 'equipments' ? 'admin-subnav-link-active' : ''}`}
              href={buildCharacterSectionPath(selectedCharacterId, 'equipments', query)}
            >
              Equipments
            </Link>
            <Link
              className={`admin-subnav-link ${characterSection === 'skills' ? 'admin-subnav-link-active' : ''}`}
              href={buildCharacterSectionPath(selectedCharacterId, 'skills', query)}
            >
              Skills
            </Link>
          </div>
        </section>
      ) : null}

      {(section === 'characters' || selectedCharacterId) ? (
        <section className="panel admin-search-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Character Search</p>
              <h3>Directory</h3>
            </div>
            <span className="rail-count">{characters.length} shown</span>
          </div>

          <form action="/admin/characters" className="stack-form admin-sidebar-search" method="get">
            <label className="field">
              <span>Find a character</span>
              <input
                defaultValue={query}
                name="q"
                placeholder="Search by character, account, or map"
                type="text"
              />
            </label>
            <button className="primary-button" type="submit">
              Search
            </button>
          </form>

          <div className="admin-character-list">
            {characters.length < 1 ? (
              <article className="muted-card">No characters matched the current search.</article>
            ) : (
              characters.map((character) => (
                <Link
                  className={`admin-character-link ${
                    String(character.character_id) === String(selectedCharacterId) ? 'admin-character-link-active' : ''
                  }`}
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
                </Link>
              ))
            )}
          </div>
        </section>
      ) : null}

      {children}
    </div>
  );
}
