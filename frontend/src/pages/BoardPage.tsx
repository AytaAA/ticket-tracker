// Placeholder for the Kanban board (§8, PLAN.md slice 5). It exists now so that
// login has a protected landing page to go to.
export default function BoardPage() {
  return (
    <section>
      <h1>Board</h1>
      <p className="muted" data-testid="board-placeholder">
        You are logged in. Teams, epics and the Kanban board arrive in the next slices.
      </p>
    </section>
  );
}
