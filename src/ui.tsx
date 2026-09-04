import { useEffect, useRef, useState, type ReactNode } from "react";
import type { AttendanceRisk, FeeStatus, RequestStatus, Trend } from "./server/db";

/* ================= icons (inline SVG, stroke-based) ================= */

const PATHS: Record<string, ReactNode> = {
  logo: <><path d="M4 17.5V7L12 3l8 4v10.5L12 21l-8-3.5z" /><path d="M12 10v6M8.5 12l3.5 1.8L15.5 12" /></>,
  dashboard: <><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.5" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.5" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.5" /></>,
  users: <><circle cx="9" cy="8" r="3.2" /><path d="M3.5 19.5c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" /><path d="M15.5 5.4a3.2 3.2 0 010 5.9M17.5 14.9c1.7.7 2.7 2.3 3 4.6" /></>,
  user: <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20c.7-3.7 3.3-5.7 6.5-5.7s5.8 2 6.5 5.7" /></>,
  book: <><path d="M4 5.5A2.5 2.5 0 016.5 3H20v15.5H6.5A2.5 2.5 0 004 21V5.5z" /><path d="M4 18.5A2.5 2.5 0 016.5 16H20" /></>,
  calendar: <><rect x="3.5" y="5" width="17" height="15.5" rx="2" /><path d="M3.5 9.5h17M8 3v4M16 3v4" /></>,
  clock: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></>,
  chart: <><path d="M4 20V4" /><path d="M4 20h16" /><path d="M8 16v-5M12 16V7M16 16v-3M20 16V9" /></>,
  trend: <><path d="M3.5 17l5-5 3.5 3.5L20.5 8" /><path d="M15.5 8h5v5" /></>,
  bell: <><path d="M6 9.5a6 6 0 0112 0c0 5 1.8 6 1.8 6H4.2s1.8-1 1.8-6z" /><path d="M10 19a2 2 0 004 0" /></>,
  wallet: <><rect x="3.5" y="6" width="17" height="13" rx="2" /><path d="M3.5 9.5h17M16.5 14.5h1.5" /><path d="M6.5 6V5a1.5 1.5 0 011.5-1.5h9" /></>,
  file: <><path d="M6 3.5h8L19 8.5V20a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 20V5A1.5 1.5 0 016.5 3.5z" /><path d="M13.5 3.5v5.5H19M8.5 13h7M8.5 16.5h5" /></>,
  check: <path d="M4.5 12.5l5 5 10-11" />,
  x: <path d="M6 6l12 12M18 6L6 18" />,
  alert: <><path d="M12 3.5L2.5 20h19L12 3.5z" /><path d="M12 10v4.5M12 17.5v.5" /></>,
  info: <><circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 7.5v.5" /></>,
  search: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <><path d="M14.5 5l4.5 4.5L8.5 20H4v-4.5L14.5 5z" /><path d="M12.5 7l4.5 4.5" /></>,
  trash: <><path d="M4.5 6.5h15M9.5 6V4.5h5V6M6.5 6.5l1 13h9l1-13" /><path d="M10 10.5v5M14 10.5v5" /></>,
  logout: <><path d="M14 4h-8v16h8" /><path d="M10 12h10.5M17 8.5l3.5 3.5-3.5 3.5" /></>,
  chevronDown: <path d="M6 9.5l6 6 6-6" />,
  chevronRight: <path d="M9.5 6l6 6-6 6" />,
  arrowRight: <path d="M4 12h15M13.5 6l6 6-6 6" />,
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="0.8" /></>,
  shield: <><path d="M12 3l7.5 3v6c0 4.6-3.2 7.6-7.5 9-4.3-1.4-7.5-4.4-7.5-9V6L12 3z" /><path d="M8.8 12l2.2 2.2 4.2-4.4" /></>,
  mail: <><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="M4 7l8 6 8-6" /></>,
  phone: <path d="M7.5 3.5h3l1.5 4.5-2 1.5a12 12 0 004.5 4.5l1.5-2 4.5 1.5v3a2 2 0 01-2.2 2A16.5 16.5 0 015.5 5.7a2 2 0 012-2.2z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3.5l1.2 2.6 2.8-.7 1 2.7 2.8.8-.7 2.8 2 2-2 2 .7 2.8-2.8.8-1 2.7-2.8-.7L12 20.5l-1.2-2.6-2.8.7-1-2.7-2.8-.8.7-2.8-2-2 2-2-.7-2.8 2.8-.8 1-2.7 2.8.7L12 3.5z" /></>,
  award: <><circle cx="12" cy="9" r="5" /><path d="M8.5 13l-1.5 7 5-2.5 5 2.5-1.5-7" /></>,
  spark: <><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" /><path d="M18.5 15.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6z" /></>,
  cap: <><path d="M12 4L2.5 8.5 12 13l9.5-4.5L12 4z" /><path d="M6.5 10.5V15c0 1.4 2.5 2.8 5.5 2.8s5.5-1.4 5.5-2.8v-4.5" /><path d="M21.5 8.5V14" /></>,
  db: <><ellipse cx="12" cy="5.5" rx="7.5" ry="3" /><path d="M4.5 5.5v13c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3v-13" /><path d="M4.5 12c0 1.7 3.4 3 7.5 3s7.5-1.3 7.5-3" /></>,
  refresh: <><path d="M4.5 12a7.5 7.5 0 0113-5.2L20 9.5" /><path d="M20 4.5v5h-5M19.5 12a7.5 7.5 0 01-13 5.2L4 14.5" /><path d="M4 19.5v-5h5" /></>,
  send: <><path d="M20.5 3.5L10 14" /><path d="M20.5 3.5L14 20.5l-4-6.5-7-3 17.5-7.5z" /></>,
  bot: <><rect x="4.5" y="8" width="15" height="11" rx="2.5" /><path d="M12 8V4.5" /><circle cx="12" cy="3.5" r="1" /><circle cx="9" cy="13" r="1.2" /><circle cx="15" cy="13" r="1.2" /><path d="M9 16.5h6" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></>,
};

