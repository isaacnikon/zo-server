import { numberOrDefault } from '../utils.js';
import { isQuest2DefinitionId } from './definitions.js';

type LegacyQuestIdRecord = {
  id?: unknown;
};

function filterLegacyQuestRecords<T extends LegacyQuestIdRecord>(
  records: readonly T[] | null | undefined
): T[] {
  if (!Array.isArray(records) || records.length < 1) {
    return [];
  }
  return records.filter((record) => !isQuest2DefinitionId(numberOrDefault(record?.id, 0)));
}

function filterLegacyCompletedQuestIds(questIds: readonly number[] | null | undefined): number[] {
  if (!Array.isArray(questIds) || questIds.length < 1) {
    return [];
  }
  return questIds.filter((questId) => Number.isInteger(questId) && !isQuest2DefinitionId(questId >>> 0));
}

export {
  filterLegacyQuestRecords,
  filterLegacyCompletedQuestIds,
};
