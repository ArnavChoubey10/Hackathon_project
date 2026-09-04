import { useState } from "react";
import { ApiError } from "../server/api";
import { useSession, useToast } from "../state";
import { BrandMark } from "../layout";
import { Button, Icon } from "../ui";
import { downloadProjectZip, projectFileCount } from "../download";

const DEMO = [
  { role: "Admin", email: "admin@college.edu", tone: "bg-pine-600" },
  { role: "Faculty", email: "faculty@college.edu", tone: "bg-gold-600" },
  { role: "Student — Aarav", email: "aarav@college.edu", tone: "bg-emerald-600" },
  { role: "Student — Neha", email: "neha@college.edu", tone: "bg-sky-600" },
];

const FLOW = [
  { icon: "edit", text: "Faculty marks attendance" },
  { icon: "db", text: "Database updates instantly" },
  { icon: "user", text: "Student dashboard recalculates" },
  { icon: "trend", text: "Risk insights regenerate" },
];

export default function Login() {
  const { login } = useSession();
  const { push } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("demo123");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zipping, setZipping] = useState(false);

  const getZip = async () => {
    setZipping(true);
    try {
      const n = await downloadProjectZip();
      push("success", `campuscore-erp.zip downloaded — ${n} files. Unzip, then run npm install and npm run dev.`);
    } catch {
      push("error", "Could not build the zip file. Please try again.");
    } finally {
      setZipping(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      push("success", `Welcome back, ${u.name.split(" ")[0]}. Signed in as ${u.role.toLowerCase()}.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Unable to sign in right now.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen">
      {/* brand panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-pine-900 p-10 lg:flex">
        <div className="pointer-events-none absolute inset-0 opacity-40"
          style={{ background: "radial-gradient(700px 400px at 20% 0%, rgba(21,122,99,0.5), transparent 60%), radial-gradient(500px 400px at 100% 100%, rgba(199,116,20,0.18), transparent 60%)" }} />
        <div className="pointer-events-none absolute inset-0"
          style={{ backgroundImage: "radial-gradient(rgba(237,245,241,0.07) 1px, transparent 1px)", backgroundSize: "26px 26px" }} />

        <div className="relative"><BrandMark size={40} /></div>

        <div className="relative max-w-md">
          <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-pine-300">College ERP · Hackathon Build</p>
          <h1 className="mt-4 font-display text-[40px] font-bold leading-[1.08] tracking-tight text-white">
            One system.<br />One database.<br />
            <span className="text-pine-300">Three workspaces.</span>
          </h1>
          <p className="mt-4 text-[14px] leading-relaxed text-pine-200/90">
            Admin, faculty and students share the same live records — attendance, marks,
            class averages, fees and results flow through a single source of truth.
          </p>

          <div className="mt-8 space-y-0">
            {FLOW.map((f, i) => (
              <div key={f.text} className="anim-rise flex items-center gap-3" style={{ animationDelay: `${0.15 + i * 0.12}s` }}>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-pine-700 bg-pine-800/70 text-pine-200">
                  <Icon name={f.icon} size={14} />
                </span>
                <span className="text-[13px] font-medium text-pine-100">{f.text}</span>
                {i < FLOW.length - 1 && <span className="ml-auto font-mono text-[10px] text-pine-500">↓ then</span>}
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-pine-400">
          <span className="relative flex h-2 w-2 text-emerald-400"><span className="live-dot absolute inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
          Academic Profile API ready · AI Coach foundation built in
        </div>
      </div>

      {/* form panel */}
      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 lg:hidden"><BrandMark size={36} /></div>
          <p className="font-mono text-[11px] uppercase tracking-[0.25em] text-pine-600">Sign in</p>
          <h2 className="mt-2 font-display text-[26px] font-bold tracking-tight text-ink">Access your workspace</h2>
          <p className="mt-1 text-[13px] text-soft">Role-based dashboards on one shared database.</p>

          <form onSubmit={submit} className="mt-7 space-y-4">
            {error && (
              <div className="anim-pop flex items-start gap-2.5 rounded-lg border border-blush-500/25 bg-blush-50 px-3.5 py-3 text-[13px] font-medium text-blush-700">
                <span className="mt-0.5"><Icon name="alert" size={15} /></span>{error}
              </div>
            )}
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-soft">College email</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"><Icon name="mail" size={15} /></span>
                <input className="input pl-9" placeholder="you@college.edu" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
              </div>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-soft">Password</span>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"><Icon name="shield" size={15} /></span>
                <input className="input pl-9" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
              </div>
            </label>
            <Button type="submit" loading={busy} className="w-full py-2.5!">
              {!busy && <Icon name="arrowRight" size={15} />} Sign in to CampusCore
            </Button>
          </form>

          <div className="mt-7">
            <p className="mb-2.5 font-mono text-[10px] uppercase tracking-[0.2em] text-faint">Demo accounts · password demo123</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button key={d.email} onClick={() => { setEmail(d.email); setPassword("demo123"); setError(null); }}
                  className="group flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-left transition-all hover:-translate-y-0.5 hover:border-pine-300 hover:shadow-lift">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${d.tone}`} />
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-semibold text-ink">{d.role}</span>
                    <span className="num block truncate text-[10px] text-faint">{d.email}</span>
                  </span>
                </button>
              ))}
            </div>
            <button onClick={() => { setEmail("student1@college.edu"); setPassword("demo123"); setError(null); }}
              className="mt-2 w-full text-center font-mono text-[10px] uppercase tracking-[0.15em] text-faint transition-colors hover:text-pine-600">
              more: student1@ / student2@college.edu
            </button>
          </div>

          <div className="mt-6 flex items-center justify-between gap-3 rounded-xl border border-dashed border-pine-300 bg-pine-50/60 px-4 py-3">
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold text-ink">Take the project with you</p>
              <p className="num text-[10.5px] text-soft">{projectFileCount()} source files · runs with <span className="font-semibold">npm install → npm run dev</span></p>
            </div>
            <Button tone="subtle" size="sm" onClick={() => void getZip()} loading={zipping} className="shrink-0">
              {!zipping && <Icon name="download" size={13} />} .zip
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