export function Icon({ name, size = 18, className = "" }: { name: string; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {PATHS[name] ?? <circle cx="12" cy="12" r="8" />}
    </svg>
  );
}

/* ================= primitives ================= */

const btnTones: Record<string, string> = {
  primary: "bg-gold-600 text-white hover:bg-gold-700 active:scale-[0.98] shadow-sm",
  dark: "bg-pine-900 text-pine-50 hover:bg-pine-800 active:scale-[0.98]",
  ghost: "bg-transparent border border-line text-ink hover:border-pine-300 hover:bg-pine-50 active:scale-[0.98]",
  danger: "bg-blush-600 text-white hover:bg-blush-700 active:scale-[0.98]",
  dangerGhost: "bg-transparent border border-blush-500/40 text-blush-600 hover:bg-blush-50 active:scale-[0.98]",
  subtle: "bg-pine-50 text-pine-700 hover:bg-pine-100 active:scale-[0.98]",
};

export function Button({
  children, onClick, tone = "primary", size = "md", disabled, loading, className = "", type = "button",
}: {
  children: ReactNode; onClick?: () => void; tone?: keyof typeof btnTones;
  size?: "sm" | "md"; disabled?: boolean; loading?: boolean; className?: string; type?: "button" | "submit";
}) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed ${size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-[13px]"} ${btnTones[tone]} ${className}`}>
      {loading && <Spinner size={13} light={tone === "primary" || tone === "dark" || tone === "danger"} />}
      {children}
    </button>
  );
}

