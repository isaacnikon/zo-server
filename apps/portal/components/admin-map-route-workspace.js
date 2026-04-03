'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';

const VALIDATION_OPTIONS = [
  'validated-manually',
  'screenshot-validated',
  'title-identified-manually',
  'ui-inferred',
  'script-extracted',
  'unknown',
];

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

function formatDate(value) {
  if (!value) {
    return 'n/a';
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value));
  } catch {
    return String(value);
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

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    cache: 'no-store',
    headers: {
      ...(options.body ? { 'content-type': 'application/json' } : {}),
      ...(options.headers || {}),
    },
  });

  const payload = await response.json().catch(() => ({}));
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
  const [draft, setDraft] = useState(() => createBlankDraft(mapCatalog || []));
  const [editingRoute, setEditingRoute] = useState(null);
  const [busyAction, setBusyAction] = useState('');

  useEffect(() => {
    setRouteEntries(routes || []);
  }, [routes]);

  const filteredRoutes = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) {
      return routeEntries;
    }

    return routeEntries.filter((route) => {
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
  }, [routeEntries, search]);

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
          <h2>Canonical route directory</h2>
        </div>
        <button className="primary-button" onClick={openAddRoute} type="button">
          Add route
        </button>
      </div>

      <p className="hint">
        Runtime teleports now read from `game_map_routes`. Editing a route here updates the live DB source instead of JSON patches.
      </p>

      <div className="route-toolbar">
        <input
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Filter by source map, target map, or scene script"
          type="text"
          value={search}
        />
        <span className="rail-count">{filteredRoutes.length} routes</span>
      </div>

      <div className="route-grid">
        {filteredRoutes.length < 1 ? (
          <article className="muted-card">No routes matched the current filter.</article>
        ) : (
          filteredRoutes.map((route) => (
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
                  <strong>{formatDate(route.updated_at)}</strong>
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
