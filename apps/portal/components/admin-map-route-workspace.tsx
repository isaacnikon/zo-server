'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

import { formatAdminDate } from '../lib/format';

const VALIDATION_OPTIONS = [
  'validated-manually',
  'screenshot-validated',
  'title-identified-manually',
  'ui-inferred',
  'script-extracted',
  'unknown',
];
const DEFAULT_ROUTE_PREVIEW_COUNT = 10;
const QUICK_FILTER_LIMIT = 6;

function toFieldValue(value, fallback = '') {
  if (value == null) {
    return fallback;
  }
  return String(value);
}

function getAdminMessage(code) {
  switch (code) {
    case 'invalid-admin-token':
      return 'The admin session expired. Reload and sign in again.';
    case 'map-route-not-found':
      return 'That route no longer exists.';
    case 'invalid-map-route':
      return 'Review the route fields. The source, target, trigger bounds, and landing coordinates must all be valid.';
    default:
      return 'The portal could not save that route. Check the portal logs if it persists.';
  }
}

function formatMapOption(map) {
  return `${map.map_name} (#${map.map_id})`;
}

function createBlankDraft(mapCatalog) {
  const fallbackMapId = mapCatalog[0]?.map_id ? String(mapCatalog[0].map_id) : '';
  return {
    sourceMapId: fallbackMapId,
    sourceSceneScriptId: '',
    displayLabel: '',
    triggerMinX: '',
    triggerMaxX: '',
    triggerMinY: '',
    triggerMaxY: '',
    targetMapId: fallbackMapId,
    targetSceneScriptId: '',
    targetX: '',
    targetY: '',
    validationStatus: 'validated-manually',
  };
}

