import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../server/api";
import type { AcademicProfile } from "../server/logic";
import { timeAgo, useApi, useSession, useToast } from "../state";
import { Badge, Button, Card, ErrorBox, Icon, Loading, Modal, PageHead, Seg } from "../ui";

/* ---------------- answer formatter (RECOMMENDATION / WHY / EVIDENCE / NEXT STEP) ---------------- */

const SECTION_STYLE: Record<string, { label: string; cls: string }> = {
  RECOMMENDATION: { label: "Recommendation", cls: "text-pine-700" },
  WHY: { label: "Why", cls: "text-ink" },
  EVIDENCE: { label: "Evidence", cls: "text-soft" },
  "NEXT STEP": { label: "Next step", cls: "text-gold-600" },
};

function CoachAnswer({ text }: { text: string }) {
  const lines = text.split("\n");
  const out: React.ReactNode[] = [];
  let current: { key: string; lines: string[] } | null = null;
  const flush = () => {
    if (!current) return;
    const s = SECTION_STYLE[current.key];
    if (s) {
      const isEv = current.key === "EVIDENCE";
      out.push(
        <div key={out.length} className="mt-2.5 first:mt-0">
          <p className={`font-mono text-[9.5px] font-semibold uppercase tracking-[0.18em] ${s.cls}`}>{s.label}</p>
          {isEv ? (
            <ul className="mt-1 space-y-1">
              {current.lines.map((l, i) => (
                <li key={i} className="flex gap-2 text-[12.5px] leading-relaxed text-soft">
                  <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-pine-400" />{l}
                </li>
              ))}
            </ul>
          ) : (
            <p className={`mt-0.5 text-[13px] leading-relaxed ${current.key === "RECOMMENDATION" ? "font-semibold text-ink" : "text-soft"}`}>
              {current.lines.join(" ")}
            </p>
          )}
        </div>,
      );
    } else {
      out.push(<p key={out.length} className="mt-2 whitespace-pre-wrap text-[13px] leading-relaxed text-soft first:mt-0">{current.lines.join("\n")}</p>);
    }
    current = null;
  };
  for (const raw of lines) {
    const line = raw.trim();
    const match = line.match(/^(RECOMMENDATION|WHY|EVIDENCE|NEXT STEP):\s*(.*)$/i);
    if (match) {
      flush();
      current = { key: match[1].toUpperCase(), lines: match[2] ? [match[2]] : [] };
    } else if (current) {
      current.lines.push(line.replace(/^•\s*/, ""));
    } else {
      if (line) { flush(); current = { key: "", lines: [line] }; }
    }
  }
  flush();
  return <div>{out}</div>;
}

/* ---------------- chat message model ---------------- */

interface Msg {
  id: number; role: "user" | "coach";
  content?: string; sources?: string[]; insights?: string[];
  error?: string; canFallback?: boolean;
}

const SUGGESTED = [
  "Which subject should I focus on this week?",
  "Why is my performance declining?",
  "How am I performing compared with my class?",
  "Which subjects are my strongest?",
  "Which subjects need the most attention?",
  "What should I improve before my next exam?",
  "Am I at risk because of attendance?",
  "What topics should I revise first?",
];

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

const sevDot: Record<string, string> = { HIGH: "bg-blush-500", MEDIUM: "bg-gold-500", LOW: "bg-pine-300", GOOD: "bg-emerald-500" };
const prioRail: Record<string, string> = { HIGH: "border-l-blush-500", MEDIUM: "border-l-gold-500", LOW: "border-l-pine-300" };

/* ================= page ================= */

