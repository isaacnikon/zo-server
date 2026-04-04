'use client';

import { useMemo, useState } from 'react';

import { formatAdminNumber } from '../lib/format';

const DEFAULT_QUEST_PREVIEW_COUNT = 12;
const QUICK_FILTER_LIMIT = 6;
const DETAIL_STEP_LIMIT = 4;

function formatCount(value) {
  return formatAdminNumber(Number(value || 0));
}

function collapseWhitespace(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getQuestSummary(quest) {
  return (
    collapseWhitespace(quest?.first_step_description) ||
    collapseWhitespace(quest?.accept_message) ||
    collapseWhitespace(quest?.completion_message) ||
    'Quest definition imported, but no readable summary text is available yet.'
  );
}

function getQuestSteps(quest) {
  return Array.isArray(quest?.raw_data?.steps) ? quest.raw_data.steps : [];
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

export default function AdminQuestWorkspace({ quests }) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showFullDirectory, setShowFullDirectory] = useState(false);
  const [activeQuest, setActiveQuest] = useState(null);

  const categoryFilters = useMemo(() => {
    const counts = new Map();

    (quests || []).forEach((quest) => {
      const key = String(quest.category || 'unknown');
      const current = counts.get(key) || {
        key,
        label: key,
        count: 0,
      };

      current.count += 1;
      counts.set(key, current);
    });

    return Array.from(counts.values())
      .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
      .slice(0, QUICK_FILTER_LIMIT);
  }, [quests]);

  const summary = useMemo(() => {
    const categoryCount = new Set();
    let repeatableCount = 0;
    let activeAssignmentCount = 0;
    let completedAssignmentCount = 0;

    (quests || []).forEach((quest) => {
      categoryCount.add(String(quest.category || 'unknown'));
      if (quest.repeatable) {
        repeatableCount += 1;
      }
      activeAssignmentCount += Number(quest.active_character_count || 0);
      completedAssignmentCount += Number(quest.completed_character_count || 0);
    });

    return {
      totalQuests: (quests || []).length,
      repeatableCount,
      activeAssignmentCount,
      completedAssignmentCount,
      categoryCount: categoryCount.size,
    };
  }, [quests]);

  const filteredQuests = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return (quests || []).filter((quest) => {
      if (categoryFilter !== 'all' && String(quest.category || 'unknown') !== categoryFilter) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        quest.quest_id,
        quest.name,
        quest.category,
        quest.quest_type,
        quest.accept_npc_id,
        quest.next_quest_name,
        quest.first_step_description,
      ]
        .map((value) => String(value || '').toLowerCase())
        .join(' ');

      return haystack.includes(normalizedSearch);
    });
  }, [categoryFilter, quests, search]);

  const isPreviewMode =
    categoryFilter === 'all' &&
    !search.trim() &&
    !showFullDirectory &&
    filteredQuests.length > DEFAULT_QUEST_PREVIEW_COUNT;

  const visibleQuests = isPreviewMode
    ? filteredQuests.slice(0, DEFAULT_QUEST_PREVIEW_COUNT)
    : filteredQuests;

  const activeQuestSteps = getQuestSteps(activeQuest);

  return (
    <>
      <section className="panel quest-workspace-panel">
        <div className="route-summary-band">
          <article className="snapshot-card quest-summary-card">
            <span>Total quests</span>
            <strong>{formatCount(summary.totalQuests)}</strong>
            <p>Imported quest definitions across the current portal dataset.</p>
          </article>
          <article className="snapshot-card quest-summary-card">
            <span>Categories</span>
            <strong>{formatCount(summary.categoryCount)}</strong>
            <p>Quick filters are built from the strongest quest categories in the dataset.</p>
          </article>
          <article className="snapshot-card quest-summary-card">
            <span>Active tracks</span>
            <strong>{formatCount(summary.activeAssignmentCount)}</strong>
            <p>Total active quest assignments currently stored across all characters.</p>
          </article>
          <article className="snapshot-card quest-summary-card">
            <span>Repeatable</span>
            <strong>{formatCount(summary.repeatableCount)}</strong>
            <p>Definitions flagged as repeatable in the imported quest catalog.</p>
          </article>
        </div>

        <div className="section-heading">
          <div>
            <p className="eyebrow">Quest Directory</p>
            <h2>Review quest flow</h2>
          </div>
          <span className="rail-count">{formatCount(filteredQuests.length)} shown</span>
        </div>

        <p className="hint">
          This page mirrors the map workspace structure: preview the catalog first, filter hard when needed, then open a focused detail panel instead of scanning one oversized admin page.
        </p>

        <div className="route-toolbar">
          <label className="field quest-search-field">
            <span>Search quests</span>
            <input
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search by quest name, id, category, or NPC"
              type="text"
              value={search}
            />
          </label>

          <button
            className="secondary-button"
            onClick={() => setShowFullDirectory((current) => !current)}
            type="button"
          >
            {showFullDirectory ? 'Show preview set' : 'Open full directory'}
          </button>
        </div>

        <div className="filter-chip-row">
          <button
            className={`filter-chip ${categoryFilter === 'all' ? 'filter-chip-active' : ''}`}
            onClick={() => setCategoryFilter('all')}
            type="button"
          >
            All categories
          </button>
          {categoryFilters.map((filter) => (
            <button
              className={`filter-chip ${categoryFilter === filter.key ? 'filter-chip-active' : ''}`}
              key={filter.key}
              onClick={() => setCategoryFilter(filter.key)}
              type="button"
            >
              {filter.label} · {formatCount(filter.count)}
            </button>
          ))}
        </div>

        {isPreviewMode ? (
          <div className="route-preview-banner">
            Previewing the first {DEFAULT_QUEST_PREVIEW_COUNT} quests. Use search, choose a category, or open the full directory when you need the complete catalog.
          </div>
        ) : null}

        {visibleQuests.length < 1 ? (
          <article className="muted-card">No quests matched the current search and category filter.</article>
        ) : (
          <div className="quest-grid">
            {visibleQuests.map((quest) => (
              <button
                className="quest-card quest-card-button"
                key={quest.quest_id}
                onClick={() => setActiveQuest(quest)}
                type="button"
              >
                <div className="quest-card-topline">
                  <div>
                    <p className="eyebrow">Quest #{quest.quest_id}</p>
                    <h3>{quest.name}</h3>
                  </div>
                  <div className="card-action-row">
                    {quest.quest_type ? <span className="mini-badge accent-badge">{quest.quest_type}</span> : null}
                    {quest.repeatable ? <span className="mini-badge">Repeatable</span> : null}
                  </div>
                </div>

                <p>{getQuestSummary(quest)}</p>

                <div className="quest-meta-grid">
                  <div>
                    <span>Category</span>
                    <strong>{quest.category || 'unknown'}</strong>
                  </div>
                  <div>
                    <span>Min level</span>
                    <strong>{formatCount(quest.min_level)}</strong>
                  </div>
                  <div>
                    <span>Steps</span>
                    <strong>{formatCount(quest.step_count)}</strong>
                  </div>
                  <div>
                    <span>Prereqs</span>
                    <strong>{formatCount(quest.prerequisite_count)}</strong>
                  </div>
                  <div>
                    <span>Active</span>
                    <strong>{formatCount(quest.active_character_count)}</strong>
                  </div>
                  <div>
                    <span>Completed</span>
                    <strong>{formatCount(quest.completed_character_count)}</strong>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {activeQuest ? (
        <ModalFrame
          description={getQuestSummary(activeQuest)}
          eyebrow={`Quest #${activeQuest.quest_id}`}
          onClose={() => setActiveQuest(null)}
          title={activeQuest.name}
          wide
        >
          <div className="modal-form">
            <section className="modal-section-grid">
              <article className="modal-card">
                <p className="eyebrow">Definition</p>
                <div className="quest-meta-grid">
                  <div>
                    <span>Category</span>
                    <strong>{activeQuest.category || 'unknown'}</strong>
                  </div>
                  <div>
                    <span>Type</span>
                    <strong>{activeQuest.quest_type || 'unspecified'}</strong>
                  </div>
                  <div>
                    <span>Min level</span>
                    <strong>{formatCount(activeQuest.min_level)}</strong>
                  </div>
                  <div>
                    <span>Accept NPC</span>
                    <strong>{activeQuest.accept_npc_id ? `NPC #${activeQuest.accept_npc_id}` : 'Not set'}</strong>
                  </div>
                  <div>
                    <span>Next quest</span>
                    <strong>{activeQuest.next_quest_name || 'No linked follow-up'}</strong>
                  </div>
                  <div>
                    <span>Repeatable</span>
                    <strong>{activeQuest.repeatable ? 'Yes' : 'No'}</strong>
                  </div>
                </div>
              </article>

              <article className="modal-card">
                <p className="eyebrow">Live Adoption</p>
                <div className="quest-meta-grid">
                  <div>
                    <span>Active assignments</span>
                    <strong>{formatCount(activeQuest.active_character_count)}</strong>
                  </div>
                  <div>
                    <span>Completed assignments</span>
                    <strong>{formatCount(activeQuest.completed_character_count)}</strong>
                  </div>
                  <div>
                    <span>Steps</span>
                    <strong>{formatCount(activeQuest.step_count)}</strong>
                  </div>
                  <div>
                    <span>Prerequisite quests</span>
                    <strong>{formatCount(activeQuest.prerequisite_count)}</strong>
                  </div>
                </div>
              </article>
            </section>

            {collapseWhitespace(activeQuest.accept_message) ? (
              <article className="modal-card">
                <p className="eyebrow">Accept Message</p>
                <p className="hint modal-copy">{collapseWhitespace(activeQuest.accept_message)}</p>
              </article>
            ) : null}

            {activeQuestSteps.length ? (
              <article className="modal-card">
                <p className="eyebrow">Step Preview</p>
                <div className="quest-step-list">
                  {activeQuestSteps.slice(0, DETAIL_STEP_LIMIT).map((step, index) => (
                    <div className="quest-step-item" key={`${activeQuest.quest_id}-${index}`}>
                      <strong>Step {index + 1}</strong>
                      <p>{collapseWhitespace(step?.description) || 'No readable step description.'}</p>
                    </div>
                  ))}
                </div>
                {activeQuestSteps.length > DETAIL_STEP_LIMIT ? (
                  <p className="hint modal-copy">
                    Showing the first {DETAIL_STEP_LIMIT} steps from the imported quest definition.
                  </p>
                ) : null}
              </article>
            ) : null}
          </div>
        </ModalFrame>
      ) : null}
    </>
  );
}
