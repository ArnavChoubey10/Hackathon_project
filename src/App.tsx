import { useEffect } from "react";
import { AppProvider, roleHome, useRouter, useSession, useToast } from "./state";
import { NAV, Shell } from "./layout";
import { Icon } from "./ui";
import Login from "./pages/Login";
import { AdminWorkspace } from "./pages/admin";
import { FacultyWorkspace } from "./pages/faculty";
import { StudentWorkspace } from "./pages/student";
import type { Role } from "./server/db";

function ToastHost() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div key={t.id}
          className={`anim-toast pointer-events-auto flex items-start gap-2.5 rounded-xl border p-3.5 shadow-pop ${
            t.kind === "success" ? "border-emerald-200 bg-white" : t.kind === "error" ? "border-blush-500/30 bg-white" : "border-line bg-white"}`}>
          <span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${
            t.kind === "success" ? "bg-emerald-100 text-emerald-700" : t.kind === "error" ? "bg-blush-50 text-blush-600" : "bg-pine-50 text-pine-600"}`}>
            <Icon name={t.kind === "success" ? "check" : t.kind === "error" ? "alert" : "info"} size={13} />
          </span>
          <p className="flex-1 text-[12.5px] font-medium leading-snug text-ink">{t.text}</p>
          <button onClick={() => dismiss(t.id)} className="text-faint transition-colors hover:text-ink" aria-label="Dismiss">
            <Icon name="x" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}

function BootScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-pine-600 text-white shadow-lift">
          <Icon name="logo" size={26} />
        </span>
        <span className="font-display text-xl font-bold text-ink">CampusCore</span>
      </div>
      <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-pine-500" /> connecting to campus database
      </div>
    </div>
  );
}

function Router() {
  const { user, booting } = useSession();
  const { path, navigate } = useRouter();

  const segments = path.split("/").filter(Boolean);
  const roleSeg = segments[0]?.toLowerCase() ?? "";
  const page = segments[1] ?? "dashboard";

  // Guards
  useEffect(() => {
    if (booting) return;
    if (!user) {
      if (roleSeg !== "login") navigate("/login");
      return;
    }
    const expected = user.role.toLowerCase();
    if (roleSeg === "login" || roleSeg === "" || roleSeg !== expected) {
      navigate(roleHome(user.role));
    }
  }, [booting, user, roleSeg, navigate]);

  if (booting) return <BootScreen />;
  if (!user) return <Login />;

  const role = user.role as Role;
  const roleL = role.toLowerCase();
  if (roleSeg !== roleL) return null; // redirecting

  const navItems = NAV[role];
  const activeKey = navItems.some((n) => n.key === page) ? page : "dashboard";
  const title = navItems.find((n) => n.key === activeKey)?.label ?? "Dashboard";

  return (
    <Shell role={role} active={activeKey} title={title}>
      {role === "ADMIN" && <AdminWorkspace page={activeKey} />}
      {role === "FACULTY" && <FacultyWorkspace page={activeKey} />}
      {role === "STUDENT" && <StudentWorkspace page={activeKey} />}
    </Shell>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Router />
      <ToastHost />
    </AppProvider>
  );
}