export function Spinner({ size = 16, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className="animate-spin" aria-label="Loading">
      <circle cx="12" cy="12" r="9" stroke={light ? "rgba(255,255,255,0.3)" : "#dbe3ee"} strokeWidth="3" fill="none" />
      <path d="M21 12a9 9 0 00-9-9" stroke={light ? "#fff" : "#b45309"} strokeWidth="3" strokeLinecap="round" fill="none" />
    </svg>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800 border-emerald-200",
  gold: "bg-gold-50 text-gold-700 border-gold-100",
  red: "bg-blush-50 text-blush-700 border-blush-500/20",
  pine: "bg-pine-50 text-pine-700 border-pine-100",
  gray: "bg-[#eef1ee] text-soft border-line",
  ink: "bg-pine-900 text-pine-100 border-pine-800",
  blue: "bg-sky-100 text-sky-800 border-sky-200",
};
export function Badge({ tone = "gray", children, className = "" }: { tone?: keyof typeof badgeTones; children: ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[11px] font-semibold tracking-wide ${badgeTones[tone]} ${className}`}>
      {children}
    </span>
  );
}

export function RiskBadge({ risk }: { risk: AttendanceRisk }) {
  const map = { SAFE: "green" as const, WARNING: "gold" as const, CRITICAL: "red" as const };
  return <Badge tone={map[risk]}>{risk}</Badge>;
}
export function FeeBadge({ status }: { status: FeeStatus }) {
  const map = { PAID: "green" as const, PARTIAL: "gold" as const, PENDING: "red" as const };
  return <Badge tone={map[status]}>{status}</Badge>;
}
export function RequestBadge({ status }: { status: RequestStatus }) {
  const map = { PENDING: "gold" as const, APPROVED: "green" as const, REJECTED: "red" as const, COMPLETED: "pine" as const };
  return <Badge tone={map[status]}>{status}</Badge>;
}
export function GradeBadge({ grade }: { grade: string }) {
  const tone = grade === "F" ? "red" : grade.startsWith("A") ? "green" : grade.startsWith("B") ? "pine" : "gold";
  return <span className={`num inline-flex h-7 min-w-9 items-center justify-center rounded-md border px-1.5 text-xs font-semibold ${badgeTones[tone]}`}>{grade}</span>;
}
export function TrendChip({ trend }: { trend: Trend }) {
  if (trend === "INSUFFICIENT_DATA") return <Badge tone="gray">NO DATA</Badge>;
  const map = { IMPROVING: "green", DECLINING: "red", STABLE: "gray" } as const;
  const icon = trend === "IMPROVING" ? "trend" : trend === "DECLINING" ? "alert" : "target";
  return <Badge tone={map[trend]}><Icon name={icon} size={11} />{trend}</Badge>;
}
export function DiffBadge({ diff }: { diff: number | null }) {
  if (diff === null) return <span className="text-faint text-xs">—</span>;
  const sign = diff > 0 ? "+" : "";
  const cls = diff >= 3 ? "text-emerald-700 bg-emerald-50" : diff <= -3 ? "text-blush-600 bg-blush-50" : "text-soft bg-[#eef1ee]";
  return <span className={`num rounded px-1.5 py-0.5 text-xs font-semibold ${cls}`}>{sign}{diff}</span>;
}

/* ================= layout primitives ================= */

export function Card({ children, className = "", pad = true }: { children: ReactNode; className?: string; pad?: boolean }) {
  return <div className={`card ${pad ? "p-5" : ""} ${className}`}>{children}</div>;
}

export function CardHead({ title, sub, right, icon }: { title: string; sub?: string; right?: ReactNode; icon?: string }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        {icon && (
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-pine-50 text-pine-600">
            <Icon name={icon} size={16} />
          </span>
        )}
        <div>
          <h3 className="font-display text-[15px] font-semibold leading-tight text-ink">{title}</h3>
          {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
        </div>
      </div>
      {right}
    </div>
  );
}

export function PageHead({ title, sub, right }: { title: string; sub?: string; right?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-[26px] font-bold leading-tight tracking-tight text-ink">{title}</h1>
        {sub && <p className="mt-1 text-[13px] text-soft">{sub}</p>}
      </div>
      {right && <div className="flex items-center gap-2">{right}</div>}
    </div>
  );
}

/* ================= animated stat ================= */

export function CountUp({ value, decimals = 0, suffix = "" }: { value: number; decimals?: number; suffix?: string }) {
  const [shown, setShown] = useState(0);
  const prev = useRef(0);
  useEffect(() => {
    const from = prev.current;
    prev.current = value;
    const start = performance.now();
    const dur = 700;
    let raf = 0;
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(from + (value - from) * eased);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="num">{shown.toLocaleString("en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</span>;
}

export function Stat({ label, value, decimals = 0, suffix = "", icon, tone = "pine", hint }: {
  label: string; value: number; decimals?: number; suffix?: string; icon: string;
  tone?: "pine" | "gold" | "red" | "ink"; hint?: string;
}) {
  const tones = {
    pine: "bg-pine-50 text-pine-600",
    gold: "bg-gold-50 text-gold-600",
    red: "bg-blush-50 text-blush-600",
    ink: "bg-pine-900 text-pine-100",
  };
  return (
    <div className="card group relative overflow-hidden p-4 transition-transform duration-200 hover:-translate-y-0.5">
      <div className="flex items-center justify-between">
        <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${tones[tone]} transition-transform duration-200 group-hover:scale-110`}>
          <Icon name={icon} size={17} />
        </span>
        {hint && <span className="text-[11px] font-medium text-faint">{hint}</span>}
      </div>
      <div className="mt-3 font-display text-[26px] font-bold leading-none tracking-tight">
        <CountUp value={value} decimals={decimals} suffix={suffix} />
      </div>
      <div className="mt-1.5 text-xs font-medium text-soft">{label}</div>
    </div>
  );
}

