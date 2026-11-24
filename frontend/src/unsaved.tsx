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
export function useUnsavedChanges(dirty: boolean) {
  const bypass = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

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

/** Same question for in-page switches that would throw edits away (e.g. opening another epic). */
export function DiscardDialog({ onDiscard, onKeep }: { onDiscard: () => void; onKeep: () => void }) {
  return (
    <ConfirmDialog
      title="Discard unsaved changes?"
      message="You have changes that are not saved. If you leave now, they will be lost."
      confirmLabel="Discard changes"
      cancelLabel="Keep editing"
      onConfirm={onDiscard}
      onCancel={onKeep}
    />
  );
}