function createDraft(route, mapCatalog) {
  if (!route) {
    return createBlankDraft(mapCatalog);
  }

  return {
    sourceMapId: toFieldValue(route.source_map_id),
    sourceSceneScriptId: toFieldValue(route.source_scene_script_id),
    displayLabel: toFieldValue(route.display_label),
    triggerMinX: toFieldValue(route.trigger_min_x),
    triggerMaxX: toFieldValue(route.trigger_max_x),
    triggerMinY: toFieldValue(route.trigger_min_y),
    triggerMaxY: toFieldValue(route.trigger_max_y),
    targetMapId: toFieldValue(route.target_map_id),
    targetSceneScriptId: toFieldValue(route.target_scene_script_id),
    targetX: toFieldValue(route.target_x),
    targetY: toFieldValue(route.target_y),
    validationStatus: toFieldValue(route.validation_status, 'unknown'),
  };
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

export default function AdminMapRouteWorkspace({ routes, mapCatalog }) {
  const router = useRouter();
  const [feedback, setFeedback] = useState(null);
  const [activeModal, setActiveModal] = useState(null);
  const [routeEntries, setRouteEntries] = useState(() => routes || []);
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [showFullDirectory, setShowFullDirectory] = useState(false);
  const [draft, setDraft] = useState(() => createBlankDraft(mapCatalog || []));
  const [editingRoute, setEditingRoute] = useState(null);
  const [busyAction, setBusyAction] = useState('');

  useEffect(() => {
    setRouteEntries(routes || []);
  }, [routes]);

  useEffect(() => {
    if (
      sourceFilter !== 'all' &&
      !routeEntries.some((route) => String(route.source_map_id) === sourceFilter)
    ) {
      setSourceFilter('all');
    }
  }, [routeEntries, sourceFilter]);

  const quickSourceFilters = useMemo(() => {
    const counts = new Map();

    routeEntries.forEach((route) => {
      const key = String(route.source_map_id);
      const current = counts.get(key) || {
        id: key,
        mapId: route.source_map_id,
        label: route.source_map_name || `Map #${route.source_map_id}`,
        count: 0,
      };

      current.count += 1;
      counts.set(key, current);
    });

    return Array.from(counts.values())
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, QUICK_FILTER_LIMIT);
  }, [routeEntries]);

  const connectedMapCount = useMemo(() => {
    const ids = new Set();

    routeEntries.forEach((route) => {
      ids.add(String(route.source_map_id));
      ids.add(String(route.target_map_id));
    });

    return ids.size;
  }, [routeEntries]);

  const filteredRoutes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return routeEntries.filter((route) => {
      if (sourceFilter !== 'all' && String(route.source_map_id) !== sourceFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        route.source_map_name,
        route.target_map_name,
        route.display_label,
        route.source_map_id,
        route.target_map_id,
        route.source_scene_script_id,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');
      return haystack.includes(normalizedSearch);
    });
  }, [routeEntries, search, sourceFilter]);

  const isPreviewMode =
    sourceFilter === 'all' &&
    !search.trim() &&
    !showFullDirectory &&
    filteredRoutes.length > DEFAULT_ROUTE_PREVIEW_COUNT;

  const visibleRoutes = isPreviewMode
    ? filteredRoutes.slice(0, DEFAULT_ROUTE_PREVIEW_COUNT)
    : filteredRoutes;

  function refreshPage() {
    startTransition(() => {
      router.refresh();
    });
  }

  function closeModal() {
    setActiveModal(null);
    setBusyAction('');
  }

  function openAddRoute() {
    setEditingRoute(null);
    setDraft(createBlankDraft(mapCatalog || []));
    setActiveModal('add');
  }

  function openEditRoute(route) {
    setEditingRoute(route);
    setDraft(createDraft(route, mapCatalog || []));
    setActiveModal('edit');
  }

  function handleDraftChange(event) {
    const { name, value } = event.target;
    setDraft((current) => ({
      ...current,
      [name]: value,
    }));
  }

  async function saveRoute(event) {
    event.preventDefault();
    const isEditing = Boolean(editingRoute);
    const url = isEditing
      ? `/api/admin/map-routes/${encodeURIComponent(editingRoute.source_map_id)}/${encodeURIComponent(editingRoute.source_scene_script_id)}`
      : '/api/admin/map-routes';
    const method = isEditing ? 'PATCH' : 'POST';

    setBusyAction(isEditing ? 'save-route' : 'add-route');
    setFeedback(null);

    try {
      await requestJson(url, {
        method,
        body: JSON.stringify(draft),
      });
      closeModal();
      setFeedback({
        tone: 'success',
        text: isEditing ? 'Route updated.' : 'Route added.',
      });
      refreshPage();
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: getAdminMessage(error.message),
      });
    } finally {
      setBusyAction('');
    }
  }

  async function removeRoute(route) {
    if (!window.confirm(`Remove route ${route.source_map_name} scene ${route.source_scene_script_id}?`)) {
      return;
    }

    setBusyAction(`remove-${route.source_map_id}-${route.source_scene_script_id}`);
    setFeedback(null);

    try {
      await requestJson(
        `/api/admin/map-routes/${encodeURIComponent(route.source_map_id)}/${encodeURIComponent(route.source_scene_script_id)}`,
        {
          method: 'DELETE',
        }
      );
      setRouteEntries((current) =>
        current.filter(
          (entry) =>
            !(
              entry.source_map_id === route.source_map_id &&
              entry.source_scene_script_id === route.source_scene_script_id
            )
        )
      );
      setFeedback({ tone: 'success', text: 'Route removed.' });
      refreshPage();
    } catch (error) {
      setFeedback({
        tone: 'error',
        text: getAdminMessage(error.message),
      });
    } finally {
      setBusyAction('');
    }
  }

  return (
    <section className="panel route-workspace-panel">
      {feedback ? <p className={`status-banner ${feedback.tone}`}>{feedback.text}</p> : null}

      <div className="section-heading">
        <div>
          <p className="eyebrow">Map Routing</p>
          <h2>Route directory</h2>
        </div>
        <div className="route-heading-actions">
          {routeEntries.length > DEFAULT_ROUTE_PREVIEW_COUNT ? (
            <button
              className="secondary-button"
              onClick={() => setShowFullDirectory((current) => !current)}
              type="button"
            >
              {showFullDirectory ? 'Use focused view' : 'Show full directory'}
            </button>
          ) : null}
          <button className="primary-button" onClick={openAddRoute} type="button">
            Add route
          </button>
        </div>
      </div>

      <p className="hint">
        Runtime teleports now read from `game_map_routes`. Search or filter when you need the whole directory, otherwise the workspace stays in a focused preview mode.
      </p>

      <div className="route-summary-band">
        <article className="snapshot-card route-summary-card">
          <span>Canonical routes</span>
          <strong>{routeEntries.length}</strong>
          <p>All teleporter definitions currently stored in Postgres.</p>
        </article>
        <article className="snapshot-card route-summary-card">
          <span>Connected maps</span>
          <strong>{connectedMapCount}</strong>
          <p>Unique source and destination maps represented in the directory.</p>
        </article>
        <article className="snapshot-card route-summary-card">
          <span>Visible right now</span>
          <strong>{visibleRoutes.length}</strong>
          <p>
            {isPreviewMode
              ? `Showing the first ${DEFAULT_ROUTE_PREVIEW_COUNT} routes until you expand or filter.`
              : 'Current search and filter results in view.'}
          </p>
        </article>
      </div>

      <div className="route-toolbar">
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by source map, target map, or scene script"
          type="text"
          value={search}
        />
        <span className="rail-count">{filteredRoutes.length} matches</span>
      </div>

      {quickSourceFilters.length > 0 ? (
        <div className="filter-chip-row">
          <button
            className={`filter-chip ${sourceFilter === 'all' ? 'filter-chip-active' : ''}`}
            onClick={() => setSourceFilter('all')}
            type="button"
          >
            All maps
          </button>
          {quickSourceFilters.map((filter) => (
            <button
              className={`filter-chip ${sourceFilter === filter.id ? 'filter-chip-active' : ''}`}
              key={filter.id}
              onClick={() => setSourceFilter(filter.id)}
              type="button"
            >
              {filter.label} ({filter.count})
            </button>
          ))}
        </div>
      ) : null}

      {isPreviewMode ? (
        <article className="route-preview-banner">
          Focused view is on. Search, pick a popular source map, or open the full directory when you need the entire routing table.
        </article>
      ) : null}

      <div className="route-grid">
        {visibleRoutes.length < 1 ? (
          <article className="muted-card">No routes matched the current filter.</article>
        ) : (
          visibleRoutes.map((route) => (
            <article className="route-card" key={`${route.source_map_id}-${route.source_scene_script_id}`}>
              <div className="route-card-topline">
                <div>
                  <strong>{route.source_map_name}</strong>
                  <p>
                    Scene script {route.source_scene_script_id}
                    {route.display_label ? ` · ${route.display_label}` : ''}
                  </p>
                </div>
                <span className="mini-badge">{route.validation_status}</span>
              </div>

              <div className="route-arrow">to</div>

              <div className="route-card-target">
                <strong>{route.target_map_name}</strong>
                <p>
                  Landing {route.target_x}, {route.target_y}
                  {route.target_scene_script_id ? ` · target scene ${route.target_scene_script_id}` : ''}
                </p>
              </div>

              <div className="route-meta-grid">
                <div>
                  <span>Trigger box</span>
                  <strong>
                    {route.trigger_min_x},{route.trigger_min_y} → {route.trigger_max_x},{route.trigger_max_y}
                  </strong>
                </div>
                <div>
                  <span>Updated</span>
                  <strong>{formatAdminDate(route.updated_at)}</strong>
                </div>
              </div>

              <div className="card-action-row">
                <button className="secondary-button" onClick={() => openEditRoute(route)} type="button">
                  Edit
                </button>
                <button
                  className="danger-button"
                  disabled={busyAction === `remove-${route.source_map_id}-${route.source_scene_script_id}`}
                  onClick={() => removeRoute(route)}
                  type="button"
                >
                  Remove
                </button>
              </div>
            </article>
          ))
        )}
      </div>

      {activeModal === 'add' || activeModal === 'edit' ? (
        <ModalFrame
          description="Edit the canonical teleport row the runtime uses. Source trigger bounds and landing coordinates are stored directly in Postgres."
          eyebrow={editingRoute ? 'Route Editor' : 'Route Add'}
          onClose={closeModal}
          title={editingRoute ? `Edit ${editingRoute.source_map_name}` : 'Add map route'}
          wide
        >
          <form className="modal-form" onSubmit={saveRoute}>
            <div className="modal-section-grid">
              <section className="modal-card">
                <p className="profile-kicker">Source</p>
                <div className="editor-grid">
                  <Field label="Source map">
                    <select
                      disabled={Boolean(editingRoute)}
                      name="sourceMapId"
                      onChange={handleDraftChange}
                      value={draft.sourceMapId}
                    >
                      {mapCatalog.map((map) => (
                        <option key={map.map_id} value={map.map_id}>
                          {formatMapOption(map)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Scene script ID">
                    <input
                      disabled={Boolean(editingRoute)}
                      min="1"
                      name="sourceSceneScriptId"
                      onChange={handleDraftChange}
                      required
                      type="number"
                      value={draft.sourceSceneScriptId}
                    />
                  </Field>
                  <Field label="Display label" wide>
                    <input
                      name="displayLabel"
                      onChange={handleDraftChange}
                      placeholder="Optional teleporter label"
                      type="text"
                      value={draft.displayLabel}
                    />
                  </Field>
                </div>
              </section>

              <section className="modal-card">
                <p className="profile-kicker">Trigger bounds</p>
                <div className="editor-grid">
                  <Field label="Min X">
                    <input min="0" name="triggerMinX" onChange={handleDraftChange} required type="number" value={draft.triggerMinX} />
                  </Field>
                  <Field label="Max X">
                    <input min="0" name="triggerMaxX" onChange={handleDraftChange} required type="number" value={draft.triggerMaxX} />
                  </Field>
                  <Field label="Min Y">
                    <input min="0" name="triggerMinY" onChange={handleDraftChange} required type="number" value={draft.triggerMinY} />
                  </Field>
                  <Field label="Max Y">
                    <input min="0" name="triggerMaxY" onChange={handleDraftChange} required type="number" value={draft.triggerMaxY} />
                  </Field>
                </div>
              </section>

              <section className="modal-card">
                <p className="profile-kicker">Target</p>
                <div className="editor-grid">
                  <Field label="Target map">
                    <select name="targetMapId" onChange={handleDraftChange} value={draft.targetMapId}>
                      {mapCatalog.map((map) => (
                        <option key={map.map_id} value={map.map_id}>
                          {formatMapOption(map)}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Target scene script">
                    <input min="1" name="targetSceneScriptId" onChange={handleDraftChange} placeholder="Optional" type="number" value={draft.targetSceneScriptId} />
                  </Field>
                  <Field label="Landing X">
                    <input min="0" name="targetX" onChange={handleDraftChange} required type="number" value={draft.targetX} />
                  </Field>
                  <Field label="Landing Y">
                    <input min="0" name="targetY" onChange={handleDraftChange} required type="number" value={draft.targetY} />
                  </Field>
                  <Field label="Validation status" wide>
                    <select name="validationStatus" onChange={handleDraftChange} value={draft.validationStatus}>
                      {VALIDATION_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
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
                disabled={busyAction === 'save-route' || busyAction === 'add-route'}
                type="submit"
              >
                {editingRoute ? 'Save route' : 'Add route'}
              </button>
            </div>
          </form>
        </ModalFrame>
      ) : null}
    </section>
  );
}