/* ================= charts (hand-rolled SVG) ================= */

export function Donut({ pct, size = 116, tone = "pine", label }: { pct: number; size?: number; tone?: "pine" | "gold" | "red"; label?: string }) {
  const r = (size - 14) / 2;
  const c = 2 * Math.PI * r;
  const clamped = Math.min(100, Math.max(0, pct));
  const off = c - (clamped / 100) * c;
  const colors = { pine: "#1a365d", gold: "#d97706", red: "#d93654" };
  const [animated, setAnimated] = useState(c);
  useEffect(() => {
    const t = setTimeout(() => setAnimated(off), 60);
    return () => clearTimeout(t);
  }, [off, c]);
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e4eae4" strokeWidth="10" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={colors[tone]} strokeWidth="10"
          strokeLinecap="round" strokeDasharray={c} strokeDashoffset={animated}
          style={{ transition: "stroke-dashoffset 1s cubic-bezier(0.22,1,0.36,1)" }} />
      </svg>
      <div className="absolute text-center">
        <div className="num font-display text-xl font-bold leading-none">{pct}%</div>
        {label && <div className="mt-1 text-[10px] font-medium uppercase tracking-wider text-faint">{label}</div>}
      </div>
    </div>
  );
}

export function Spark({ points, height = 44, tone = "#1a365d" }: { points: number[]; height?: number; tone?: string }) {
  if (points.length < 2) return <div className="flex h-11 items-center text-[11px] text-faint">Not enough data yet</div>;
  const w = 130;
  const min = Math.min(...points) - 4;
  const max = Math.max(...points) + 4;
  const step = w / (points.length - 1);
  const pts = points.map((p, i) => `${(i * step).toFixed(1)},${(height - ((p - min) / (max - min)) * height).toFixed(1)}`);
  return (
    <svg width={w} height={height} className="overflow-visible">
      <polyline points={pts.join(" ")} fill="none" stroke={tone} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="spark-path" />
      <circle cx={pts[pts.length - 1].split(",")[0]} cy={pts[pts.length - 1].split(",")[1]} r="3.4" fill={tone} />
    </svg>
  );
}

