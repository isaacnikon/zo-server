import type { GameSession } from '../types.js';

import { CHARACTER_STORE_BACKEND } from '../config.js';
import { executePostgresSql } from './postgres-cli.js';
import { sqlInteger, sqlText } from './sql-literals.js';

function isDatabaseBacked(): boolean {
  return CHARACTER_STORE_BACKEND === 'db';
}

export function clearRuntimeOnlinePlayers(): void {
  if (!isDatabaseBacked()) {
    return;
  }
  executePostgresSql('DELETE FROM runtime_online_players;');
}

export function upsertRuntimeOnlinePlayer(session: GameSession): void {
  if (!isDatabaseBacked()) {
    return;
  }
  const accountId = typeof session.accountName === 'string' && session.accountName.length > 0
    ? session.accountName
    : null;
  if (!accountId || !session.charName) {
    return;
  }
  const characterId = session.getPersistedCharacter?.() && typeof session.getPersistedCharacter() === 'object'
    ? String((session.getPersistedCharacter() as Record<string, unknown>)?.characterId || session.charName)
    : session.charName;
  executePostgresSql(
    `INSERT INTO runtime_online_players (
      character_id,
      account_id,
      session_id,
      char_name,
      map_id,
      x,
      y,
      login_at,
      updated_at
    ) VALUES (
      ${sqlText(characterId)},
      ${sqlText(accountId)},
      ${sqlInteger(session.id, 0)},
      ${sqlText(session.charName)},
      ${sqlInteger(session.currentMapId, 0)},
      ${sqlInteger(session.currentX, 0)},
      ${sqlInteger(session.currentY, 0)},
      NOW(),
      NOW()
    )
    ON CONFLICT (character_id) DO UPDATE
    SET account_id = EXCLUDED.account_id,
        session_id = EXCLUDED.session_id,
        char_name = EXCLUDED.char_name,
        map_id = EXCLUDED.map_id,
        x = EXCLUDED.x,
        y = EXCLUDED.y,
        updated_at = NOW();`
  );
}

export function removeRuntimeOnlinePlayer(session: GameSession): void {
  if (!isDatabaseBacked()) {
    return;
  }
  const persisted = session.getPersistedCharacter?.();
  const characterId =
    persisted && typeof persisted === 'object' && typeof (persisted as Record<string, unknown>)?.characterId === 'string'
      ? String((persisted as Record<string, unknown>).characterId)
      : session.charName;
  if (!characterId) {
    return;
  }
  executePostgresSql(
    `DELETE FROM runtime_online_players WHERE character_id = ${sqlText(characterId)};`
  );
}
