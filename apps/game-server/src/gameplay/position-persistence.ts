import { resolveTownCheckpoint } from './session-flows.js';
import type { GameSession, PositionUpdate } from '../types.js';

type PositionSnapshot = Pick<PositionUpdate, 'mapId' | 'x' | 'y'>;

export function persistSessionPosition(session: GameSession, position: PositionSnapshot): void {
  const checkpoint = resolveTownCheckpoint({
    persistedCharacter: session.getPersistedCharacter?.() || null,
    currentMapId: position.mapId >>> 0,
    currentX: position.x >>> 0,
    currentY: position.y >>> 0,
  });

  session.persistCurrentCharacter({
    mapId: position.mapId >>> 0,
    x: position.x >>> 0,
    y: position.y >>> 0,
    lastTownMapId: checkpoint.mapId,
    lastTownX: checkpoint.x,
    lastTownY: checkpoint.y,
  });
}

