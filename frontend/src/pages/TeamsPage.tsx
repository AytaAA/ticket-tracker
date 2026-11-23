import { FormEvent, KeyboardEvent, useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, errorMessage } from "../api";
import { formatUtc } from "../format";

export type Team = {
  id: number;
  name: string;
  ticket_count: number;
  epic_count: number;
  created_at: string;
  modified_at: string;
};

// §4 / §10.7 Team management screen (wireframe 4)
export default function TeamsPage() {
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const closeCreate = useCallback(() => setCreating(false), []);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setTeams(await api<Team[]>("/teams"));
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function sortByName(list: Team[]) {
    return [...list].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id);
  }

  function onCreated(team: Team) {
    setCreating(false);
    setTeams((list) => sortByName([...(list ?? []), team]));
    setNotice({ kind: "success", text: `Team "${team.name}" created.` });
  }

  function onRenamed(team: Team) {
    setEditingId(null);
    setTeams((list) => sortByName((list ?? []).map((t) => (t.id === team.id ? team : t))));
    setNotice({ kind: "success", text: `Team renamed to "${team.name}".` });
  }

  async function onDelete(team: Team) {
    setNotice(null);
    setDeletingId(team.id);
    try {
      await api(`/teams/${team.id}`, { method: "DELETE" });
      setTeams((list) => (list ?? []).filter((t) => t.id !== team.id));
      setNotice({ kind: "success", text: `Team "${team.name}" deleted.` });
    } catch (e) {
      setNotice({ kind: "error", text: errorMessage(e) });
      if (e instanceof ApiError && e.status === 409) load(); // counts changed elsewhere: refresh
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <section>
      <div className="page-head">
        <div>
          <h1>Teams</h1>
          <p className="muted">All verified users can view and manage all teams.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => { setNotice(null); setCreating(true); }}>
          + Create team
        </button>
      </div>

      {notice && (
        <p className={`alert alert-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} data-testid="teams-notice">
          {notice.text}
        </p>
      )}

      <div className="card table-card">
        {teams === null && !loadError && <p className="page-loading">Loading teams…</p>}
        {loadError && (
          <div className="alert alert-error" role="alert">
            Could not load teams: {loadError}{" "}
            <button type="button" className="btn btn-secondary btn-small" onClick={load}>
              Retry
            </button>
          </div>
        )}
        {teams && teams.length === 0 && (
          <p className="empty-state" data-testid="teams-empty">
            No teams yet. Create the first one with “+ Create team”.
          </p>
        )}
        {teams && teams.length > 0 && (
          <>
            <table className="data-table" data-testid="teams-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th className="num">Tickets</th>
                  <th className="num">Epics</th>
                  <th>Modified (UTC)</th>
                  <th className="actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {teams.map((team) => {
                  const inUse = team.ticket_count > 0 || team.epic_count > 0;
                  return (
                    <tr key={team.id} data-testid={`team-row-${team.id}`}>
                      <td className="name">
                        {editingId === team.id ? (
                          <RenameForm team={team} onSaved={onRenamed} onCancel={() => setEditingId(null)} />
                        ) : (
                          team.name
                        )}
                      </td>
                      <td className="num">{team.ticket_count}</td>
                      <td className="num">{team.epic_count}</td>
                      <td className="muted-cell">{formatUtc(team.modified_at)}</td>
                      <td className="actions">
                        {editingId !== team.id && (
                          <button
                            type="button"
                            className="btn btn-secondary btn-small"
                            onClick={() => { setNotice(null); setEditingId(team.id); }}
                            aria-label={`Edit ${team.name}`}
                          >
                            Edit
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-secondary btn-small"
                          disabled={inUse || deletingId === team.id}
                          title={inUse ? "Delete is disabled while the team contains tickets or epics." : undefined}
                          onClick={() => onDelete(team)}
                          aria-label={`Delete ${team.name}`}
                        >
                          {deletingId === team.id ? "Deleting…" : "Delete"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="table-note">Delete is disabled while a team contains tickets or epics.</p>
          </>
        )}
      </div>

      {creating && <CreateTeamDialog onCreated={onCreated} onClose={closeCreate} />}
    </section>
  );
}

function RenameForm({ team, onSaved, onCancel }: { team: Team; onSaved: (t: Team) => void; onCancel: () => void }) {
  const [name, setName] = useState(team.name);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Team name is required.");
      return;
    }
    setSaving(true);
    try {
      onSaved(await api<Team>(`/teams/${team.id}`, { method: "PATCH", body: { name } }));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") onCancel();
  }

  return (
    <form className="inline-form" onSubmit={onSubmit} noValidate>
      <input
        aria-label="Team name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={onKeyDown}
        aria-invalid={error ? true : undefined}
        maxLength={100}
        autoFocus
      />
      <button type="submit" className="btn btn-primary btn-small" disabled={saving}>
        {saving ? "Saving…" : "Save"}
      </button>
      <button type="button" className="btn btn-secondary btn-small" onClick={onCancel} disabled={saving}>
        Cancel
      </button>
      {error && (
        <p className="field-error" role="alert" data-testid="rename-error">
          {error}
        </p>
      )}
    </form>
  );
}

function CreateTeamDialog({ onCreated, onClose }: { onCreated: (t: Team) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Team name is required.");
      return;
    }
    setSaving(true);
    try {
      onCreated(await api<Team>("/teams", { method: "POST", body: { name } }));
    } catch (err) {
      setError(errorMessage(err));
      setSaving(false);
    }
  }

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal" role="dialog" aria-modal="true" aria-labelledby="create-team-title">
        <h2 id="create-team-title">Create team</h2>
        <form onSubmit={onSubmit} noValidate>
          <label htmlFor="new-team-name">Team name</label>
          <div className="modal-row">
            <input
              id="new-team-name"
              ref={inputRef}
              placeholder="e.g. Platform Engineering"
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
              maxLength={100}
            />
            <button type="submit" className="btn btn-primary" disabled={saving}>
              {saving ? "Creating…" : "Create"}
            </button>
          </div>
          {error && (
            <p className="field-error" role="alert" data-testid="create-team-error">
              {error}
            </p>
          )}
          <button type="button" className="btn-link" onClick={onClose}>
            Cancel
          </button>
        </form>
      </div>
    </div>
  );
}
