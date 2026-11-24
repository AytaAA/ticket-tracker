import { useCallback, useEffect, useRef } from "react";
import { BlockerFunction, useBlocker } from "react-router-dom";
import ConfirmDialog from "./components/ConfirmDialog";

/**
 * Product-owner decision 2026-11-24: leaving a page with unsaved edits must be confirmed.
 * Covers in-app navigation (links, header menu, browser Back/Forward) via useBlocker, and
 * reload / tab close via the browser's own beforeunload prompt.
 *
 * Returns `allowNavigation()`: call it right before navigating on purpose after a save or delete.
 */
// How many mounted pages currently have unsaved edits; read by the header's Log out (code review 2026-11-24).
let dirtyPages = 0;
export function hasUnsavedChanges() {
  return dirtyPages > 0;
}

export function useUnsavedChanges(dirty: boolean) {
  const bypass = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  useEffect(() => {
    if (!dirty) return;
    dirtyPages += 1;
    return () => {
      dirtyPages -= 1;
    };
  }, [dirty]);

  const shouldBlock = useCallback<BlockerFunction>(
    ({ currentLocation, nextLocation }) =>
      dirtyRef.current &&
      !bypass.current &&
      currentLocation.pathname + currentLocation.search !== nextLocation.pathname + nextLocation.search,
    [],
  );
  const blocker = useBlocker(shouldBlock);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // Chrome/Edge need this to show the prompt
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const allowNavigation = useCallback(() => {
    bypass.current = true;
    setTimeout(() => (bypass.current = false), 0);
  }, []);

  const dialog =
    blocker.state === "blocked" ? (
      <DiscardDialog onDiscard={() => blocker.proceed()} onKeep={() => blocker.reset()} />
    ) : null;

  return { allowNavigation, dialog };
}

/** Product-owner wording 2026-11-24: "Leave without saving changes?" — Yes: leave, changes are lost;
 *  No: close the dialog and keep editing with the changes still there.
 *  Also used for in-page switches that would throw edits away (e.g. opening another epic). */
export function DiscardDialog({ onDiscard, onKeep }: { onDiscard: () => void; onKeep: () => void }) {
  return (
    <ConfirmDialog
      title="Leave without saving changes?"
      message="Yes: leave, your changes will not be saved. No: stay and keep editing."
      confirmLabel="Yes"
      cancelLabel="No"
      confirmFirst
      onConfirm={onDiscard}
      onCancel={onKeep}
    />
  );
}
