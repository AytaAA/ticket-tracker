export type Notice = { kind: "success" | "error" | "info"; text: string };

/** Reads a notice handed over by navigate(..., { state: { notice } }) and removes it from the
 *  browser history entry, so a refresh or Back does not show it again (QA BUG-regression-1). */
export function takeNotice(state: unknown): Notice | null {
  const notice = (state as { notice?: Notice } | null)?.notice ?? null;
  if (notice) {
    const h = window.history.state as { usr?: Record<string, unknown> } | null;
    if (h?.usr) window.history.replaceState({ ...h, usr: { ...h.usr, notice: undefined } }, "");
  }
  return notice;
}