export function BarRow({ label, value, max = 100, tone = "pine", suffix = "%" }: { label: string; value: number; max?: number; tone?: "pine" | "gold" | "red"; suffix?: string }) {
  const colors = { pine: "bg-pine-500", gold: "bg-gold-500", red: "bg-blush-500" };
  const pct = max === 0 ? 0 : Math.min(100, (value / max) * 100);
  const [w, setW] = useState(0);
  useEffect(() => {
    const t = setTimeout(() => setW(pct), 80);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="font-medium text-soft">{label}</span>
        <span className="num font-semibold text-ink">{value}{suffix}</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-[#e8eee8]">
        <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${w}%`, transition: "width 0.9s cubic-bezier(0.22,1,0.36,1)" }} />
      </div>
    </div>
  );
}

export function Progress({ pct, tone = "pine" }: { pct: number; tone?: "pine" | "gold" | "red" }) {
  const colors = { pine: "bg-pine-500", gold: "bg-gold-500", red: "bg-blush-500" };
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e8eee8]">
      <div className={`h-full rounded-full ${colors[tone]}`} style={{ width: `${Math.min(100, pct)}%`, transition: "width 0.8s cubic-bezier(0.22,1,0.36,1)" }} />
    </div>
  );
}

/* ================= modal / fields / states ================= */

export function Modal({ open, onClose, title, sub, children, wide }: {
  open: boolean; onClose: () => void; title: string; sub?: string; children: ReactNode; wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-pine-950/50 p-0 backdrop-blur-[3px] anim-fade sm:items-center sm:p-6" onClick={onClose}>
      <div className={`card anim-pop max-h-[92vh] w-full overflow-y-auto rounded-b-none rounded-t-2xl p-6 shadow-pop sm:rounded-xl ${wide ? "sm:max-w-2xl" : "sm:max-w-md"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="font-display text-lg font-bold text-ink">{title}</h3>
            {sub && <p className="mt-0.5 text-xs text-faint">{sub}</p>}
          </div>
          <button onClick={onClose} className="rounded-md p-1.5 text-faint transition-colors hover:bg-paper hover:text-ink" aria-label="Close">
            <Icon name="x" size={16} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function Field({ label, error, children, hint }: { label: string; error?: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-baseline justify-between text-xs font-semibold text-soft">
        {label}
        {hint && <span className="font-normal text-faint">{hint}</span>}
      </span>
      {children}
      {error && <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-blush-600"><Icon name="alert" size={11} />{error}</span>}
    </label>
  );
}

export function Seg<T extends string>({ options, value, onChange }: { options: { value: T; label: string; tone?: "green" | "red" }[]; value: T | null; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex overflow-hidden rounded-lg border border-line bg-paper p-0.5">
      {options.map((o) => {
        const active = value === o.value;
        const activeCls = o.tone === "green" ? "bg-emerald-600 text-white" : o.tone === "red" ? "bg-blush-600 text-white" : "bg-pine-900 text-white";
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={`rounded-md px-3 py-1.5 text-xs font-semibold transition-all duration-150 ${active ? activeCls + " shadow-sm" : "text-soft hover:text-ink"}`}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Empty({ icon = "db", title, sub, action }: { icon?: string; title: string; sub?: string; action?: ReactNode }) {
  return (
    <div className="anim-fade flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="relative mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-pine-50 text-pine-400">
        <Icon name={icon} size={26} />
        <span className="absolute -right-1 -top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gold-50 text-gold-600">
          <Icon name="search" size={11} />
        </span>
      </div>
      <p className="font-display text-[15px] font-semibold text-ink">{title}</p>
      {sub && <p className="mt-1 max-w-sm text-xs leading-relaxed text-faint">{sub}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="anim-fade flex items-center gap-3 px-2 py-10 text-soft">
      <Spinner size={18} />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="anim-fade flex items-start gap-3 rounded-xl border border-blush-500/25 bg-blush-50 p-4">
      <span className="mt-0.5 text-blush-600"><Icon name="alert" size={18} /></span>
      <div>
        <p className="text-[13px] font-semibold text-blush-700">{message}</p>
        {onRetry && (
          <button onClick={onRetry} className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-blush-600 hover:underline">
            <Icon name="refresh" size={12} /> Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5 p-1">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton h-9" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

export function ToastHost() {
  return null; // rendered by App via context
}