export function CoachPage() {
  const { user } = useSession();
  const { push } = useToast();
  const { data: profile, loading, error, reload } = useApi(() => api.myAcademicProfile(), []);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [engine, setEngine] = useState("Built-in deterministic engine");
  const [cfgOpen, setCfgOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(1);

  useEffect(() => {
    api.aiConfig().then((c) => setEngine(c.mode === "http" ? `External LLM · ${c.model}` : "Built-in deterministic engine")).catch(() => undefined);
  }, [cfgOpen]);

  useEffect(() => {
    const el = boxRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy || !profile) return;
    setInput("");
    setMessages((ms) => [...ms, { id: idRef.current++, role: "user", content: q }]);
    setBusy(true);
    const history = messages
      .filter((m) => (m.role === "user" || m.content) && !m.error)
      .slice(-6)
      .map((m) => ({ role: m.role === "user" ? "user" as const : "assistant" as const, content: m.content ?? "" }));
    try {
      const res = await api.aiChat(q, history);
      if (res.success) {
        setEngine(`${res.provider} · ${res.model}`);
        setMessages((ms) => [...ms, { id: idRef.current++, role: "coach", content: res.answer, sources: res.sources, insights: res.insights }]);
      } else {
        setMessages((ms) => [...ms, { id: idRef.current++, role: "coach", error: res.message, canFallback: res.error === "AI_SERVICE_UNAVAILABLE" }]);
      }
    } catch (e) {
      setMessages((ms) => [...ms, { id: idRef.current++, role: "coach", error: e instanceof ApiError ? e.message : "The coach is unavailable right now." }]);
    } finally {
      setBusy(false);
    }
  };

  const fallbackLocal = async () => {
    await api.saveAiConfig({ mode: "local", apiKey: "", model: "", baseUrl: "" });
    setEngine("Built-in deterministic engine");
    push("success", "Switched to the built-in engine. Ask your question again.");
  };

  if (loading) return <Loading label="Building your academic profile…" />;
  if (error) return <ErrorBox message={error} onRetry={reload} />;
  if (!profile) return null;

  const p = profile;
  const strong = p.courses.filter((c) => c.performance.label === "ABOVE_AVERAGE" || (c.performance.average !== null && c.performance.average >= 75));
  const attention = p.courses.filter((c) => c.performance.label === "BELOW_AVERAGE" || (c.performance.average !== null && c.performance.average < 50));
  const risks = p.courses.filter((c) => c.attendance.belowThreshold);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHead title="Academic Coach" sub="Personalized, evidence-based guidance generated from your live ERP data" />
        <Button tone="subtle" size="sm" onClick={() => setCfgOpen(true)}><Icon name="settings" size={13} /> Coach settings</Button>
      </div>

      {/* ---- greeting banner ---- */}
      <Card className="relative overflow-hidden border-pine-800 bg-pine-900">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-pine-500/15 blur-2xl" />
        <div className="pointer-events-none absolute right-24 -bottom-24 h-56 w-56 rounded-full bg-gold-500/10 blur-2xl" />
        <div className="relative flex flex-wrap items-end justify-between gap-6 p-6">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.22em] text-pine-300">
              {greeting()}, {p.student.name.split(" ")[0]}
            </p>
            <h2 className="mt-1.5 font-display text-[26px] font-bold leading-tight text-white">
              Your week at a glance, from real data.
            </h2>
            <p className="mt-1.5 text-[13px] text-pine-200/80">
              Semester {p.student.semester} · {p.student.program} · Section {p.student.section} · {p.student.regNo}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-4">
            {[
              { k: "Attendance", v: `${p.attendance.percentage}%`, tone: p.attendance.risk === "SAFE" ? "text-pine-200" : "text-gold-100" },
              { k: "Average", v: p.summary.averagePct !== null ? `${p.summary.averagePct}%` : "—", tone: "text-white" },
              { k: "SGPA", v: p.summary.sgpa !== null ? p.summary.sgpa.toFixed(2) : "—", tone: "text-white" },
              { k: "Priorities", v: String(p.priorities.filter((x) => x.priority !== "LOW").length), tone: p.priorities.some((x) => x.priority === "HIGH") ? "text-gold-100" : "text-white" },
            ].map((s) => (
              <div key={s.k}>
                <p className={`num font-display text-[24px] font-bold leading-none ${s.tone}`}>{s.v}</p>
                <p className="mt-1 font-mono text-[9.5px] uppercase tracking-[0.18em] text-pine-300/80">{s.k}</p>
              </div>
            ))}
          </div>
        </div>
        <div className="relative flex items-center gap-2 border-t border-pine-800 px-6 py-2.5">
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 text-emerald-400 live-dot" />
          <p className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-pine-300/70">
            Profile synced {timeAgo(p.generatedAt)} · every figure below comes from the shared campus database
          </p>
        </div>
      </Card>

      {/* ---- priority cards ---- */}
      {p.priorities.length > 0 && (
        <div className="stagger grid gap-4 md:grid-cols-3">
          {p.priorities.slice(0, 3).map((pr) => (
            <Card key={pr.courseId} pad={false} className={`border-l-4 ${prioRail[pr.priority]} transition-transform hover:-translate-y-0.5`}>
              <div className="p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-faint">Priority · {pr.courseCode}</p>
                  <Badge tone={pr.priority === "HIGH" ? "red" : pr.priority === "MEDIUM" ? "gold" : "pine"}>{pr.priority}</Badge>
                </div>
                <p className="mt-1.5 font-display text-[16px] font-bold leading-snug text-ink">{pr.courseName}</p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-paper">
                  <div className={`h-full rounded-full transition-all duration-700 ${pr.priority === "HIGH" ? "bg-blush-500" : pr.priority === "MEDIUM" ? "bg-gold-500" : "bg-pine-400"}`}
                    style={{ width: `${Math.min(100, (pr.score / 12) * 100)}%` }} />
                </div>
                {pr.reasons.length > 0 ? (
                  <ul className="mt-3 space-y-1.5">
                    {pr.reasons.slice(0, 3).map((r, i) => (
                      <li key={i} className="flex gap-2 text-[12px] leading-snug text-soft">
                        <span className="mt-[6px] h-1 w-1 shrink-0 rounded-full bg-faint" />{r}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-[12px] text-faint">No negative signals — maintain momentum.</p>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* ---- chat ---- */}
        <Card pad={false} className="lg:col-span-7">
          <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-pine-600 text-white shadow-lift"><Icon name="bot" size={18} /></span>
              <div>
                <p className="font-display text-[14.5px] font-bold text-ink">Coach</p>
                <p className="num text-[10px] uppercase tracking-wider text-faint">{engine}</p>
              </div>
            </div>
            <Badge tone="gray">STUDENT-only · token-scoped</Badge>
          </div>

          <div ref={boxRef} className="h-[420px] space-y-4 overflow-y-auto px-5 py-4">
            <CoachBubble
              msg={{ id: 0, role: "coach", content: `Hi ${p.student.name.split(" ")[0]} — I read your academic profile from the ERP. ${p.priorities[0]?.priority !== "LOW" && p.priorities[0] ? `Right now, ${p.priorities[0].courseName} looks most urgent. ` : "Everything looks broadly on track. "}Ask me anything below, or tap a suggested question.` }}
            />
            {messages.map((m) => (m.role === "user"
              ? (
                <div key={m.id} className="anim-rise flex justify-end">
                  <div className="max-w-[82%] rounded-xl rounded-br-sm bg-pine-600 px-4 py-2.5 text-[13px] font-medium leading-relaxed text-white shadow-lift">{m.content}</div>
                </div>
              )
              : <CoachBubble key={m.id} msg={m} onFallback={fallbackLocal} />))}
            {busy && (
              <div className="anim-fade flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-pine-50 text-pine-600"><Icon name="bot" size={16} /></span>
                <div className="flex items-center gap-1.5 rounded-xl rounded-bl-sm border border-line bg-white px-4 py-3">
                  {[0, 1, 2].map((i) => (
                    <span key={i} className="h-1.5 w-1.5 rounded-full bg-pine-400" style={{ animation: `tickpulse 1s ${i * 0.18}s infinite` }} />
                  ))}
                  <span className="ml-2 font-mono text-[10px] uppercase tracking-wider text-faint">analyzing academic profile</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-line px-5 py-3">
            <div className="mb-3 flex flex-wrap gap-1.5">
              {SUGGESTED.map((q) => (
                <button key={q} disabled={busy} onClick={() => void send(q)}
                  className="rounded-full border border-line bg-white px-3 py-1.5 text-[11.5px] font-medium text-soft transition-all hover:-translate-y-0.5 hover:border-pine-300 hover:text-pine-700 hover:shadow-lift disabled:opacity-50">
                  {q}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <input
                className="input flex-1" placeholder="Ask about your performance, attendance, exams…"
                value={input} maxLength={800}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void send(input); }}
              />
              <Button onClick={() => void send(input)} disabled={!input.trim() || busy}>
                <Icon name="send" size={14} /> Ask
              </Button>
            </div>
            <p className="mt-2 text-[10.5px] text-faint">
              The coach only sees your own ERP data, never invents numbers, and says so when data is missing.
            </p>
          </div>
        </Card>

        {/* ---- right rail ---- */}
        <div className="space-y-5 lg:col-span-5">
          <Card pad={false}>
            <div className="grid grid-cols-2 divide-x divide-line">
              <div className="p-4">
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-700"><Icon name="trend" size={12} /> Strong subjects</p>
                {strong.length === 0 ? <p className="mt-2 text-[12px] text-faint">None above class average yet.</p> : (
                  <ul className="mt-2 space-y-2">
                    {strong.slice(0, 3).map((c) => (
                      <li key={c.courseId}>
                        <p className="text-[12.5px] font-semibold leading-tight text-ink">{c.courseName}</p>
                        <p className="num text-[11px] text-emerald-700">{c.performance.average}% · class {c.performance.classAverage ?? "—"}%</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="p-4">
                <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-blush-600"><Icon name="alert" size={12} /> Needs attention</p>
                {attention.length === 0 ? <p className="mt-2 text-[12px] text-faint">No weak signals right now.</p> : (
                  <ul className="mt-2 space-y-2">
                    {attention.slice(0, 3).map((c) => (
                      <li key={c.courseId}>
                        <p className="text-[12.5px] font-semibold leading-tight text-ink">{c.courseName}</p>
                        <p className="num text-[11px] text-blush-600">{c.performance.average}% · {c.performance.difference !== null ? `${c.performance.difference} vs class` : "no class data"}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </Card>

          <Card pad={false}>
            <div className="border-b border-line px-4 py-3">
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-soft"><Icon name="check" size={12} /> Attendance risk · 75% threshold</p>
            </div>
            {risks.length === 0 ? (
              <p className="px-4 py-4 text-[12.5px] text-soft">All courses are at or above the threshold. You can safely miss {p.attendance.canMiss} more class{p.attendance.canMiss === 1 ? "" : "es"} overall.</p>
            ) : (
              <ul className="divide-y divide-[#ecf1ec]">
                {risks.map((c) => (
                  <li key={c.courseId} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div>
                      <p className="text-[12.5px] font-semibold text-ink">{c.courseName}</p>
                      <p className="text-[11px] text-soft">Attend next <span className="num font-bold text-blush-600">{c.attendance.classesNeeded}</span> classes to recover</p>
                    </div>
                    <div className="text-right">
                      <p className="num text-[15px] font-bold text-ink">{c.attendance.percentage}%</p>
                      <Badge tone={c.attendance.risk === "CRITICAL" ? "red" : "gold"}>{c.attendance.risk}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card pad={false}>
            <div className="border-b border-line px-4 py-3">
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-soft"><Icon name="clock" size={12} /> Upcoming exams</p>
            </div>
            {p.upcomingExams.length === 0 ? (
              <p className="px-4 py-4 text-[12.5px] text-faint">No exams scheduled for your courses.</p>
            ) : (
              <ul className="divide-y divide-[#ecf1ec]">
                {p.upcomingExams.slice(0, 3).map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-[12.5px] font-semibold text-ink">{e.courseName}</p>
                      <p className="num text-[11px] text-faint">{e.date} · {e.start}–{e.end} · {e.venue}</p>
                    </div>
                    <span className={`num shrink-0 rounded-lg px-2.5 py-1 text-[12px] font-bold ${e.urgency === "IMMINENT" ? "bg-blush-50 text-blush-600" : e.urgency === "NEAR" ? "bg-gold-50 text-gold-600" : "bg-pine-50 text-pine-700"}`}>
                      {e.daysLeft}d
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card pad={false}>
            <div className="border-b border-line px-4 py-3">
              <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-soft"><Icon name="spark" size={12} /> Proactive insights</p>
            </div>
            <ul className="space-y-2.5 px-4 py-3.5">
              {p.insights.slice(0, 6).map((ins, i) => (
                <li key={i} className="flex gap-2.5 text-[12.5px] leading-snug text-soft">
                  <span className={`mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full ${sevDot[ins.severity] ?? "bg-faint"}`} />
                  {ins.text}
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {cfgOpen && <CoachSettings onClose={() => setCfgOpen(false)} onSaved={(label) => { setEngine(label); }} />}
    </div>
  );
}

/* ---------------- coach bubble ---------------- */

function CoachBubble({ msg, onFallback }: { msg: Msg; onFallback?: () => void }) {
  return (
    <div className="anim-rise flex items-start gap-3">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-pine-50 text-pine-600"><Icon name="bot" size={16} /></span>
      <div className="max-w-[86%] rounded-xl rounded-bl-sm border border-line bg-white px-4 py-3 shadow-lift">
        {msg.error ? (
          <div>
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-blush-600"><Icon name="alert" size={13} /> Coach unavailable</p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-soft">{msg.error}</p>
            <p className="mt-1 text-[11.5px] text-faint">The rest of the ERP keeps working normally — only the AI layer is affected.</p>
            {msg.canFallback && onFallback && (
              <Button tone="subtle" size="sm" className="mt-2.5" onClick={() => void onFallback()}>
                <Icon name="refresh" size={12} /> Switch to built-in engine
              </Button>
            )}
          </div>
        ) : (
          <>
            {msg.content && <CoachAnswer text={msg.content} />}
            {msg.insights && msg.insights.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {msg.insights.map((s, i) => <span key={i} className="rounded-full bg-pine-50 px-2.5 py-1 text-[10.5px] font-semibold text-pine-700">{s}</span>)}
              </div>
            )}
            {msg.sources && msg.sources.length > 0 && (
              <p className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-[#ecf1ec] pt-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-faint">sources</span>
                {msg.sources.map((s) => <span key={s} className="num rounded bg-paper px-1.5 py-0.5 font-mono text-[9.5px] text-soft">{s}</span>)}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/* ---------------- settings modal ---------------- */

function CoachSettings({ onClose, onSaved }: { onClose: () => void; onSaved: (label: string) => void }) {
  const { push } = useToast();
  const [mode, setMode] = useState<"local" | "http">("local");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.aiConfig().then((c) => {
      setMode(c.mode); setApiKey(c.apiKey); setModel(c.model); setBaseUrl(c.baseUrl); setLoaded(true);
    }).catch(() => setLoaded(true));
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      const saved = await api.saveAiConfig({ mode, apiKey, model, baseUrl });
      onSaved(saved.mode === "http" ? `External LLM · ${saved.model}` : "Built-in deterministic engine");
      push("success", saved.mode === "http" ? "External provider configured. If it fails, the coach degrades gracefully." : "Using the built-in deterministic engine — no keys needed.");
      onClose();
    } catch (e) {
      push("error", e instanceof ApiError ? e.message : "Could not save settings.");
    } finally { setSaving(false); }
  };

  return (
    <Modal open title="Academic Coach settings" sub="Provider credentials are read from config — never hard-coded" onClose={onClose}>
      {!loaded ? <Loading label="Loading settings…" /> : (
        <div className="space-y-4">
          <div>
            <p className="mb-1.5 text-xs font-semibold text-soft">Provider</p>
            <Seg<"local" | "http"> value={mode} onChange={setMode}
              options={[{ value: "local", label: "Built-in engine" }, { value: "http", label: "External LLM" }]} />
            <p className="mt-1.5 text-[11px] leading-relaxed text-faint">
              The built-in engine runs deterministic analytics on your ERP data — no keys, no network, and it can only cite real numbers.
              The external option calls any OpenAI-compatible endpoint with the same structured context.
            </p>
          </div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-soft">API key <span className="font-mono text-[9px] uppercase tracking-wider text-faint">(AI_API_KEY)</span></span>
            <input className="input num" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              placeholder={mode === "http" ? "sk-…" : "not required"} disabled={mode === "local"} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-soft">Model <span className="font-mono text-[9px] uppercase tracking-wider text-faint">(AI_MODEL)</span></span>
              <input className="input num" value={model} onChange={(e) => setModel(e.target.value)} disabled={mode === "local"} />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-soft">Base URL <span className="font-mono text-[9px] uppercase tracking-wider text-faint">(AI_BASE_URL)</span></span>
              <input className="input num" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} disabled={mode === "local"} placeholder="https://api.openai.com/v1" />
            </label>
          </div>
          <p className="rounded-lg bg-paper px-3 py-2.5 text-[11px] leading-relaxed text-faint">
            Keys are stored only in this browser's config store — never hard-coded, never sent anywhere except the base URL above.
            If the provider is down or the key is missing, chat returns <span className="num">AI_SERVICE_UNAVAILABLE</span> and the ERP is unaffected.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button tone="ghost" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()} loading={saving}><Icon name="check" size={14} /> Save settings</Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
