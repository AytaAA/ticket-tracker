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
import { memo, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { api, ApiError, errorMessage } from "../api";
import { Notice, takeNotice } from "../notice";
import { formatRelative, formatUtc } from "../format";
import { STATE_LABELS, TICKET_STATES, TICKET_TYPES, TicketState, TicketSummary, TicketType, TYPE_LABELS } from "../tickets";
import type { Epic } from "./EpicsPage";
import type { Team } from "./TeamsPage";


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
  // §8.9 filters, applied client-side (PLAN.md D5)
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TicketType | "">("");
  const [epicFilter, setEpicFilter] = useState("");
  const [epics, setEpics] = useState<Epic[]>([]);
  const deferredSearch = useDeferredValue(search); // typing stays responsive with 100+ tickets (§8.10)

  const teamParam = Number(params.get("team"));
  const team = teams?.find((t) => t.id === teamParam) ?? null;

  useEffect(() => {
    setNotice(takeNotice(location.state));
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

  // Only the latest request may update the board: a slow answer for a previously selected team
  // must not overwrite the current team's tickets.
  const ticketsRequest = useRef(0);
  const loadTickets = useCallback(async (teamId: number) => {
    const req = ++ticketsRequest.current;
    setTickets(null);
    setTicketsError(null);
    try {
      const list = await api<TicketSummary[]>(`/tickets?team_id=${teamId}`);
      if (req === ticketsRequest.current) setTickets(list);
    } catch (e) {
      if (req === ticketsRequest.current) setTicketsError(errorMessage(e));
    }
  }, []);

  useEffect(() => {
    if (!team) return;
    loadTickets(team.id);
    // filters belong to one team's board
    setSearch("");
    setTypeFilter("");
    setEpicFilter("");
    setEpics([]);
    let current = true;
    api<Epic[]>(`/epics?team_id=${team.id}`)
      .then((list) => current && setEpics(list))
      .catch(() => current && setEpics([]));
    return () => {
      current = false;
    };
  }, [team?.id, loadTickets]); // eslint-disable-line react-hooks/exhaustive-deps

  // Type AND epic AND case-insensitive title substring (§8.9)
  const visible = useMemo(() => {
    const q = deferredSearch.trim().toLowerCase();
    return (tickets ?? []).filter(
      (t) =>
        (!typeFilter || t.type === typeFilter) &&
        (!epicFilter || String(t.epic_id) === epicFilter) &&
        (!q || t.title.toLowerCase().includes(q)),
    );
  }, [tickets, typeFilter, epicFilter, deferredSearch]);
  const filtering = Boolean(search.trim() || typeFilter || epicFilter);

  function clearFilters() {
    setSearch("");
    setTypeFilter("");
    setEpicFilter("");
  }

  // §8.2 five columns in workflow order; §8.7 newest modified first within a column
  const columns = useMemo(() => {
    const by: Record<TicketState, TicketSummary[]> = {
      new: [], ready_for_implementation: [], in_progress: [], ready_for_acceptance: [], done: [],
    };
    for (const t of visible) by[t.state].push(t);
    for (const s of TICKET_STATES) by[s].sort((a, b) => b.modified_at.localeCompare(a.modified_at) || b.id - a.id);
    return by;
  }, [visible]);

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
      if (err instanceof ApiError && err.status === 404) {
        // Deleted elsewhere (another user or tab): drop the stale card instead of returning it
        // (product-owner decision 2026-11-24, option B). Other failures roll back as §8.5 requires.
        setTickets((list) => (list ?? []).filter((t) => t.id !== ticket.id));
        setNotice({
          kind: "error",
          text: `Ticket #${ticket.id} "${ticket.title}" was deleted by someone else and has been removed from the board.`,
        });
      } else {
        setTickets((list) => (list ?? []).map((t) => (t.id === ticket.id ? ticket : t)));
        setNotice({
          kind: "error",
          text: `Could not move "${ticket.title}" to ${STATE_LABELS[target]}: ${errorMessage(err)} The card was returned to ${STATE_LABELS[ticket.state]}.`,
        });
      }
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
          <div className="card filter-bar" role="search">
            <div>
              <label htmlFor="f-search">Search</label>
              <input id="f-search" type="search" placeholder="Search title…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div>
              <label htmlFor="f-type">Type</label>
              <select id="f-type" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as TicketType | "")}>
                <option value="">All types</option>
                {TICKET_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="f-epic">Epic</label>
              <select id="f-epic" value={epicFilter} onChange={(e) => setEpicFilter(e.target.value)}>
                <option value="">All epics</option>
                {epics.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.title}
                  </option>
                ))}
              </select>
            </div>
            <button type="button" className="btn btn-secondary" onClick={clearFilters} disabled={!filtering}>
              Clear
            </button>
            <span className="filter-count" data-testid="ticket-count" aria-live="polite">
              {filtering ? `${visible.length} of ${tickets.length} tickets` : `${tickets.length} ${tickets.length === 1 ? "ticket" : "tickets"}`}
            </span>
          </div>
          {filtering && visible.length === 0 && tickets.length > 0 && (
            <p className="muted" data-testid="board-no-match">
              No tickets match the filters. <button type="button" className="btn-link inline" onClick={clearFilters}>Clear filters</button>
            </p>
          )}
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
