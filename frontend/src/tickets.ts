// §6.1 canonical API values, with the human-readable labels the UI shows.
export const TICKET_TYPES = ["bug", "feature", "fix"] as const;
export const TICKET_STATES = ["new", "ready_for_implementation", "in_progress", "ready_for_acceptance", "done"] as const;

export type TicketType = (typeof TICKET_TYPES)[number];
export type TicketState = (typeof TICKET_STATES)[number];

export const TYPE_LABELS: Record<TicketType, string> = { bug: "Bug", feature: "Feature", fix: "Fix" };
export const STATE_LABELS: Record<TicketState, string> = {
  new: "New",
  ready_for_implementation: "Ready for implementation",
  in_progress: "In progress",
  ready_for_acceptance: "Ready for acceptance",
  done: "Done",
};

/** Board card data (GET /api/tickets?team_id=). */
export type TicketSummary = {
  id: number;
  team_id: number;
  epic_id: number | null;
  epic_title: string | null;
  type: TicketType;
  state: TicketState;
  title: string;
  created_at: string;
  modified_at: string;
};

/** Full ticket (GET /api/tickets/:id). */
export type Ticket = TicketSummary & { body: string; created_by: { id: number; email: string } };
