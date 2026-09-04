import { useEffect, useRef, useState, type ReactNode } from "react";
import { api } from "./server/api";
import type { Role } from "./server/db";
import { useRouter, useSession } from "./state";
import { Icon } from "./ui";

export interface NavItem { key: string; label: string; icon: string; }

export const NAV: Record<Role, NavItem[]> = {
  ADMIN: [
    { key: "dashboard", label: "Dashboard", icon: "dashboard" },
    { key: "students", label: "Students", icon: "users" },
    { key: "faculty", label: "Faculty", icon: "cap" },
    { key: "courses", label: "Courses", icon: "book" },
    { key: "attendance", label: "Attendance", icon: "check" },
    { key: "results", label: "Results", icon: "award" },
    { key: "fees", label: "Fees", icon: "wallet" },
    { key: "requests", label: "Requests", icon: "file" },
    { key: "notifications", label: "Notifications", icon: "bell" },
    { key: "exams", label: "Exam Schedule", icon: "clock" },
    { key: "timetable", label: "Timetable", icon: "calendar" },
    { key: "settings", label: "Settings", icon: "settings" },
  ],
  FACULTY: [
    { key: "dashboard", label: "Dashboard", icon: "dashboard" },
    { key: "courses", label: "My Courses", icon: "book" },
    { key: "students", label: "Students", icon: "users" },
    { key: "attendance", label: "Attendance", icon: "check" },
    { key: "marks", label: "Marks Entry", icon: "edit" },
    { key: "assignments", label: "Assignments", icon: "file" },
    { key: "timetable", label: "Timetable", icon: "calendar" },
    { key: "notifications", label: "Notifications", icon: "bell" },
  ],
  STUDENT: [
    { key: "dashboard", label: "Dashboard", icon: "dashboard" },
    { key: "profile", label: "Profile", icon: "user" },
    { key: "courses", label: "Courses", icon: "book" },
    { key: "attendance", label: "Attendance", icon: "check" },
    { key: "marks", label: "Marks", icon: "edit" },
    { key: "results", label: "Results", icon: "award" },
    { key: "performance", label: "Academic Performance", icon: "trend" },
    { key: "coach", label: "Academic Coach", icon: "spark" },
    { key: "timetable", label: "Timetable", icon: "calendar" },
    { key: "exams", label: "Exam Schedule", icon: "clock" },
    { key: "assignments", label: "Assignments", icon: "file" },
    { key: "fees", label: "Fees", icon: "wallet" },
    { key: "requests", label: "Requests", icon: "send" },
    { key: "notifications", label: "Notifications", icon: "bell" },
  ],
};

export function BrandMark({ size = 34 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex items-center justify-center rounded-xl bg-pine-600 text-pine-50 shadow-[0_4px_14px_-4px_rgba(14,105,85,0.7)]" style={{ width: size, height: size }}>
        <Icon name="logo" size={size * 0.62} />
      </span>
      <span className="leading-none">
        <span className="block font-display text-[17px] font-bold tracking-tight text-white">CampusCore</span>
        <span className="mt-1 block font-mono text-[9px] uppercase tracking-[0.22em] text-pine-300">Unified Digital Campus</span>
      </span>
    </div>
  );
}

