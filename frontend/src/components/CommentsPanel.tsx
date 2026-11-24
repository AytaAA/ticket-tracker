import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { useAuth } from "../auth";
import { formatUtc } from "../format";
import ConfirmDialog from "./ConfirmDialog";

type Comment = {
  id: number;
  ticket_id: number;
  author: { id: number; email: string };
  body: string;
  created_at: string;
  edited_at: string | null;
};

// §7 comments on a ticket (wireframe 3, right panel): oldest first, author + time.
// Edit/delete of one's own comments: §14 stretch, requested by the product owner on 2026-11-24.
export default function CommentsPanel({
  ticketId,
  onDirtyChange,
}: {
  ticketId: number;
  /** true while a new comment is typed but not posted, or an edit is not saved */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { user } = useAuth();
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [editing, setEditing] = useState<{ id: number; text: string; original: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Comment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [notice, setNotice] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    onDirtyChange(draft.trim() !== "" || (editing !== null && editing.text !== editing.original));
  }, [draft, editing, onDirtyChange]);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      setComments(await api<Comment[]>(`/tickets/${ticketId}/comments`));
    } catch (e) {
      setLoadError(errorMessage(e));
    }
  }, [ticketId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!draft.trim()) {
      setError("Comment cannot be empty.");
      return;
    }
    setPosting(true);
    try {
      const c = await api<Comment>(`/tickets/${ticketId}/comments`, { method: "POST", body: { body: draft } });
      setComments((list) => [...(list ?? []), c]);
      setDraft("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPosting(false);
    }
  }

  async function onSaveEdit(e: FormEvent) {
    e.preventDefault();
    if (!editing) return;
    setEditError(null);
    if (!editing.text.trim()) {
      setEditError("Comment cannot be empty.");
      return;
    }
    setSavingEdit(true);
    try {
      const c = await api<Comment>(`/tickets/${ticketId}/comments/${editing.id}`, {
        method: "PATCH",
        body: { body: editing.text },
      });
      setComments((list) => (list ?? []).map((x) => (x.id === c.id ? c : x)));
      setEditing(null);
      setNotice({ kind: "success", text: "Comment updated." });
    } catch (err) {
      setEditError(errorMessage(err));
    } finally {
      setSavingEdit(false);
    }
  }

  async function onDelete(c: Comment) {
    setDeleting(true);
    try {
      await api(`/tickets/${ticketId}/comments/${c.id}`, { method: "DELETE" });
      setComments((list) => (list ?? []).filter((x) => x.id !== c.id));
      if (editing?.id === c.id) setEditing(null);
      setNotice({ kind: "success", text: "Comment deleted." });
    } catch (err) {
      setNotice({ kind: "error", text: errorMessage(err) });
    } finally {
      setDeleting(false);
      setConfirmDelete(null);
    }
  }

  return (
    <aside className="card split-side comments" aria-labelledby="comments-title" data-testid="comments">
      <div className="comments-head">
        <h2 id="comments-title">Comments</h2>
        <span className="count" data-testid="comments-count">
          {comments?.length ?? "–"}
        </span>
      </div>

      {notice && (
        <p className={`alert alert-${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"} data-testid="comments-notice">
          {notice.text}
        </p>
      )}
      {comments === null && !loadError && <p className="muted">Loading comments…</p>}
      {loadError && (
        <div className="alert alert-error" role="alert">
          Could not load comments: {loadError}{" "}
          <button type="button" className="btn btn-secondary btn-small" onClick={load}>
            Retry
          </button>
        </div>
      )}
      {comments && comments.length === 0 && <p className="muted" data-testid="comments-empty">No comments yet.</p>}
      {comments && comments.length > 0 && (
        <ol className="comment-list">
          {comments.map((c) => {
            const mine = user?.id === c.author.id;
            const isEditing = editing?.id === c.id;
            return (
              <li key={c.id} className="comment" data-testid="comment">
                <div className="comment-meta">
                  <strong className="comment-author">{c.author.email}</strong>
                  <time dateTime={c.created_at}>
                    {formatUtc(c.created_at)}
                    {c.edited_at && (
                      <span className="edited" title={`Edited ${formatUtc(c.edited_at)}`}>
                        {" "}
                        (edited)
                      </span>
                    )}
                  </time>
                </div>
                {isEditing ? (
                  <form onSubmit={onSaveEdit} noValidate className="comment-edit">
                    <textarea
                      aria-label="Edit comment"
                      rows={3}
                      value={editing.text}
                      onChange={(e) => {
                        setEditing({ ...editing, text: e.target.value });
                        setEditError(null);
                      }}
                      aria-invalid={editError ? true : undefined}
                      autoFocus
                    />
                    {editError && (
                      <p className="field-error" role="alert" data-testid="comment-edit-error">
                        {editError}
                      </p>
                    )}
                    <div className="comment-actions">
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(null)} disabled={savingEdit}>
                        Cancel
                      </button>
                      <button type="submit" className="btn btn-primary btn-small" disabled={savingEdit}>
                        {savingEdit ? "Saving…" : "Save"}
                      </button>
                    </div>
                  </form>
                ) : (
                  <>
                    <p className="comment-body">{c.body}</p>
                    {mine && (
                      <div className="comment-actions">
                        <button
                          type="button"
                          className="btn-link small"
                          aria-label="Edit comment"
                          disabled={editing !== null && editing.text !== editing.original}
                          title={editing !== null && editing.text !== editing.original ? "Save or cancel the other edit first." : undefined}
                          onClick={() => {
                            setNotice(null);
                            setEditError(null);
                            setEditing({ id: c.id, text: c.body, original: c.body });
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn-link small"
                          aria-label="Delete comment"
                          onClick={() => {
                            setNotice(null);
                            setConfirmDelete(c);
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ol>
      )}

      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="new-comment">Add comment</label>
        <textarea
          id="new-comment"
          rows={3}
          placeholder="Write a comment…"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          aria-invalid={error ? true : undefined}
        />
        {error && (
          <p className="field-error" role="alert" data-testid="comment-error">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" className="btn btn-primary" disabled={posting}>
            {posting ? "Posting…" : "Post comment"}
          </button>
        </div>
      </form>

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this comment?"
          message="The comment will be deleted permanently. This cannot be undone."
          confirmLabel="Delete comment"
          busy={deleting}
          onConfirm={() => onDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </aside>
  );
}
