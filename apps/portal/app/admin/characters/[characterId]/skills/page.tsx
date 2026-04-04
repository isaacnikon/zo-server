import AdminCharacterWorkspace from '../../../../../components/admin-character-workspace';
import AdminPageFrame from '../../../../../components/admin-page-frame';
import AdminSidebar from '../../../../../components/admin-sidebar';
import AdminSignOutForm from '../../../../../components/admin-signout-form';
import {
  buildCharacterBasePath,
  pickSingle,
  requireAdminSession,
} from '../../../../../lib/admin-portal';
import {
  getCharacterProfile,
  listCharacters,
  listMapCatalog,
} from '../../../../../lib/portal-data';

export const dynamic = 'force-dynamic';

export default async function AdminCharacterSkillsPage({ params, searchParams }) {
  await requireAdminSession();

  const resolvedParams = await params;
  const resolvedSearchParams = await searchParams;
  const characterId = pickSingle(resolvedParams?.characterId).trim();
  const query = pickSingle(resolvedSearchParams?.q).trim();

  const [characters, profile, mapCatalog] = await Promise.all([
    listCharacters(query),
    getCharacterProfile(characterId),
    listMapCatalog(),
  ]);

  return (
    <AdminPageFrame
      actions={<AdminSignOutForm />}
      description={
        profile
          ? 'Skill definitions, learned levels, and hotbar bindings now live on their own page.'
          : 'The requested character could not be found.'
      }
      eyebrow="Character / Skills"
      sidebar={
        <AdminSidebar
          characters={characters}
          characterSection="skills"
          query={query}
          section="characters"
          selectedCharacterId={characterId}
          selectedCharacterName={profile?.char_name || characterId}
        />
      }
      title={profile ? `${profile.char_name} skills` : 'Character not found'}
    >
      {!profile ? (
        <section className="panel profile-empty-panel">
          <p className="eyebrow">Unavailable</p>
          <h2>Character not found</h2>
          <p className="lede">Search for another character from the left rail.</p>
        </section>
      ) : (
        <AdminCharacterWorkspace
          basePath={buildCharacterBasePath(profile.character_id)}
          mapCatalog={mapCatalog}
          profile={profile}
          view="skills"
        />
      )}
    </AdminPageFrame>
  );
}