function GlobalSearch({ role }: { role: Role }) {
  const { navigate } = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState<{ students: { id: string; label: string; sub: string }[]; courses: { id: string; label: string; sub: string }[] }>({ students: [], courses: [] });
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length < 2) { setResults({ students: [], courses: [] }); return; }
      try {
        const r = await api.search(q);
        setResults({ students: r.students, courses: r.courses });
      } catch { /* search is best-effort */ }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => { if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, []);

  if (role === "STUDENT") return null;
  const hasResults = results.students.length > 0 || results.courses.length > 0;

  return (
    <div ref={boxRef} className="relative hidden w-72 md:block">
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"><Icon name="search" size={15} /></span>
      <input
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Search students, courses…"
        className="input pl-9"
      />
      {open && q.trim().length >= 2 && (
        <div className="card anim-pop absolute left-0 right-0 top-11 z-40 overflow-hidden p-1.5 shadow-pop">
          {!hasResults && <p className="px-3 py-3 text-xs text-faint">No matches for “{q}”.</p>}
          {results.students.length > 0 && <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-widest text-faint">Students</p>}
          {results.students.map((s) => (
            <button key={s.id} onClick={() => { setOpen(false); setQ(""); navigate(role === "ADMIN" ? "/admin/students" : "/faculty/students"); }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-pine-50">
              <span className="font-medium text-ink">{s.label}</span>
              <span className="num text-[11px] text-faint">{s.sub}</span>
            </button>
          ))}
          {results.courses.length > 0 && <p className="px-3 pb-1 pt-2 font-mono text-[10px] uppercase tracking-widest text-faint">Courses</p>}
          {results.courses.map((c) => (
            <button key={c.id} onClick={() => { setOpen(false); setQ(""); navigate(role === "ADMIN" ? "/admin/courses" : "/faculty/courses"); }}
              className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] hover:bg-pine-50">
              <span className="font-medium text-ink">{c.label}</span>
              <span className="num text-[11px] text-faint">{c.sub}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function NotifBell() {
  const { user } = useSession();
  const { navigate } = useRouter();
  const [count, setCount] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api.unreadCount().then((c) => { if (alive) setCount(c); }).catch(() => undefined);
    load();
    const t = setInterval(load, 8000);
    return () => { alive = false; clearInterval(t); };
  }, []);
  const roleSeg = user?.role.toLowerCase() ?? "student";
  return (
    <button
      onClick={() => navigate(`/${roleSeg}/notifications`)}
      className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-white text-soft transition-all hover:border-pine-300 hover:text-pine-700"
      aria-label="Notifications"
    >
      <Icon name="bell" size={17} />
      {count > 0 && (
        <span className="absolute -right-1 -top-1 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-blush-500 px-1 font-mono text-[10px] font-semibold text-white">
          {count > 9 ? "9+" : count}
        </span>
      )}
    </button>
  );
}

export function Shell({ role, active, title, children }: { role: Role; active: string; title: string; children: ReactNode }) {
  const { user, logout } = useSession();
  const { navigate } = useRouter();
  const [drawer, setDrawer] = useState(false);
  const items = NAV[role];
  const roleSeg = role.toLowerCase();
  const initials = (user?.name ?? "?").split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();

  const nav = (
    <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-4">
      {items.map((it) => (
        <button key={it.key} className={`nav-item ${active === it.key ? "active" : ""}`}
          onClick={() => { navigate(`/${roleSeg}/${it.key}`); setDrawer(false); }}>
          <Icon name={it.icon} size={16} />
          {it.label}
        </button>
      ))}
    </nav>
  );

  const sidebarInner = (
    <>
      <div className="px-5 pb-6 pt-6"><BrandMark /></div>
      <div className="mx-4 mb-4 flex items-center gap-2 rounded-lg border border-pine-700/60 bg-pine-800/50 px-3 py-2">
        <span className="relative flex h-2 w-2 text-emerald-400"><span className="live-dot absolute inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-pine-200">{role} workspace</span>
      </div>
      {nav}
      <div className="border-t border-pine-800 p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-pine-600 font-display text-xs font-bold text-white">{initials}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-semibold text-pine-50">{user?.name}</p>
            <p className="truncate text-[11px] text-pine-300">{user?.email}</p>
          </div>
          <button onClick={() => void logout()} title="Sign out"
            className="rounded-lg p-2 text-pine-300 transition-colors hover:bg-pine-800 hover:text-white">
            <Icon name="logout" size={16} />
          </button>
        </div>
      </div>
    </>
  );

  return (
    <div className="flex min-h-screen">
      {/* desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-pine-900 lg:flex">
        {sidebarInner}
      </aside>

      {/* mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-pine-950/60 anim-fade" onClick={() => setDrawer(false)} />
          <aside className="anim-rise absolute inset-y-0 left-0 flex w-64 flex-col bg-pine-900 shadow-pop">{sidebarInner}</aside>
        </div>
      )}

      <div className="flex min-h-screen flex-1 flex-col lg:pl-60">
        <header className="sticky top-0 z-20 border-b border-line bg-paper/85 backdrop-blur-md">
          <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
            <button className="rounded-lg border border-line bg-white p-2 text-soft lg:hidden" onClick={() => setDrawer(true)} aria-label="Open menu">
              <Icon name="menu" size={17} />
            </button>
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-faint">{roleSeg} workspace</p>
              <h2 className="truncate font-display text-[15px] font-semibold text-ink">{title}</h2>
            </div>
            <GlobalSearch role={role} />
            <NotifBell />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div key={active} className="anim-rise mx-auto max-w-6xl">{children}</div>
        </main>
        <footer className="border-t border-line px-6 py-4 text-center font-mono text-[10px] uppercase tracking-[0.18em] text-faint">
          CampusCore ERP · one system · one database · {new Date().getFullYear()}
        </footer>
      </div>
    </div>
  );
}
