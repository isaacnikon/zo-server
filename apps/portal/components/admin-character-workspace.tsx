'use client';

import Link from 'next/link';
import { startTransition, useDeferredValue, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import { formatAdminDate, formatAdminNumber } from '../lib/format';

const ITEM_SEARCH_DEBOUNCE_MS = 180;
const SKILL_SEARCH_DEBOUNCE_MS = 180;

function formatNumber(value) {
  return formatAdminNumber(value);
}

function toFieldValue(value, fallback = '') {
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function formatMapLabel(map) {
  return `${map.map_name} (#${map.map_id})`;
}

function isEquipment(item) {
  return item?.is_equipment || item?.item_kind === 'weapon' || item?.item_kind === 'armor' || item?.equip_slot_field != null;
}

function hasMeaningfulDescription(value) {
  if (!value) {
    return false;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 && normalized.toLowerCase() !== 'an item in zodiac online';
}

function getAdminMessage(code) {
  switch (code) {
    case 'invalid-admin-token':
      return 'The admin session expired. Reload and sign in again.';
    case 'character-online':
      return 'That character is online and the live server rejected the change.';
    case 'character-live-timeout':
      return 'The live server did not confirm the update in time. Refresh to see whether it eventually applied.';
    case 'character-not-found':
      return 'The selected character no longer exists.';
    case 'inventory-item-not-found':
      return 'That inventory entry could not be found.';
    case 'item-not-found':
      return 'The selected item template does not exist in the catalog.';
    case 'skill-not-found':
      return 'The selected skill does not exist in the catalog.';
    case 'invalid-item':
      return 'Review the item fields. One or more values are invalid for the stored schema.';
    case 'invalid-skill':
      return 'Review the skill fields. One or more values are invalid.';
    case 'invalid-character':
      return 'Review the character values. Every field in the profile editor must be valid.';
    default:
      return 'The portal could not save that change. Check the container logs if it persists.';
  }
}

function createProfileDraft(profile) {
  return {
    level: toFieldValue(profile.level),
    experience: toFieldValue(profile.experience, '0'),
    gold: toFieldValue(profile.gold, '0'),
    bankGold: toFieldValue(profile.bank_gold, '0'),
    boundGold: toFieldValue(profile.bound_gold, '0'),
    coins: toFieldValue(profile.coins, '0'),
    renown: toFieldValue(profile.renown, '0'),
    statusPoints: toFieldValue(profile.status_points, '0'),
    mapId: toFieldValue(profile.map_id, '0'),
    x: toFieldValue(profile.x, '0'),
    y: toFieldValue(profile.y, '0'),
    currentHealth: toFieldValue(profile.current_health, '0'),
    currentMana: toFieldValue(profile.current_mana, '0'),
    currentRage: toFieldValue(profile.current_rage, '0'),
    maxHealth: toFieldValue(profile.max_health, '0'),
    maxMana: toFieldValue(profile.max_mana, '0'),
    maxRage: toFieldValue(profile.max_rage, '0'),
    strength: toFieldValue(profile.strength, '0'),
    dexterity: toFieldValue(profile.dexterity, '0'),
    vitality: toFieldValue(profile.vitality, '0'),
    intelligence: toFieldValue(profile.intelligence, '0'),
  };
}

function createBlankItemDraft() {
  return {
    currentInventoryScope: 'bag',
    inventoryScope: 'bag',
    templateId: '',
    quantity: '1',
    slot: '',
    durability: '',
    tradeState: '0',
    bindState: '0',
    refineLevel: '',
    stateCode: '',
    extraValue: '',
    enhancementGrowthId: '',
    enhancementCurrentExp: '',
    enhancementSoulPoints: '',
    enhancementAptitudeGrowth: '',
    enhancementUnknown13: '',
    equipped: false,
    attributePairs: '[]',
  };
}

function createItemDraft(item) {
  if (!item) {
    return createBlankItemDraft();
  }

  return {
    currentInventoryScope: item.inventory_scope || 'bag',
    inventoryScope: item.inventory_scope || 'bag',
    templateId: toFieldValue(item.template_id),
    quantity: toFieldValue(item.quantity, '1'),
    slot: toFieldValue(item.slot, '0'),
    durability: toFieldValue(item.durability),
    tradeState: toFieldValue(item.trade_state, '0'),
    bindState: toFieldValue(item.bind_state, '0'),
    refineLevel: toFieldValue(item.refine_level),
    stateCode: toFieldValue(item.state_code),
    extraValue: toFieldValue(item.extra_value),
    enhancementGrowthId: toFieldValue(item.enhancement_growth_id),
    enhancementCurrentExp: toFieldValue(item.enhancement_current_exp),
    enhancementSoulPoints: toFieldValue(item.enhancement_soul_points),
    enhancementAptitudeGrowth: toFieldValue(item.enhancement_aptitude_growth),
    enhancementUnknown13: toFieldValue(item.enhancement_unknown13),
    equipped: Boolean(item.equipped),
    attributePairs: JSON.stringify(item.attribute_pairs || [], null, 2),
  };
}

function createItemDefinition(item) {
  if (!item) {
    return null;
  }

  return {
    template_id: item.template_id,
    name: item.item_name,
    item_kind: item.item_kind,
    max_stack: item.max_stack,
    container_type: item.container_type,
    equip_slot_field: item.equip_slot_field,
    description: item.item_description,
    is_equipment: isEquipment(item),
  };
}

function createBlankSkillDraft() {
  return {
    skillId: '',
    level: '1',
    proficiency: '0',
    hotbarSlot: '',
  };
}

function createSkillDraft(skill) {
  if (!skill) {
    return createBlankSkillDraft();
  }

  return {
    skillId: toFieldValue(skill.skill_id),
    level: toFieldValue(skill.level, '1'),
    proficiency: toFieldValue(skill.proficiency, '0'),
    hotbarSlot: toFieldValue(skill.hotbar_slot),
  };
}

function createSkillDefinition(skill) {
  if (!skill) {
    return null;
  }

  return {
    skill_id: skill.skill_id,
    name: skill.name,
    required_level: skill.required_level,
    required_attribute: skill.required_attribute,
    required_attribute_value: skill.required_attribute_value,
    template_id: skill.definition_template_id || skill.source_template_id || skill.template_id,
  };
}

function buildRequirementLabel(skill) {
  if (!skill?.required_level && !skill?.required_attribute) {
    return 'No requirement metadata stored.';
  }

  if (skill.required_attribute) {
    return `Level ${skill.required_level || 1} · ${skill.required_attribute} ${skill.required_attribute_value || 0}`;
  }

  return `Level ${skill.required_level || 1}`;
}

function getTradeStateMode(value) {
  const normalized = Number(value);
  if (value == null || value === '' || normalized === 0) {
    return 'tradable';
  }
  if (normalized === -2) {
    return 'bound';
  }
  if (Number.isInteger(normalized) && normalized > 0) {
    return 'timed';
  }
  return 'custom';
}

function getDefaultTimedTradeState() {
  return String(Math.floor(Date.now() / 1000) + 86400);
}

function describeTradeState(value) {
  const normalized = Number(value);
  if (value == null || value === '' || normalized === 0) {
    return 'Tradable. The client treats 0 as an open item state.';
  }
  if (normalized === -2) {
    return 'Permanently bound. The client checks for -2 on the 32-bit trade lock field.';
  }
  if (Number.isInteger(normalized) && normalized > 0) {
    const dateLabel = formatAdminDate(new Date(normalized * 1000).toISOString());
    const nowSeconds = Math.floor(Date.now() / 1000);
    return normalized <= nowSeconds
      ? `Timed lock with an expired Unix timestamp (${normalized}, ${dateLabel}). The client will now treat it as tradable.`
      : `Timed lock until ${dateLabel} (${normalized} Unix seconds).`;
  }
  return `Custom raw value ${String(value)}. The client only documents 0, -2, and positive Unix timestamps on this field.`;
}

function formatTradeStateBadge(value) {
  const normalized = Number(value);
  if (value == null || value === '' || normalized === 0) {
    return 'Tradable';
  }
  if (normalized === -2) {
    return 'Bound';
  }
  if (Number.isInteger(normalized) && normalized > 0) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    return normalized <= nowSeconds ? 'Timed lock expired' : `Timed until ${formatAdminDate(new Date(normalized * 1000).toISOString())}`;
  }
  return `Raw ${String(value)}`;
}

function getBindStateMode(value, equipment) {
  if (equipment) {
    return 'raw';
  }
  const normalized = Number(value);
  if (value == null || value === '' || normalized === 0) {
    return 'unbound';
  }
  if (normalized === 1) {
    return 'bound';
  }
  return 'raw';
}

function formatBindStateBadge(value, equipment) {
  const normalized = Number(value);
  if (value == null || value === '' || normalized === 0) {
    return equipment ? 'Payload 0' : 'Marker 0';
  }
  if (!equipment && normalized === 1) {
    return 'Marker 1';
  }
  if (equipment) {
    return `Payload ${String(value)}`;
  }
  return `Raw ${String(value)}`;
}

async function requestJson(url: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const payload = (await response.json().catch(() => ({}))) as any;
  if (!response.ok) {
    throw new Error(payload.error || 'mutation-failed');
  }

  return payload;
}

function ModalFrame({ title, eyebrow, description, onClose, wide = false, children }) {
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        aria-modal="true"
        className={`modal-shell ${wide ? 'modal-shell-wide' : ''}`}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
      >
        <div className="modal-header">
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h3>{title}</h3>
            {description ? <p className="hint modal-copy">{description}</p> : null}
          </div>
          <button className="secondary-button modal-close" onClick={onClose} type="button">
            Close
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({ label, children, wide = false }) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function InventoryEditorFields({
  draft,
  selectedItem,
  onChange,
  onTradeStateModeChange,
  onBindStateModeChange,
}) {
  const equipment = isEquipment(selectedItem) || draft.equipped;
  const tradeStateMode = getTradeStateMode(draft.tradeState);
  const bindStateMode = getBindStateMode(draft.bindState, equipment);

  return (
    <div className="editor-grid">
      <Field label="Storage">
        <select name="inventoryScope" onChange={onChange} value={draft.inventoryScope}>
          <option value="bag">Bag</option>
          <option value="warehouse">Warehouse</option>
        </select>
      </Field>
      <Field label="Slot">
        <input min="0" name="slot" onChange={onChange} placeholder="Auto" type="number" value={draft.slot} />
      </Field>
      <Field label="Quantity">
        <input min="1" name="quantity" onChange={onChange} required type="number" value={draft.quantity} />
      </Field>
      <Field label="State code">
        <input min="0" name="stateCode" onChange={onChange} type="number" value={draft.stateCode} />
      </Field>
      <Field label="Trade lock">
        <select onChange={(event) => onTradeStateModeChange(event.target.value)} value={tradeStateMode}>
          <option value="tradable">Tradable (0)</option>
          <option value="bound">Bound permanently (-2)</option>
          <option value="timed">Timed lock</option>
          <option value="custom">Custom raw value</option>
        </select>
      </Field>
      {tradeStateMode === 'timed' ? (
        <Field label="Unlock time (Unix seconds)">
          <input min="1" name="tradeState" onChange={onChange} type="number" value={draft.tradeState} />
        </Field>
      ) : tradeStateMode === 'custom' ? (
        <Field label="Raw trade value">
          <input min="-2" name="tradeState" onChange={onChange} type="number" value={draft.tradeState} />
        </Field>
      ) : (
        <Field label="Trade state raw">
          <input disabled name="tradeStatePreview" type="text" value={draft.tradeState} />
        </Field>
      )}
      <Field label={equipment ? 'Bind payload' : 'Bind marker'}>
        {equipment ? (
          <input min="0" name="bindState" onChange={onChange} type="number" value={draft.bindState} />
        ) : (
          <select onChange={(event) => onBindStateModeChange(event.target.value)} value={bindStateMode}>
            <option value="unbound">Marker 0</option>
            <option value="bound">Marker 1</option>
            <option value="raw">Custom raw value</option>
          </select>
        )}
      </Field>
      {!equipment && bindStateMode === 'raw' ? (
        <Field label="Raw bind value">
          <input min="0" name="bindState" onChange={onChange} type="number" value={draft.bindState} />
        </Field>
      ) : (
        <Field label={equipment ? 'Bind payload note' : 'Bind marker note'}>
          <input
            disabled
            name="bindStatePreview"
            type="text"
            value={
              equipment
                ? 'Equipment can reuse this byte as item payload.'
                : bindStateMode === 'bound'
                  ? '1 marks the lightweight bind flag.'
                  : '0 keeps the lightweight bind flag clear.'
            }
          />
        </Field>
      )}
      <Field label={equipment ? 'Durability' : 'Durability / uses'}>
        <input min="0" name="durability" onChange={onChange} type="number" value={draft.durability} />
      </Field>
      <Field label="Extra value">
        <input min="0" name="extraValue" onChange={onChange} type="number" value={draft.extraValue} />
      </Field>
      <Field label="Client state summary" wide>
        <div className="state-summary">
          <strong>{formatTradeStateBadge(draft.tradeState)}</strong>
          <p>{describeTradeState(draft.tradeState)}</p>
          <p>
            {equipment
              ? `Bind payload ${draft.bindState || '0'} is left raw for equipment because the client reuses that byte in equipment paths.`
              : `Bind marker ${draft.bindState || '0'} is separate from the permanent trade lock field.`}
          </p>
        </div>
      </Field>

      {equipment ? (
        <>
          <Field label="Refine level">
            <input min="0" name="refineLevel" onChange={onChange} type="number" value={draft.refineLevel} />
          </Field>
          <label className="toggle-field">
            <span>Equipped in stored snapshot</span>
            <input checked={draft.equipped} name="equipped" onChange={onChange} type="checkbox" />
          </label>
          <Field label="Enhancement growth ID">
            <input
              min="0"
              name="enhancementGrowthId"
              onChange={onChange}
              type="number"
              value={draft.enhancementGrowthId}
            />
          </Field>
          <Field label="Enhancement current EXP">
            <input
              min="0"
              name="enhancementCurrentExp"
              onChange={onChange}
              type="number"
              value={draft.enhancementCurrentExp}
            />
          </Field>
          <Field label="Enhancement soul points">
            <input
              min="0"
              name="enhancementSoulPoints"
              onChange={onChange}
              type="number"
              value={draft.enhancementSoulPoints}
            />
          </Field>
          <Field label="Enhancement aptitude growth">
            <input
              min="0"
              name="enhancementAptitudeGrowth"
              onChange={onChange}
              type="number"
              value={draft.enhancementAptitudeGrowth}
            />
          </Field>
          <Field label="Enhancement unknown13">
            <input
              min="0"
              name="enhancementUnknown13"
              onChange={onChange}
              type="number"
              value={draft.enhancementUnknown13}
            />
          </Field>
          <Field label="Attribute pairs JSON" wide>
            <textarea
              name="attributePairs"
              onChange={onChange}
              placeholder='[{"type":1,"value":10}]'
              rows={7}
              value={draft.attributePairs}
            />
          </Field>
        </>
      ) : null}
    </div>
  );
}

export default function AdminCharacterWorkspace({
  profile,
  mapCatalog = [],
  view = 'overview',
  basePath = '',
}) {
  const router = useRouter();
  const [feedback, setFeedback] = useState(null);
  const [activeModal, setActiveModal] = useState(null);
  const [busyAction, setBusyAction] = useState('');
  const [inventoryItems, setInventoryItems] = useState(() => profile.inventory || []);
  const [skillEntries, setSkillEntries] = useState(() => profile.skills || []);

  const [profileDraft, setProfileDraft] = useState(() => createProfileDraft(profile));
  const [itemDraft, setItemDraft] = useState(() => createBlankItemDraft());
  const [skillDraft, setSkillDraft] = useState(() => createBlankSkillDraft());

  const [selectedItemDefinition, setSelectedItemDefinition] = useState(null);
  const [selectedSkillDefinition, setSelectedSkillDefinition] = useState(null);
  const [editingItem, setEditingItem] = useState(null);
  const [editingSkill, setEditingSkill] = useState(null);

  const [itemSearch, setItemSearch] = useState('');
  const [itemResults, setItemResults] = useState([]);
  const [itemSearchPending, setItemSearchPending] = useState(false);
  const deferredItemSearch = useDeferredValue(itemSearch);
  const itemSearchRequestId = useRef(0);

  const [skillSearch, setSkillSearch] = useState('');
  const [skillResults, setSkillResults] = useState([]);
  const [skillSearchPending, setSkillSearchPending] = useState(false);
  const deferredSkillSearch = useDeferredValue(skillSearch);
  const skillSearchRequestId = useRef(0);

  useEffect(() => {
    setProfileDraft(createProfileDraft(profile));
    setInventoryItems(profile.inventory || []);
    setSkillEntries(profile.skills || []);
  }, [profile]);

  useEffect(() => {
    const searchingItems = activeModal === 'add-item' || activeModal === 'edit-item';
    if (!searchingItems) {
      setItemResults([]);
      setItemSearchPending(false);
      return;
    }

    const search = deferredItemSearch.trim();
    const searchLooksResolvable = /^\d+$/.test(search) || search.length >= 2;
    if (!search) {
      setItemResults([]);
      setItemSearchPending(false);
      return;
    }
    if (!searchLooksResolvable) {
      setItemSearchPending(false);
      return;
    }

    const controller = new AbortController();
    const requestId = ++itemSearchRequestId.current;
    const timer = setTimeout(() => {
      setItemSearchPending(true);
      requestJson(`/api/admin/items?search=${encodeURIComponent(search)}`, {
        signal: controller.signal,
      })
        .then((payload) => {
          if (requestId === itemSearchRequestId.current) {
            setItemResults(payload.items || []);
          }
        })
        .catch((error) => {
          if (error.name !== 'AbortError' && requestId === itemSearchRequestId.current) {
            setFeedback({ tone: 'error', text: getAdminMessage(error.message) });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && requestId === itemSearchRequestId.current) {
            setItemSearchPending(false);
          }
        });
    }, ITEM_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeModal, deferredItemSearch]);

  useEffect(() => {
    const searchingSkills = activeModal === 'add-skill';
    if (!searchingSkills) {
      setSkillResults([]);
      setSkillSearchPending(false);
      return;
    }

    const search = deferredSkillSearch.trim();
    const searchLooksResolvable = /^\d+$/.test(search) || search.length >= 2;
    if (!search) {
      setSkillResults([]);
      setSkillSearchPending(false);
      return;
    }
    if (!searchLooksResolvable) {
      setSkillSearchPending(false);
      return;
    }

    const controller = new AbortController();
    const requestId = ++skillSearchRequestId.current;
    const timer = setTimeout(() => {
      setSkillSearchPending(true);
      requestJson(`/api/admin/skills?search=${encodeURIComponent(search)}`, {
        signal: controller.signal,
      })
        .then((payload) => {
          if (requestId === skillSearchRequestId.current) {
            setSkillResults(payload.skills || []);
          }
        })
        .catch((error) => {
          if (error.name !== 'AbortError' && requestId === skillSearchRequestId.current) {
            setFeedback({ tone: 'error', text: getAdminMessage(error.message) });
          }
        })
        .finally(() => {
          if (!controller.signal.aborted && requestId === skillSearchRequestId.current) {
            setSkillSearchPending(false);
          }
        });
    }, SKILL_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeModal, deferredSkillSearch]);

  function closeModal() {
    setActiveModal(null);
    setBusyAction('');
  }

  function handleProfileChange(event) {
    const { name, value } = event.target;
    setProfileDraft((current) => ({ ...current, [name]: value }));
  }

  function handleItemChange(event) {
    const { name, value, type, checked } = event.target;
    setItemDraft((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }));
  }

  function handleTradeStateModeChange(mode) {
    setItemDraft((current) => {
      if (mode === 'tradable') {
        return { ...current, tradeState: '0' };
      }
      if (mode === 'bound') {
        return { ...current, tradeState: '-2' };
      }
      if (mode === 'timed') {
        const normalized = Number(current.tradeState);
        return {
          ...current,
          tradeState: Number.isInteger(normalized) && normalized > 0
            ? String(normalized)
            : getDefaultTimedTradeState(),
        };
      }
      return {
        ...current,
        tradeState: current.tradeState === '' ? '0' : current.tradeState,
      };
    });
  }

  function handleBindStateModeChange(mode) {
    setItemDraft((current) => {
      if (mode === 'unbound') {
        return { ...current, bindState: '0' };
      }
      if (mode === 'bound') {
        return { ...current, bindState: '1' };
      }
      return {
        ...current,
        bindState: current.bindState === '' ? '0' : current.bindState,
      };
    });
  }

  function handleSkillChange(event) {
    const { name, value } = event.target;
    setSkillDraft((current) => ({ ...current, [name]: value }));
  }

  function refreshProfile() {
    startTransition(() => {
      router.refresh();
    });
  }

  async function runMutation(actionName, work, successText) {
    setBusyAction(actionName);
    setFeedback(null);

    try {
      await work();
      closeModal();
      setFeedback({ tone: 'success', text: successText });
      refreshProfile();
    } catch (error) {
      setFeedback({ tone: 'error', text: getAdminMessage(error.message) });
    } finally {
      setBusyAction('');
    }
  }

  function openProfileEditor() {
    setProfileDraft(createProfileDraft(profile));
    setActiveModal('profile');
  }

  function openAddItem() {
    setEditingItem(null);
    setItemDraft(createBlankItemDraft());
    setSelectedItemDefinition(null);
    setItemSearch('');
    setItemResults([]);
    setActiveModal('add-item');
  }

  function openEditItem(item) {
    setEditingItem(item);
    setItemDraft(createItemDraft(item));
    setSelectedItemDefinition(createItemDefinition(item));
    setItemSearch(item.item_name || '');
    setItemResults([]);
    setActiveModal('edit-item');
  }

  function openAddSkill() {
    setEditingSkill(null);
    setSkillDraft(createBlankSkillDraft());
    setSelectedSkillDefinition(null);
    setSkillSearch('');
    setSkillResults([]);
    setActiveModal('add-skill');
  }

  function openEditSkill(skill) {
    setEditingSkill(skill);
    setSkillDraft(createSkillDraft(skill));
    setSelectedSkillDefinition(createSkillDefinition(skill));
    setActiveModal('edit-skill');
  }

  async function saveProfile(event) {
    event.preventDefault();

    await runMutation(
      'save-profile',
      () =>
        requestJson(`/api/admin/characters/${encodeURIComponent(profile.character_id)}/profile`, {
          method: 'PATCH',
          body: JSON.stringify(profileDraft),
        }),
      'Character profile updated.'
    );
  }

  async function saveItem(event) {
    event.preventDefault();

    const method = editingItem ? 'PATCH' : 'POST';
    const url = editingItem
      ? `/api/admin/characters/${encodeURIComponent(profile.character_id)}/items/${encodeURIComponent(editingItem.instance_id)}`
      : `/api/admin/characters/${encodeURIComponent(profile.character_id)}/items`;

    await runMutation(
      editingItem ? 'save-item' : 'add-item',
      () =>
        requestJson(url, {
          method,
          body: JSON.stringify(itemDraft),
        }),
      editingItem ? 'Inventory item updated.' : 'Item added to the character inventory.'
    );
  }

  async function removeItem(item) {
    if (!window.confirm(`Remove ${item.item_name} from ${profile.char_name}?`)) {
      return;
    }

    setBusyAction(`remove-item-${item.instance_id}`);
    setFeedback(null);

    try {
      await requestJson(
        `/api/admin/characters/${encodeURIComponent(profile.character_id)}/items/${encodeURIComponent(
          item.instance_id
        )}?inventoryScope=${encodeURIComponent(item.inventory_scope)}`,
        {
          method: 'DELETE',
        }
      );
      setInventoryItems((current) =>
        current.filter(
          (entry) =>
            !(
              entry.instance_id === item.instance_id &&
              entry.inventory_scope === item.inventory_scope
            )
        )
      );
      setFeedback({ tone: 'success', text: 'Inventory item removed.' });
      refreshProfile();
    } catch (error) {
      setFeedback({ tone: 'error', text: getAdminMessage(error.message) });
    } finally {
      setBusyAction('');
    }
  }

  async function saveSkill(event) {
    event.preventDefault();

    const method = editingSkill ? 'PATCH' : 'POST';
    const url = editingSkill
      ? `/api/admin/characters/${encodeURIComponent(profile.character_id)}/skills/${encodeURIComponent(editingSkill.skill_id)}`
      : `/api/admin/characters/${encodeURIComponent(profile.character_id)}/skills`;

    await runMutation(
      editingSkill ? 'save-skill' : 'add-skill',
      () =>
        requestJson(url, {
          method,
          body: JSON.stringify(skillDraft),
        }),
      editingSkill ? 'Skill entry updated.' : 'Skill added to the character profile.'
    );
  }

  async function removeSkill(skill) {
    if (!window.confirm(`Remove ${skill.name} from ${profile.char_name}?`)) {
      return;
    }

    setBusyAction(`remove-skill-${skill.skill_id}`);
    setFeedback(null);

    try {
      await requestJson(
        `/api/admin/characters/${encodeURIComponent(profile.character_id)}/skills/${encodeURIComponent(skill.skill_id)}`,
        {
          method: 'DELETE',
        }
      );
      setSkillEntries((current) => current.filter((entry) => entry.skill_id !== skill.skill_id));
      setFeedback({ tone: 'success', text: 'Skill removed from the character.' });
      refreshProfile();
    } catch (error) {
      setFeedback({ tone: 'error', text: getAdminMessage(error.message) });
    } finally {
      setBusyAction('');
    }
  }

  function selectItemResult(item) {
    const equipment = isEquipment(item);
    setSelectedItemDefinition(item);
    setItemDraft((current) => ({
      ...current,
      templateId: String(item.template_id),
      equipped: equipment ? current.equipped : false,
      refineLevel: equipment ? current.refineLevel : '',
      enhancementGrowthId: equipment ? current.enhancementGrowthId : '',
      enhancementCurrentExp: equipment ? current.enhancementCurrentExp : '',
      enhancementSoulPoints: equipment ? current.enhancementSoulPoints : '',
      enhancementAptitudeGrowth: equipment ? current.enhancementAptitudeGrowth : '',
      enhancementUnknown13: equipment ? current.enhancementUnknown13 : '',
      attributePairs: equipment ? current.attributePairs : '[]',
    }));
  }

  function selectSkillResult(skill) {
    setSelectedSkillDefinition(skill);
    setSkillDraft((current) => ({
      ...current,
      skillId: String(skill.skill_id),
      level: current.level || '1',
      proficiency: current.proficiency || '0',
    }));
  }

  const showItemEditor = activeModal === 'add-item' || activeModal === 'edit-item';
  const itemMeta = selectedItemDefinition;
  const selectedMapLabel =
    mapCatalog.find((map) => String(map.map_id) === String(profileDraft.mapId))?.map_name ||
    profile.map_name ||
    `Map #${profile.map_id}`;
  const itemEntries = inventoryItems.filter((item) => !isEquipment(item));
  const equipmentEntries = inventoryItems.filter((item) => isEquipment(item));
  const visibleInventoryEntries = view === 'equipments' ? equipmentEntries : itemEntries;
  const inventorySectionTitle = view === 'equipments' ? 'Stored equipments' : 'Stored items';
  const inventorySectionEyebrow = view === 'equipments' ? 'Equipment Deck' : 'Inventory Studio';
  const inventoryEmptyCopy =
    view === 'equipments'
      ? 'No equipment records are stored for this character.'
      : 'No non-equipment items are stored for this character.';
  const quickLinks = basePath
    ? [
        {
          href: `${basePath}/inventory/items`,
          kicker: 'Inventory',
          title: 'Items',
          value: itemEntries.length,
          copy: 'Consumables, stackables, and non-equipment records.',
        },
        {
          href: `${basePath}/inventory/equipments`,
          kicker: 'Inventory',
          title: 'Equipments',
          value: equipmentEntries.length,
          copy: 'Weapons, armor, and other equipable templates.',
        },
        {
          href: `${basePath}/skills`,
          kicker: 'Skills',
          title: 'Skills',
          value: skillEntries.length,
          copy: 'Learned skills, levels, proficiency, and hotbar bindings.',
        },
      ]
    : [];

  return (
    <div className="workspace-shell">
      {feedback ? <p className={`status-banner ${feedback.tone}`}>{feedback.text}</p> : null}

      <section className="panel workspace-summary-panel">
        <div className="workspace-heading">
          <div>
            <p className="eyebrow">Character Workspace</p>
            <h2>{profile.char_name}</h2>
            <p className="lede workspace-lede">
              Account {profile.account_id} · character ID {profile.character_id}
            </p>
          </div>
          <div className="workspace-action-cluster">
            <span className={`pill ${profile.is_online ? 'pill-live' : 'pill-idle'}`}>
              {profile.is_online ? 'Online' : 'Offline'}
            </span>
            <button className="secondary-button" onClick={openProfileEditor} type="button">
              Edit profile
            </button>
            {(view === 'overview' || view === 'skills') ? (
              <button className="secondary-button" onClick={openAddSkill} type="button">
                Add skill
              </button>
            ) : null}
            {(view === 'overview' || view === 'items' || view === 'equipments') ? (
              <button className="primary-button" onClick={openAddItem} type="button">
                Add item
              </button>
            ) : null}
          </div>
        </div>

        {profile.is_online ? (
          <article className="workspace-lock-banner">
            <strong>Live mode is active.</strong>
            <p>Profile, inventory, and skill edits are applied to the running session and then persisted back to Postgres.</p>
          </article>
        ) : null}

        <div className="workspace-stat-band">
          <article className="workspace-stat-tile feature-stat-tile">
            <span>Level</span>
            <strong>{formatNumber(profile.level)}</strong>
            <p>{formatNumber(profile.experience)} XP</p>
          </article>
          <article className="workspace-stat-tile">
            <span>Currency</span>
            <strong>{formatNumber(profile.gold)}</strong>
            <p>
              Bank {formatNumber(profile.bank_gold)} · Coins {formatNumber(profile.coins)}
            </p>
          </article>
          <article className="workspace-stat-tile">
            <span>Vitals</span>
            <strong>
              {formatNumber(profile.current_health)}/{formatNumber(profile.max_health)} HP
            </strong>
            <p>
              {formatNumber(profile.current_mana)}/{formatNumber(profile.max_mana)} MP · Rage{' '}
              {formatNumber(profile.current_rage)}/{formatNumber(profile.max_rage)}
            </p>
          </article>
          <article className="workspace-stat-tile">
            <span>Position</span>
            <strong>
              {profile.map_name || `Map #${profile.map_id}`}
            </strong>
            <p>
              {profile.x}, {profile.y} · map #{profile.map_id} · updated {formatAdminDate(profile.updated_at)}
            </p>
          </article>
        </div>

        <div className="workspace-mosaic">
          <article className="mosaic-card">
            <p className="profile-kicker">Economy</p>
            <div className="mosaic-grid">
              <div>
                <span>Bound gold</span>
                <strong>{formatNumber(profile.bound_gold)}</strong>
              </div>
              <div>
                <span>Renown</span>
                <strong>{formatNumber(profile.renown)}</strong>
              </div>
              <div>
                <span>Status points</span>
                <strong>{formatNumber(profile.status_points)}</strong>
              </div>
              <div>
                <span>Attack range</span>
                <strong>
                  {formatNumber(profile.attack_min)} - {formatNumber(profile.attack_max)}
                </strong>
              </div>
            </div>
          </article>

          <article className="mosaic-card">
            <p className="profile-kicker">Attributes</p>
            <div className="mosaic-grid">
              <div>
                <span>Strength</span>
                <strong>{formatNumber(profile.strength)}</strong>
              </div>
              <div>
                <span>Dexterity</span>
                <strong>{formatNumber(profile.dexterity)}</strong>
              </div>
              <div>
                <span>Vitality</span>
                <strong>{formatNumber(profile.vitality)}</strong>
              </div>
              <div>
                <span>Intelligence</span>
                <strong>{formatNumber(profile.intelligence)}</strong>
              </div>
            </div>
          </article>
        </div>
      </section>

      {view === 'overview' ? (
        <>
          <section className="panel workspace-section-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Section Navigation</p>
                <h3>Choose a focused page</h3>
              </div>
            </div>

            <div className="workspace-link-grid">
              {quickLinks.map((link) => (
                <Link className="workspace-link-card" href={link.href} key={link.href}>
                  <p className="eyebrow">{link.kicker}</p>
                  <strong>{link.title}</strong>
                  <span>{link.value}</span>
                  <p>{link.copy}</p>
                </Link>
              ))}
            </div>
          </section>

          <section className="panel workspace-section-panel">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Stored Snapshot</p>
                <h3>Current runtime mirror</h3>
              </div>
            </div>
            <div className="snapshot-grid">
              <article className="snapshot-card">
                <span>Inventory items</span>
                <strong>{itemEntries.length}</strong>
                <p>Non-equipment entries across bag and warehouse storage.</p>
              </article>
              <article className="snapshot-card">
                <span>Equipments</span>
                <strong>{equipmentEntries.length}</strong>
                <p>Weapons, armor, and other equipable templates.</p>
              </article>
              <article className="snapshot-card">
                <span>Skill entries</span>
                <strong>{skillEntries.length}</strong>
                <p>Including hotbar bindings and proficiency.</p>
              </article>
              <article className="snapshot-card">
                <span>Character state</span>
                <strong>{profile.is_online ? 'Live' : 'Stored only'}</strong>
                <p>{profile.is_online ? 'Admin changes apply against the active session first.' : 'Portal changes write directly to the stored snapshot.'}</p>
              </article>
            </div>
          </section>
        </>
      ) : null}

      {(view === 'items' || view === 'equipments') ? (
        <section className="panel workspace-section-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">{inventorySectionEyebrow}</p>
              <h3>{inventorySectionTitle}</h3>
            </div>
            <span className="rail-count">{visibleInventoryEntries.length} entries</span>
          </div>

          {visibleInventoryEntries.length < 1 ? (
            <article className="muted-card">{inventoryEmptyCopy}</article>
          ) : (
            <div className="inventory-editor-grid">
              {visibleInventoryEntries.map((item) => (
                <article className="inventory-editor-card" key={`${item.inventory_scope}-${item.instance_id}`}>
                  <div className="inventory-editor-topline">
                    <div>
                      <strong>{item.item_name}</strong>
                      <p>
                        Template {item.template_id} · {item.inventory_scope} · slot {item.slot}
                      </p>
                    </div>
                    <div className="inventory-badge-row">
                      <span className="mini-badge">Qty {item.quantity}</span>
                      {item.item_kind ? <span className="mini-badge">{item.item_kind}</span> : null}
                      {item.equipped ? <span className="mini-badge accent-badge">Equipped</span> : null}
                    </div>
                  </div>

                  {hasMeaningfulDescription(item.item_description) ? (
                    <p className="inventory-copy">{item.item_description}</p>
                  ) : null}

                  <div className="inventory-meta-grid">
                    <div>
                      <span>Durability</span>
                      <strong>{item.durability ?? 'n/a'}</strong>
                    </div>
                    <div>
                      <span>Refine</span>
                      <strong>{item.refine_level ?? '0'}</strong>
                    </div>
                    <div>
                      <span>Trade lock</span>
                      <strong>{formatTradeStateBadge(item.trade_state)}</strong>
                    </div>
                    <div>
                      <span>Bind byte</span>
                      <strong>{formatBindStateBadge(item.bind_state, isEquipment(item))}</strong>
                    </div>
                    <div>
                      <span>State</span>
                      <strong>{item.state_code ?? '0'}</strong>
                    </div>
                  </div>

                  <div className="card-action-row">
                    <button
                      className="secondary-button"
                      onClick={() => openEditItem(item)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="danger-button"
                      disabled={busyAction === `remove-item-${item.instance_id}`}
                      onClick={() => removeItem(item)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {view === 'skills' ? (
        <section className="panel workspace-section-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Skill Deck</p>
              <h3>Learned skills</h3>
            </div>
            <span className="rail-count">{skillEntries.length} learned</span>
          </div>

          {skillEntries.length < 1 ? (
            <article className="muted-card">No learned skills stored for this character.</article>
          ) : (
            <div className="skill-editor-grid">
              {skillEntries.map((skill) => (
                <article className="skill-editor-card" key={skill.skill_id}>
                  <div className="inventory-editor-topline">
                    <div>
                      <strong>{skill.name}</strong>
                      <p>Skill ID {skill.skill_id}</p>
                    </div>
                    <span className="mini-badge">Lv {skill.level || 1}</span>
                  </div>
                  <p className="inventory-copy">{buildRequirementLabel(skill)}</p>
                  <div className="inventory-meta-grid skill-meta-grid">
                    <div>
                      <span>Proficiency</span>
                      <strong>{skill.proficiency ?? 0}</strong>
                    </div>
                    <div>
                      <span>Hotbar slot</span>
                      <strong>{skill.hotbar_slot ?? 'Unbound'}</strong>
                    </div>
                  </div>
                  <div className="card-action-row">
                    <button
                      className="secondary-button"
                      onClick={() => openEditSkill(skill)}
                      type="button"
                    >
                      Edit
                    </button>
                    <button
                      className="danger-button"
                      disabled={busyAction === `remove-skill-${skill.skill_id}`}
                      onClick={() => removeSkill(skill)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeModal === 'profile' ? (
        <ModalFrame
          description="Update the stored character sheet. All values must be valid integers before the portal will save them."
          eyebrow="Character Sheet"
          onClose={closeModal}
          title={`Edit ${profile.char_name}`}
          wide
        >
          <form className="modal-form" onSubmit={saveProfile}>
            <div className="modal-section-grid">
              <section className="modal-card">
                <p className="profile-kicker">Progression</p>
                <div className="editor-grid">
                  <Field label="Level">
                    <input min="1" name="level" onChange={handleProfileChange} required type="number" value={profileDraft.level} />
                  </Field>
                  <Field label="Experience">
                    <input min="0" name="experience" onChange={handleProfileChange} required type="number" value={profileDraft.experience} />
                  </Field>
                  <Field label="Renown">
                    <input min="0" name="renown" onChange={handleProfileChange} required type="number" value={profileDraft.renown} />
                  </Field>
                  <Field label="Status points">
                    <input min="0" name="statusPoints" onChange={handleProfileChange} required type="number" value={profileDraft.statusPoints} />
                  </Field>
                </div>
              </section>

              <section className="modal-card">
                <p className="profile-kicker">Economy</p>
                <div className="editor-grid">
                  <Field label="Gold">
                    <input min="0" name="gold" onChange={handleProfileChange} required type="number" value={profileDraft.gold} />
                  </Field>
                  <Field label="Bank gold">
                    <input min="0" name="bankGold" onChange={handleProfileChange} required type="number" value={profileDraft.bankGold} />
                  </Field>
                  <Field label="Bound gold">
                    <input min="0" name="boundGold" onChange={handleProfileChange} required type="number" value={profileDraft.boundGold} />
                  </Field>
                  <Field label="Coins">
                    <input min="0" name="coins" onChange={handleProfileChange} required type="number" value={profileDraft.coins} />
                  </Field>
                </div>
              </section>

              <section className="modal-card">
                <p className="profile-kicker">Position</p>
                <div className="editor-grid">
                  <Field label="Map" wide={mapCatalog.length > 0}>
                    {mapCatalog.length > 0 ? (
                      <select name="mapId" onChange={handleProfileChange} required value={profileDraft.mapId}>
                        {mapCatalog.map((map) => (
                          <option key={map.map_id} value={map.map_id}>
                            {formatMapLabel(map)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input min="0" name="mapId" onChange={handleProfileChange} required type="number" value={profileDraft.mapId} />
                    )}
                  </Field>
                  {mapCatalog.length > 0 ? (
                    <Field label="Selected map">
                      <input disabled type="text" value={selectedMapLabel} />
                    </Field>
                  ) : null}
                  <Field label="X">
                    <input min="0" name="x" onChange={handleProfileChange} required type="number" value={profileDraft.x} />
                  </Field>
                  <Field label="Y">
                    <input min="0" name="y" onChange={handleProfileChange} required type="number" value={profileDraft.y} />
                  </Field>
                </div>
              </section>

              <section className="modal-card">
                <p className="profile-kicker">Vitals</p>
                <div className="editor-grid">
                  <Field label="Current health">
                    <input min="0" name="currentHealth" onChange={handleProfileChange} required type="number" value={profileDraft.currentHealth} />
                  </Field>
                  <Field label="Max health">
                    <input min="0" name="maxHealth" onChange={handleProfileChange} required type="number" value={profileDraft.maxHealth} />
                  </Field>
                  <Field label="Current mana">
                    <input min="0" name="currentMana" onChange={handleProfileChange} required type="number" value={profileDraft.currentMana} />
                  </Field>
                  <Field label="Max mana">
                    <input min="0" name="maxMana" onChange={handleProfileChange} required type="number" value={profileDraft.maxMana} />
                  </Field>
                  <Field label="Current rage">
                    <input min="0" name="currentRage" onChange={handleProfileChange} required type="number" value={profileDraft.currentRage} />
                  </Field>
                  <Field label="Max rage">
                    <input min="0" name="maxRage" onChange={handleProfileChange} required type="number" value={profileDraft.maxRage} />
                  </Field>
                </div>
              </section>

              <section className="modal-card">
                <p className="profile-kicker">Attributes</p>
                <div className="editor-grid">
                  <Field label="Strength">
                    <input min="0" name="strength" onChange={handleProfileChange} required type="number" value={profileDraft.strength} />
                  </Field>
                  <Field label="Dexterity">
                    <input min="0" name="dexterity" onChange={handleProfileChange} required type="number" value={profileDraft.dexterity} />
                  </Field>
                  <Field label="Vitality">
                    <input min="0" name="vitality" onChange={handleProfileChange} required type="number" value={profileDraft.vitality} />
                  </Field>
                  <Field label="Intelligence">
                    <input min="0" name="intelligence" onChange={handleProfileChange} required type="number" value={profileDraft.intelligence} />
                  </Field>
                </div>
              </section>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" onClick={closeModal} type="button">
                Cancel
              </button>
              <button className="primary-button" disabled={busyAction === 'save-profile'} type="submit">
                Save profile
              </button>
            </div>
          </form>
        </ModalFrame>
      ) : null}

      {showItemEditor ? (
        <ModalFrame
          description="Search the imported item catalog, then set the stored snapshot fields that matter for this item type."
          eyebrow={editingItem ? 'Inventory Editor' : 'Inventory Add'}
          onClose={closeModal}
          title={editingItem ? `Edit ${editingItem.item_name}` : `Add item to ${profile.char_name}`}
          wide
        >
          <form className="modal-form" onSubmit={saveItem}>
            <div className="catalog-shell">
              <section className="catalog-panel">
                <Field label="Search item catalog">
                  <input
                    name="itemSearch"
                    onChange={(event) => setItemSearch(event.target.value)}
                    placeholder="Search by item name or template ID"
                    type="text"
                    value={itemSearch}
                  />
                </Field>

                {itemMeta ? (
                  <article className="catalog-selection-card">
                    <div className="inventory-editor-topline">
                      <div>
                        <strong>{itemMeta.name}</strong>
                        <p>
                          Template {itemMeta.template_id} · {itemMeta.item_kind || 'item'}
                        </p>
                      </div>
                      {itemMeta.max_stack ? <span className="mini-badge">Max {itemMeta.max_stack}</span> : null}
                    </div>
                    {itemMeta.description ? <p className="inventory-copy">{itemMeta.description}</p> : null}
                  </article>
                ) : (
                  <article className="muted-card catalog-placeholder">
                    Search the catalog and choose an item before saving.
                  </article>
                )}

                <div className="catalog-results">
                  {itemSearchPending ? (
                    <article className="muted-card">Searching item catalog…</article>
                  ) : itemResults.length < 1 ? (
                    <article className="muted-card">No catalog results yet.</article>
                  ) : (
                    itemResults.map((item) => (
                      <button
                        className={`catalog-result-card ${
                          String(item.template_id) === itemDraft.templateId ? 'selected-card' : ''
                        }`}
                        key={item.template_id}
                        onClick={() => selectItemResult(item)}
                        type="button"
                      >
                        <div className="inventory-editor-topline">
                          <div>
                            <strong>{item.name}</strong>
                            <p>
                              Template {item.template_id} · {item.item_kind || 'item'}
                            </p>
                          </div>
                          {item.max_stack ? <span className="mini-badge">Max {item.max_stack}</span> : null}
                        </div>
                        {item.description ? <p className="inventory-copy">{item.description}</p> : null}
                      </button>
                    ))
                  )}
                </div>
              </section>

              <section className="catalog-editor-panel">
                <div className="section-heading">
                  <div>
                    <p className="eyebrow">Stored Fields</p>
                    <h3>{editingItem ? 'Edit snapshot fields' : 'Set item details'}</h3>
                  </div>
                  {itemMeta ? (
                    <span className="rail-count">
                      {isEquipment(itemMeta) ? 'Equipment detail mode' : 'Standard item mode'}
                    </span>
                  ) : null}
                </div>

                <input name="templateId" type="hidden" value={itemDraft.templateId} />
                <InventoryEditorFields
                  draft={itemDraft}
                  onBindStateModeChange={handleBindStateModeChange}
                  onChange={handleItemChange}
                  onTradeStateModeChange={handleTradeStateModeChange}
                  selectedItem={itemMeta}
                />
              </section>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" onClick={closeModal} type="button">
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={!itemDraft.templateId || busyAction === 'add-item' || busyAction === 'save-item'}
                type="submit"
              >
                {editingItem ? 'Save item' : 'Add item'}
              </button>
            </div>
          </form>
        </ModalFrame>
      ) : null}

      {activeModal === 'add-skill' || activeModal === 'edit-skill' ? (
        <ModalFrame
          description="Search the imported skill catalog when adding a new entry, then tune the stored level, proficiency, and hotbar binding."
          eyebrow={editingSkill ? 'Skill Editor' : 'Skill Add'}
          onClose={closeModal}
          title={editingSkill ? `Edit ${editingSkill.name}` : `Add skill to ${profile.char_name}`}
        >
          <form className="modal-form" onSubmit={saveSkill}>
            <div className="modal-section-grid">
              {activeModal === 'add-skill' ? (
                <section className="modal-card">
                  <p className="profile-kicker">Catalog search</p>
                  <Field label="Search skills">
                    <input
                      name="skillSearch"
                      onChange={(event) => setSkillSearch(event.target.value)}
                      placeholder="Search by skill name or skill ID"
                      type="text"
                      value={skillSearch}
                    />
                  </Field>
                  <div className="catalog-results compact-catalog-results">
                    {skillSearchPending ? (
                      <article className="muted-card">Searching skill catalog…</article>
                    ) : skillResults.length < 1 ? (
                      <article className="muted-card">No skill results yet.</article>
                    ) : (
                      skillResults.map((skill) => (
                        <button
                          className={`catalog-result-card ${
                            String(skill.skill_id) === skillDraft.skillId ? 'selected-card' : ''
                          }`}
                          key={skill.skill_id}
                          onClick={() => selectSkillResult(skill)}
                          type="button"
                        >
                          <div className="inventory-editor-topline">
                            <div>
                              <strong>{skill.name}</strong>
                              <p>Skill ID {skill.skill_id}</p>
                            </div>
                            {skill.required_level ? (
                              <span className="mini-badge">Lv {skill.required_level}</span>
                            ) : null}
                          </div>
                          <p className="inventory-copy">{buildRequirementLabel(skill)}</p>
                        </button>
                      ))
                    )}
                  </div>
                </section>
              ) : null}

              <section className="modal-card">
                <p className="profile-kicker">Stored skill data</p>
                {selectedSkillDefinition ? (
                  <article className="catalog-selection-card">
                    <strong>{selectedSkillDefinition.name}</strong>
                    <p>
                      Skill ID {selectedSkillDefinition.skill_id} · {buildRequirementLabel(selectedSkillDefinition)}
                    </p>
                  </article>
                ) : null}
                <div className="editor-grid">
                  <Field label="Level">
                    <input min="1" name="level" onChange={handleSkillChange} required type="number" value={skillDraft.level} />
                  </Field>
                  <Field label="Proficiency">
                    <input min="0" name="proficiency" onChange={handleSkillChange} type="number" value={skillDraft.proficiency} />
                  </Field>
                  <Field label="Hotbar slot">
                    <input min="0" name="hotbarSlot" onChange={handleSkillChange} placeholder="Leave blank to unbind" type="number" value={skillDraft.hotbarSlot} />
                  </Field>
                </div>
              </section>
            </div>

            <div className="modal-actions">
              <button className="secondary-button" onClick={closeModal} type="button">
                Cancel
              </button>
              <button
                className="primary-button"
                disabled={!skillDraft.skillId || busyAction === 'add-skill' || busyAction === 'save-skill'}
                type="submit"
              >
                {editingSkill ? 'Save skill' : 'Add skill'}
              </button>
            </div>
          </form>
        </ModalFrame>
      ) : null}
    </div>
  );
}
