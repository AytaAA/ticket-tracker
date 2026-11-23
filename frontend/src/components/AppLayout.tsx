import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { errorMessage } from "../api";
import { useAuth } from "../auth";

// Header for authenticated screens. §15: the collapsed user menu includes "Log out".
export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  async function onLogout() {
    setError(null);
    try {
      await logout();
      navigate("/login", { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">Ticket Tracker</span>
        <nav>
          <NavLink to="/board">Board</NavLink>
          <NavLink to="/teams">Teams</NavLink>
          <NavLink to="/epics">Epics</NavLink>
        </nav>
        <div className="user-menu" ref={menuRef}>
          <button
            type="button"
            className="user-menu-button"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            data-testid="user-menu"
          >
            {user?.email} ▾
          </button>
          {open && (
            <div className="user-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={onLogout}>
                Log out
              </button>
            </div>
          )}
        </div>
      </header>
      {error && (
        <p className="alert alert-error" role="alert">
          {error}
        </p>
      )}
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}
