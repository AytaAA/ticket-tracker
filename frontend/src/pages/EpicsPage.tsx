import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, ApiError, errorMessage } from "../api";
import ConfirmDialog from "../components/ConfirmDialog";
import { formatUtc } from "../format";
import { DiscardDialog, useUnsavedChanges } from "../unsaved";
import type { Team } from "./TeamsPage";

export type Epic = {
  id: number;
  team_id: number;
  title: string;
  description: string | null;
  ticket_count: number;
  created_at: string;
  modified_at: string;
};

type Panel = { kind: "create" } | { kind: "edit"; epic: Epic } | null;

// §5.3 / §10.8 Epic management screen (wireframe 5). Selected team lives in the URL (PLAN.md D9).
export default function EpicsPage() {
  const [params, setParams] = useSearchParams();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [epics, setEpics] = useState<Epic[] | null>(null);
  const [epicsError, setEpicsError] = useState<string | null>(null);
  const [panel, setPanelState] = useState<Panel>(null);
  const [confirmDelete, setConfirmDelete] = useState<Epic | null>(null);
  // Unsaved edits in the side panel (product-owner decision 2026-11-24)
  const [panelDirty, setPanelDirty] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const { allowNavigation, dialog: unsavedDialog } = useUnsavedChanges(panelDirty);

  function setPanel(p: Panel) {
    setPanelState(p);
    setPanelDirty(false);
  }

  /** Run an in-page action that would replace the panel; ask first if it has unsaved edits. */
  function guarded(action: () => void) {
    if (panelDirty) setPending(() => action);
    else action();
  }
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const teamParam = Number(params.get("team"));
  const team = teams?.find((t) => t.id === teamParam) ?? null;

  const loadTeams = useCallback(async () => {
    setTeamsError(null);
    try {
      setTeams(await api<Team[]>("/teams"));
    } catch (e) {
      setTeamsError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    loadTeams();
  }, [loadTeams]);

  // No (or unknown) team in the URL: select the first team
  useEffect(() => {
    if (teams && teams.length > 0 && !team) setParams({ team: String(teams[0].id) }, { replace: true });
  }, [teams, team, setParams]);

  // Only the latest request may update the list: a slow answer for a previously selected team
  // must not overwrite the current team's epics (race found by the e2e suite, 2026-11-24).
  const epicsRequest = useRef(0);
  const loadEpics = useCallback(async (teamId: number) => {
    const req = ++epicsRequest.current;
    setEpics(null);
    setEpicsError(null);
    try {
      const list = await api<Epic[]>(`/epics?team_id=${teamId}`);
      if (req === epicsRequest.current) setEpics(list);
    } catch (e) {
      if (req === epicsRequest.current) setEpicsError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (team) loadEpics(team.id);
  }, [team?.id, loadEpics]); // eslint-disable-line react-hooks/exhaustive-deps

  function selectTeam(id: string) {
    setPanel(null);
    setNotice(null);
    allowNavigation(); // already confirmed by guarded(); the dirty flag only clears on the next render
    setParams({ team: id });
  }

  function onSaved(epic: Epic, created: boolean) {
    setPanel(null);
    if (epics === null && team) {
      loadEpics(team.id); // list still loading: fetch again instead of merging into an empty list
      setNotice({ kind: "success", text: created ? `Epic "${epic.title}" created.` : `Epic "${epic.title}" saved.` });
      return;
    }
    // newest modified first, like the API
    setEpics((list) => [epic, ...(list ?? []).filter((e) => e.id !== epic.id)].sort(byModifiedDesc));
    setNotice({ kind: "success", text: created ? `Epic "${epic.title}" created.` : `Epic "${epic.title}" saved.` });
  }

  async function onDelete(epic: Epic) {
    setConfirmDelete(null);
    setNotice(null);
    setDeletingId(epic.id);
    try {
      await api(`/epics/${epic.id}`, { method: "DELETE" });
      setEpics((list) => (list ?? []).filter((e) => e.id !== epic.id));
      if (panel?.kind === "edit" && panel.epic.id === epic.id) setPanel(null);
      setNotice({ kind: "success", text: `Epic "${epic.title}" deleted.` });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
      if (e instanceof ApiError && (e.status === 409 || e.status === 404) && team) loadEpics(team.id);
    } finally {
      setDeletingId(null);
    }
  }

  if (teamsError) {
    return (
      <section>
        <h1>Epics</h1>
        <div className="alert alert-error" role="alert">
          Could not load teams: {teamsError}{" "}
          <button type="button" className="btn btn-secondary btn-small" onClick={loadTeams}>
            Retry
          </button>
        </div>
      </section>
    );
  }
  if (teams === null) return <p className="page-loading">Loading…</p>;
  if (teams.length === 0) {
    return (
      <section>
        <h1>Epics</h1>
        <p className="empty-state card" data-testid="epics-no-teams">
          Epics belong to a team, and there are no teams yet. <Link to="/teams">Create a team first.</Link>
        </p>
      </section>
    );
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Epics</h1>
          <label htmlFor="epics-team">Team</label>
          <select id="epics-team" className="team-select" value={team?.id ?? ""} onChange={(e) => {
              const id = e.target.value;
              guarded(() => selectTeam(id));
            }}>
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          disabled={!team}
          onClick={() =>
            guarded(() => {
              setNotice(null);
              setPanel({ kind: "create" });
            })
          }
        >
          + Create epic
        </button>
      </div>

      {notice && (
        <p className={`alert alert-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} data-testid="epics-notice">
          {notice.text}
        </p>
      )}

      <div className="split">
        <div className="card table-card split-main">
          {epics === null && !epicsError && <p className="page-loading">Loading epics…</p>}
          {epicsError && (
            <div className="alert alert-error" role="alert">
              Could not load epics: {epicsError}{" "}
              <button type="button" className="btn btn-secondary btn-small" onClick={() => team && loadEpics(team.id)}>
                Retry
              </button>
            </div>
          )}
          {epics && epics.length === 0 && (
            <p className="empty-state" data-testid="epics-empty">
              No epics in {team?.name} yet. Create one with “+ Create epic”.
            </p>
          )}
          {epics && epics.length > 0 && (
            <>
              <table className="data-table" data-testid="epics-table">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th className="num">Tickets</th>
                    <th>Modified (UTC)</th>
                    <th className="actions">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {epics.map((epic) => {
                    const inUse = epic.ticket_count > 0;
                    const selected = panel?.kind === "edit" && panel.epic.id === epic.id;
                    return (
                      <tr key={epic.id} className={selected ? "selected" : undefined}>
                        <td className="name">
                          {epic.title}
                          {epic.description && <div className="subline">{epic.description}</div>}
                        </td>
                        <td className="num">{epic.ticket_count}</td>
                        <td className="muted-cell">{formatUtc(epic.modified_at)}</td>
                        <td className="actions">
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            aria-label={`Edit ${epic.title}`}
                            onClick={() =>
                              guarded(() => {
                                setNotice(null);
                                setPanel({ kind: "edit", epic });
                              })
                            }
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            aria-label={`Delete ${epic.title}`}
                            disabled={inUse || deletingId === epic.id}
                            title={inUse ? "Delete is disabled while tickets reference the epic." : undefined}
                            onClick={() =>
                              guarded(() => {
                                setNotice(null);
                                setConfirmDelete(epic);
                              })
                            }
                          >
                            {deletingId === epic.id ? "Deleting…" : "Delete"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="table-note">Delete is disabled while tickets reference the epic.</p>
            </>
          )}
        </div>

        <aside className="card split-side">
          {panel && team ? (
            <EpicForm
              key={panel.kind === "edit" ? panel.epic.id : "new"}
              team={team}
              epic={panel.kind === "edit" ? panel.epic : null}
              onSaved={onSaved}
              onCancel={() => setPanel(null)}
              onDirtyChange={setPanelDirty}
            />
          ) : (
            <p className="muted panel-hint">Choose “Edit” on an epic, or “+ Create epic”.</p>
          )}
        </aside>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete epic "${confirmDelete.title}"?`}
          message="The epic will be deleted permanently. This cannot be undone."
          confirmLabel="Delete epic"
          onConfirm={() => onDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
      {pending && (
        <DiscardDialog
          onDiscard={() => {
            const action = pending;
            setPending(null);
            action();
          }}
          onKeep={() => setPending(null)}
        />
      )}
      {unsavedDialog}
    </section>
  );
}

function byModifiedDesc(a: Epic, b: Epic) {
  return b.modified_at.localeCompare(a.modified_at) || b.id - a.id;
}

function EpicForm({
  team,
  epic,
  onSaved,
  onCancel,
  onDirtyChange,
}: {
  team: Team;
  epic: Epic | null;
  onSaved: (e: Epic, created: boolean) => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [title, setTitle] = useState(epic?.title ?? "");
  const [description, setDescription] = useState(epic?.description ?? "");
  useEffect(
    () => onDirtyChange(title !== (epic?.title ?? "") || description !== (epic?.description ?? "")),
    [title, description, epic, onDirtyChange],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!title.trim()) {
      setError("Epic title is required.");
      return;
    }
    setSaving(true);
    try {
      const saved = epic
        ? await api<Epic>(`/epics/${epic.id}`, { method: "PATCH", body: { title, description } })
        : await api<Epic>("/epics", { method: "POST", body: { team_id: team.id, title, description } });
      onSaved(saved, !epic);
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate aria-labelledby="epic-form-title">
      <h2 id="epic-form-title">{epic ? "Edit epic" : "Create epic"}</h2>
      <p className="muted team-fixed" data-testid="epic-form-team">
        Team: <strong>{team.name}</strong>
        {epic ? " (cannot be changed)" : " (cannot be changed later)"}
      </p>
      <label htmlFor="epic-title">Title</label>
      <input
        id="epic-title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        aria-invalid={error ? true : undefined}
        maxLength={200}
        autoFocus
      />
      <label htmlFor="epic-description">Description (optional)</label>
      <textarea id="epic-description" rows={5} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={10000} />
      {error && (
        <p className="field-error" role="alert" data-testid="epic-form-error">
          {error}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? "Saving…" : epic ? "Save" : "Create"}
        </button>
      </div>
    </form>
  );
}
