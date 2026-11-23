import {
  DndContext,
  DragEndEvent,
  DragOverlay,
  DragStartEvent,
  KeyboardSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api, errorMessage } from "../api";
import { formatRelative, formatUtc } from "../format";
import { STATE_LABELS, TICKET_STATES, TicketState, TicketSummary, TYPE_LABELS } from "../tickets";
import type { Team } from "./TeamsPage";

type Notice = { kind: "success" | "error"; text: string };

// §8 / §10.5 Kanban board for one selected team (wireframe 1). Selected team lives in the URL (PLAN.md D9).
export default function BoardPage() {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const [teams, setTeams] = useState<Team[] | null>(null);
  const [teamsError, setTeamsError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketSummary[] | null>(null);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [saving, setSaving] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState<TicketSummary | null>(null);

  const teamParam = Number(params.get("team"));
  const team = teams?.find((t) => t.id === teamParam) ?? null;

  useEffect(() => {
    setNotice((location.state as { notice?: Notice } | null)?.notice ?? null);
  }, [location.key]); // eslint-disable-line react-hooks/exhaustive-deps

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

  useEffect(() => {
    if (teams && teams.length > 0 && !team) setParams({ team: String(teams[0].id) }, { replace: true });
  }, [teams, team, setParams]);

  const loadTickets = useCallback(async (teamId: number) => {
    setTickets(null);
    setTicketsError(null);
    try {
      setTickets(await api<TicketSummary[]>(`/tickets?team_id=${teamId}`));
    } catch (e) {
      setTicketsError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (team) loadTickets(team.id);
  }, [team?.id, loadTickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // §8.2 five columns in workflow order; §8.7 newest modified first within a column
  const columns = useMemo(() => {
    const by: Record<TicketState, TicketSummary[]> = {
      new: [], ready_for_implementation: [], in_progress: [], ready_for_acceptance: [], done: [],
    };
    for (const t of tickets ?? []) by[t.state].push(t);
    for (const s of TICKET_STATES) by[s].sort((a, b) => b.modified_at.localeCompare(a.modified_at) || b.id - a.id);
    return by;
  }, [tickets]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), // a plain click still opens the ticket
    useSensor(KeyboardSensor),
  );

  function onDragStart(e: DragStartEvent) {
    setDragging(tickets?.find((t) => t.id === e.active.id) ?? null);
  }

  async function onDragEnd(e: DragEndEvent) {
    setDragging(null);
    const ticket = tickets?.find((t) => t.id === e.active.id);
    const target = e.over?.id as TicketState | undefined;
    if (!ticket || !target || target === ticket.state) return;

    // Move the card right away, then persist (§8.4); on failure put it back and say so (§8.5)
    setNotice(null);
    setTickets((list) => (list ?? []).map((t) => (t.id === ticket.id ? { ...t, state: target } : t)));
    setSaving((s) => new Set(s).add(ticket.id));
    try {
      const saved = await api<TicketSummary>(`/tickets/${ticket.id}`, { method: "PATCH", body: { state: target } });
      setTickets((list) => (list ?? []).map((t) => (t.id === ticket.id ? { ...t, state: saved.state, modified_at: saved.modified_at } : t)));
    } catch (err) {
      setTickets((list) => (list ?? []).map((t) => (t.id === ticket.id ? ticket : t)));
      setNotice({
        kind: "error",
        text: `Could not move "${ticket.title}" to ${STATE_LABELS[target]}: ${errorMessage(err)} The card was returned to ${STATE_LABELS[ticket.state]}.`,
      });
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(ticket.id);
        return n;
      });
    }
  }

  if (teamsError) {
    return (
      <div className="alert alert-error" role="alert">
        Could not load teams: {teamsError}{" "}
        <button type="button" className="btn btn-secondary btn-small" onClick={loadTeams}>
          Retry
        </button>
      </div>
    );
  }
  if (teams === null) return <p className="page-loading">Loading…</p>;
  if (teams.length === 0) {
    return (
      <section>
        <h1>Board</h1>
        <p className="empty-state card" data-testid="board-no-teams">
          There are no teams yet. <Link to="/teams">Create a team</Link> to start adding tickets.
        </p>
      </section>
    );
  }

  return (
    <section className="board-page">
      <div className="page-head">
        <div>
          <label htmlFor="board-team">Team</label>
          <select
            id="board-team"
            className="team-select"
            value={team?.id ?? ""}
            onChange={(e) => {
              setNotice(null);
              setParams({ team: e.target.value });
            }}
          >
            {teams.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        {team && (
          <Link className="btn btn-primary" to={`/tickets/new?team=${team.id}`}>
            + New ticket
          </Link>
        )}
      </div>

      {notice && (
        <p className={`alert alert-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} data-testid="board-notice">
          {notice.text}
        </p>
      )}

      {ticketsError && (
        <div className="alert alert-error" role="alert">
          Could not load tickets: {ticketsError}{" "}
          <button type="button" className="btn btn-secondary btn-small" onClick={() => team && loadTickets(team.id)}>
            Retry
          </button>
        </div>
      )}
      {tickets === null && !ticketsError && <p className="page-loading">Loading tickets…</p>}

      {tickets && (
        <>
          {tickets.length === 0 && (
            <p className="muted" data-testid="board-empty">
              No tickets in {team?.name} yet. Use “+ New ticket” to create one.
            </p>
          )}
          <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
            <div className="board" data-testid="board">
              {TICKET_STATES.map((state) => (
                <Column key={state} state={state} tickets={columns[state]} saving={saving} />
              ))}
            </div>
            <DragOverlay>{dragging ? <CardBody ticket={dragging} /> : null}</DragOverlay>
          </DndContext>
        </>
      )}
    </section>
  );
}

function Column({ state, tickets, saving }: { state: TicketState; tickets: TicketSummary[]; saving: Set<number> }) {
  const { setNodeRef, isOver } = useDroppable({ id: state });
  return (
    <section ref={setNodeRef} className={`column${isOver ? " over" : ""}`} data-testid={`column-${state}`} aria-label={STATE_LABELS[state]}>
      <header className="column-head">
        <h2>{STATE_LABELS[state].toUpperCase()}</h2>
        <span className="count" data-testid={`count-${state}`}>
          {tickets.length}
        </span>
      </header>
      <div className="column-cards">
        {tickets.map((t) => (
          <Card key={t.id} ticket={t} saving={saving.has(t.id)} />
        ))}
      </div>
    </section>
  );
}

// memo: with 100+ tickets only the moved card re-renders (§8.10)
const Card = memo(function Card({ ticket, saving }: { ticket: TicketSummary; saving: boolean }) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: ticket.id });
  return (
    <Link
      ref={setNodeRef}
      to={`/tickets/${ticket.id}`}
      className={`ticket-card${isDragging ? " dragging" : ""}${saving ? " saving" : ""}`}
      data-testid={`card-${ticket.id}`}
      {...listeners}
      {...attributes}
    >
      <CardBody ticket={ticket} />
    </Link>
  );
});

function CardBody({ ticket }: { ticket: TicketSummary }) {
  return (
    <div className="card-body">
      <span className={`badge badge-${ticket.type}`}>{TYPE_LABELS[ticket.type].toUpperCase()}</span>
      <p className="card-title">{ticket.title}</p>
      <div className="card-foot">
        <span className="card-epic">{ticket.epic_title ? `Epic: ${ticket.epic_title}` : ""}</span>
        <time dateTime={ticket.modified_at} title={`Modified ${formatUtc(ticket.modified_at)}`}>
          {formatRelative(ticket.modified_at)}
        </time>
      </div>
    </div>
  );
}
