import type { GameSession } from '../types.js';
type UnknownRecord = Record<string, any>;

type DirtyFlags = {
  statsDirty?: boolean;
  stateDirty?: boolean;
  inventoryDirty?: boolean;
};

type DispatchOptions = {
  suppressPackets?: boolean;
  suppressDialogues?: boolean;
  suppressStatSync?: boolean;
  selectedAwardId?: number;
};

interface ObjectiveEventHandler<TEvent> {
  describeEvent?(event: TEvent, source: string): string | null;
  dispatch(session: GameSession, event: TEvent, source: string, options: DispatchOptions): DirtyFlags;
}

function applyObjectiveEvents<TEvent>(
  session: GameSession,
  events: TEvent[],
  handler: ObjectiveEventHandler<TEvent>,
  source: string,
  options: DispatchOptions = {}
): DirtyFlags {
  if (!Array.isArray(events) || events.length === 0) {
    return {};
  }

  let statsDirty = false;
  let stateDirty = false;
  let inventoryDirty = false;

  for (const event of events) {
    const description = handler.describeEvent?.(event, source);
    if (description) {
      session.log(description);
    }

    const result = handler.dispatch(session, event, source, options);
    statsDirty = statsDirty || result.statsDirty === true;
    stateDirty = stateDirty || result.stateDirty === true;
    inventoryDirty = inventoryDirty || result.inventoryDirty === true;
  }

  if (statsDirty && options.suppressStatSync !== true) {
    session.sendSelfStateAptitudeSync();
  }

  if (stateDirty || statsDirty || inventoryDirty) {
    session.persistCurrentCharacter();
  }

  return {
    statsDirty,
    stateDirty,
    inventoryDirty,
  };
}

export {
  applyObjectiveEvents,
};

export type {
  DirtyFlags,
  DispatchOptions,
  ObjectiveEventHandler,
};
