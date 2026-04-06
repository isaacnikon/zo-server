import { sendCombatEncounterProbe as combatHandlerSendCombatEncounterProbe } from '../handlers/combat-handler.js';
import type { GameSession, SessionPorts } from '../types.js';

/**
 * Start a combat encounter for a session. This is a gameplay-layer wrapper
 * around the combat handler's encounter probe logic, so that layer-2 code
 * (such as the quest runtime) can trigger encounters without holding a full
 * GameSession reference.
 *
 * The cast to GameSession is safe here because sendCombatEncounterProbe only
 * accesses fields and methods that are present on SessionPorts; the GameSession
 * type annotation on that function is wider than strictly necessary.
 */
export function startCombatEncounter(session: SessionPorts, action: Record<string, unknown>): void {
  combatHandlerSendCombatEncounterProbe(session as unknown as GameSession, action);
}
