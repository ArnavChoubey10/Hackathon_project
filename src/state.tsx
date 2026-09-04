import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type ReactNode,
} from "react";
import { api, ApiError } from "./server/api";
import { probeRemote } from "./server/remote";
import type { Role } from "./server/db";

/* ---------------- session ---------------- */

export interface SessionUser { id: string; name: string; email: string; role: Role; }

interface SessionCtx {
  user: SessionUser | null;
  booting: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionCtx | null>(null);

/* ---------------- toast ---------------- */

export interface Toast { id: number; kind: "success" | "error" | "info"; text: string; }
interface ToastCtx { toasts: Toast[]; push: (kind: Toast["kind"], text: string) => void; dismiss: (id: number) => void; }
const ToastContext = createContext<ToastCtx | null>(null);

/* ---------------- router ---------------- */

interface RouteCtx { path: string; navigate: (p: string) => void; }
const RouterContext = createContext<RouteCtx | null>(null);

export const roleHome = (role: Role) => `/${role.toLowerCase()}/dashboard`;

function readHash(): string {
  const h = window.location.hash.replace(/^#/, "");
  return h || "/";
}

/* ---------------- provider ---------------- */

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [booting, setBooting] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [path, setPath] = useState<string>(readHash());
  const toastId = useRef(1);

  useEffect(() => {
    const onHash = () => setPath(readHash());
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // Detect a running Express/SQLite backend; otherwise use the in-browser engine.
      await probeRemote();
      if (localStorage.getItem("campuscore.token")) {
        try {
          const me = await api.me();
          if (alive) setUser({ id: me.id, name: me.name, email: me.email, role: me.role });
        } catch { /* expired/invalid → stays logged out */ }
      }
      if (alive) setBooting(false);
    })();
    return () => { alive = false; };
  }, []);

  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-3), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    const u = res.user;
    setUser(u);
    window.location.hash = roleHome(u.role);
    return u;
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    window.location.hash = "/login";
  }, []);

  const navigate = useCallback((p: string) => {
    if (readHash() === p) return;
    window.location.hash = p;
  }, []);

  const session = useMemo(() => ({ user, booting, login, logout }), [user, booting, login, logout]);
  const toast = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss]);
  const route = useMemo(() => ({ path, navigate }), [path, navigate]);

  return (
    <SessionContext.Provider value={session}>
      <ToastContext.Provider value={toast}>
        <RouterContext.Provider value={route}>
          {children}
        </RouterContext.Provider>
      </ToastContext.Provider>
    </SessionContext.Provider>
  );
}

export function useSession() {
  const ctx = useContext(SessionContext);
  if (!ctx) throw new Error("useSession outside provider");
  return ctx;
}
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside provider");
  return ctx;
}
export function useRouter() {
  const ctx = useContext(RouterContext);
  if (!ctx) throw new Error("useRouter outside provider");
  return ctx;
}

/* ---------------- data fetching hook ---------------- */

export function useApi<T>(fetcher: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetcherRef.current()
      .then((d) => { if (alive) setData(d); })
      .catch((e) => { if (alive) setError(e instanceof ApiError ? e.message : "Something went wrong while loading data."); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, reload };
}

/* ---------------- formatting helpers (presentation only) ---------------- */

export const inr = (n: number) => "₹" + n.toLocaleString("en-IN");

export function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
export function fmtDateShort(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso + (iso.length === 10 ? "T12:00:00" : ""));
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
export function timeAgo(stampIso: string): string {
  const diff = Date.now() - new Date(stampIso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? "yesterday" : `${days}d ago`;
}
export function daysUntil(iso: string): number {
  const a = new Date(todayLocal() + "T12:00:00").getTime();
  const b = new Date(iso + "T12:00:00").getTime();
  return Math.round((b - a) / 86400000);
}
function todayLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
