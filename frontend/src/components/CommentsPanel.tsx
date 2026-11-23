import { FormEvent, useCallback, useEffect, useState } from "react";
import { api, errorMessage } from "../api";
import { formatUtc } from "../format";

type Comment = { id: number; ticket_id: number; author: { id: number; email: string }; body: string; created_at: string };

// §7 comments on a ticket (wireframe 3, right panel): oldest first, author + time, add-only (§7.6).
export default function CommentsPanel({ ticketId }: { ticketId: number }) {
  const [comments, setComments] = useState<Comment[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);

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

  return (
    <aside className="card split-side comments" aria-labelledby="comments-title" data-testid="comments">
      <div className="comments-head">
        <h2 id="comments-title">Comments</h2>
        <span className="count" data-testid="comments-count">
          {comments?.length ?? "–"}
        </span>
      </div>

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
          {comments.map((c) => (
            <li key={c.id} className="comment" data-testid="comment">
              <div className="comment-meta">
                <strong className="comment-author">{c.author.email}</strong>
                <time dateTime={c.created_at}>{formatUtc(c.created_at)}</time>
              </div>
              <p className="comment-body">{c.body}</p>
            </li>
          ))}
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
    </aside>
  );
}
