import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { api, ApiError, errorMessage } from "../api";
import CommentsPanel from "../components/CommentsPanel";
import ConfirmDialog from "../components/ConfirmDialog";
import { formatUtc } from "../format";
import { STATE_LABELS, Ticket, TICKET_STATES, TICKET_TYPES, TicketState, TicketType, TYPE_LABELS } from "../tickets";
import type { Epic } from "./EpicsPage";
import type { Team } from "./TeamsPage";

type Form = { team_id: string; type: TicketType | ""; state: TicketState; epic_id: string; title: string; body: string };
type Notice = { kind: "success" | "error" | "info"; text: string };

function formFrom(t: Ticket): Form {
  return {
    team_id: String(t.team_id),
    type: t.type,
    state: t.state,
    epic_id: t.epic_id ? String(t.epic_id) : "",
    title: t.title,
    body: t.body,
  };
}

// §6.2–§6.7 / §10.6: one page for creating, viewing and editing a ticket (wireframe 3, PLAN.md D7).
export default function TicketPage() {
  const { id } = useParams();
  const isNew = id === undefined;
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();

  const [teams, setTeams] = useState<Team[] | null>(null);
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [form, setForm] = useState<Form | null>(null);
  const [epics, setEpics] = useState<Epic[] | null>(null);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    setNotFound(false);
    try {
      const teamList = await api<Team[]>("/teams");
      setTeams(teamList);
      if (isNew) {
        const wanted = params.get("team");
        const team = teamList.find((t) => String(t.id) === wanted) ?? teamList[0];
        setTicket(null);
        setForm({ team_id: team ? String(team.id) : "", type: "", state: "new", epic_id: "", title: "", body: "" });
      } else {
        const t = await api<Ticket>(`/tickets/${id}`);
        setTicket(t);
        setForm(formFrom(t));
      }
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setLoadError(errorMessage(e));
    }
  }, [id, isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    load();
  }, [load]);

  // A notice handed over by navigate() (e.g. "Ticket #5 created.")
  useEffect(() => {
    setNotice((location.state as { notice?: Notice } | null)?.notice ?? null);
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  // Epics of the team currently selected in the form (§5.6)
  const formTeam = form?.team_id;
  useEffect(() => {
    if (!formTeam) return;
    let cancelled = false;
    setEpics(null);
    api<Epic[]>(`/epics?team_id=${formTeam}`)
      .then((list) => !cancelled && setEpics(list))
      .catch(() => !cancelled && setEpics([]));
    return () => {
      cancelled = true;
    };
  }, [formTeam]);

  function set<K extends keyof Form>(key: K, value: Form[K]) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function changeTeam(teamId: string) {
    // §6.6: a team change clears the selected epic
    if (form?.epic_id) setNotice({ kind: "info", text: "Epic cleared because the team changed." });
    setForm((f) => (f ? { ...f, team_id: teamId, epic_id: "" } : f));
  }

  function validate(f: Form) {
    const e: Partial<Record<keyof Form, string>> = {};
    if (!f.team_id) e.team_id = "Select a team.";
    if (!f.type) e.type = "Select a type.";
    if (!f.title.trim()) e.title = "Title is required.";
    if (!f.body.trim()) e.body = "Body is required.";
    return e;
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    if (!form) return;
    setNotice(null);
    const v = validate(form);
    setErrors(v);
    if (Object.keys(v).length) return;
    const payload = {
      team_id: Number(form.team_id),
      type: form.type,
      state: form.state,
      epic_id: form.epic_id ? Number(form.epic_id) : null,
      title: form.title,
      body: form.body,
    };
    setSaving(true);
    try {
      if (isNew) {
        const created = await api<Ticket>("/tickets", { method: "POST", body: payload });
        navigate(`/tickets/${created.id}`, {
          replace: true,
          state: { notice: { kind: "success", text: `Ticket #${created.id} created.` } },
        });
      } else {
        const saved = await api<Ticket>(`/tickets/${ticket!.id}`, { method: "PATCH", body: payload });
        const unchanged = saved.modified_at === ticket!.modified_at;
        setTicket(saved);
        setForm(formFrom(saved));
        setNotice(unchanged ? { kind: "info", text: "No changes to save." } : { kind: "success", text: "Ticket saved." });
      }
    } catch (err) {
      if (err instanceof ApiError && err.field && err.field in form) {
        setErrors({ [err.field]: err.message });
      }
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!ticket) return;
    setDeleting(true);
    try {
      await api(`/tickets/${ticket.id}`, { method: "DELETE" });
      navigate(`/board?team=${ticket.team_id}`, {
        replace: true,
        state: { notice: { kind: "success", text: `Ticket #${ticket.id} deleted.` } },
      });
    } catch (err) {
      setConfirmDelete(false);
      setDeleting(false);
      setNotice({ kind: "error", text: errorMessage(err) });
    }
  }

  if (notFound) {
    return (
      <section>
        <h1>Ticket not found</h1>
        <p className="muted">It may have been deleted.</p>
        <Link to="/board">← Back to the board</Link>
      </section>
    );
  }
  if (loadError) {
    return (
      <div className="alert alert-error" role="alert">
        Could not load the ticket: {loadError}{" "}
        <button type="button" className="btn btn-secondary btn-small" onClick={load}>
          Retry
        </button>
      </div>
    );
  }
  if (!teams || !form) return <p className="page-loading">Loading…</p>;
  if (teams.length === 0) {
    return (
      <p className="empty-state card">
        Tickets belong to a team, and there are no teams yet. <Link to="/teams">Create a team first.</Link>
      </p>
    );
  }

  const backTeam = teams.find((t) => t.id === (ticket?.team_id ?? Number(form.team_id)));

  return (
    <section>
      <Link className="back-link" to={backTeam ? `/board?team=${backTeam.id}` : "/board"}>
        ← Back to {backTeam?.name ?? "board"}
      </Link>

      <div className="page-head ticket-head">
        <div>
          {ticket ? (
            <p className="meta-line" data-testid="ticket-meta">
              #{ticket.id} • Created by {ticket.created_by.email} • Created {formatUtc(ticket.created_at)} • Modified{" "}
              <span data-testid="ticket-modified">{formatUtc(ticket.modified_at)}</span>
            </p>
          ) : (
            <p className="meta-line">New ticket</p>
          )}
          <h1 className="ticket-title">{ticket ? ticket.title : "New ticket"}</h1>
        </div>
        <div className="head-actions">
          {ticket && (
            <button type="button" className="btn btn-secondary" onClick={() => setConfirmDelete(true)}>
              Delete
            </button>
          )}
          <button type="submit" form="ticket-form" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : isNew ? "Create" : "Save"}
          </button>
        </div>
      </div>

      {notice && (
        <p className={`alert alert-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} data-testid="ticket-notice">
          {notice.text}
        </p>
      )}

      <div className="split">
        <form id="ticket-form" className="card split-main ticket-form" onSubmit={onSave} noValidate>
          <div className="form-grid">
            <div>
              <label htmlFor="t-team">Team</label>
              <select id="t-team" value={form.team_id} onChange={(e) => changeTeam(e.target.value)}>
                {teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <FieldError msg={errors.team_id} />
            </div>
            <div>
              <label htmlFor="t-type">Type</label>
              <select id="t-type" value={form.type} onChange={(e) => set("type", e.target.value as TicketType)} aria-invalid={errors.type ? true : undefined}>
                <option value="" disabled>
                  Select type…
                </option>
                {TICKET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
              <FieldError msg={errors.type} />
            </div>
            <div>
              <label htmlFor="t-state">State</label>
              <select id="t-state" value={form.state} onChange={(e) => set("state", e.target.value as TicketState)}>
                {TICKET_STATES.map((s) => (
                  <option key={s} value={s}>
                    {STATE_LABELS[s]}
                  </option>
                ))}
              </select>
              <FieldError msg={errors.state} />
            </div>
          </div>

          <label htmlFor="t-epic">Epic (optional)</label>
          <select id="t-epic" value={form.epic_id} onChange={(e) => set("epic_id", e.target.value)} disabled={epics === null}>
            <option value="">{epics === null ? "Loading epics…" : epics.length ? "No epic" : "No epics in this team"}</option>
            {(epics ?? []).map((ep) => (
              <option key={ep.id} value={ep.id}>
                {ep.title}
              </option>
            ))}
          </select>
          <FieldError msg={errors.epic_id} />

          <label htmlFor="t-title">Title</label>
          <input id="t-title" value={form.title} onChange={(e) => set("title", e.target.value)} aria-invalid={errors.title ? true : undefined} />
          <FieldError msg={errors.title} />

          <label htmlFor="t-body">Body</label>
          <textarea id="t-body" rows={10} value={form.body} onChange={(e) => set("body", e.target.value)} aria-invalid={errors.body ? true : undefined} />
          <FieldError msg={errors.body} />
        </form>

        {ticket && <CommentsPanel ticketId={ticket.id} />}
      </div>

      {confirmDelete && ticket && (
        <ConfirmDialog
          title={`Delete ticket #${ticket.id}?`}
          message={`"${ticket.title}" and all its comments will be deleted. This cannot be undone.`}
          confirmLabel="Delete ticket"
          busy={deleting}
          onConfirm={onDelete}
          onCancel={() => setConfirmDelete(false)}
        />
      )}
    </section>
  );
}

function FieldError({ msg }: { msg?: string }) {
  return msg ? (
    <p className="field-error" role="alert">
      {msg}
    </p>
  ) : null;
}
