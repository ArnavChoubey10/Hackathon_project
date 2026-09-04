/* ============================================================================
   AI Provider Abstraction
   Two interchangeable providers behind one interface:
     • local  — deterministic on-device engine (default; no keys, no network,
                cannot fabricate data — it only narrates computed facts)
     • http   — any OpenAI-compatible endpoint. Credentials are read from the
                config store (browser equivalent of AI_API_KEY / AI_MODEL /
                AI_BASE_URL env vars). NEVER hard-coded.
   Any provider failure surfaces as AiUnavailableError → controlled
   AI_SERVICE_UNAVAILABLE response. The ERP itself is never affected.
   ========================================================================= */

import type { AiContext } from "./context";
import { buildProviderMessages } from "./prompt";
import { runDeterministicCoach } from "./coach";

export type SourceTag =
  | "attendance" | "assessment_performance" | "class_average" | "performance_trend"
  | "upcoming_exam" | "assignment" | "curriculum" | "course_feedback" | "academic_profile" | "fees";

export interface CoachAnswer {
  answer: string;
  insights: string[];
  sources: SourceTag[];
}

export interface AiProvider {
  name: string;
  model: string;
  ask(ctx: AiContext, message: string, history: ChatTurn[]): Promise<CoachAnswer>;
}

export interface ChatTurn { role: "user" | "assistant"; content: string; }

export class AiUnavailableError extends Error {
  constructor(message: string) { super(message); this.name = "AiUnavailableError"; }
}

/* ---------------- config (env-var equivalent, persisted client-side) ---------------- */

export interface AiConfig {
  mode: "local" | "http";
  apiKey: string;
  model: string;
  baseUrl: string;
}

const CONFIG_KEY = "campuscore.aiconfig.v1";
export const DEFAULT_AI_CONFIG: AiConfig = {
  mode: "local",
  apiKey: "",
  model: "gpt-4o-mini",
  baseUrl: "https://api.openai.com/v1",
};

export function getAiConfig(): AiConfig {
  try {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (raw) return { ...DEFAULT_AI_CONFIG, ...(JSON.parse(raw) as Partial<AiConfig>) };
  } catch { /* fall through to default */ }
  return { ...DEFAULT_AI_CONFIG };
}

export function saveAiConfig(cfg: AiConfig): AiConfig {
  const clean: AiConfig = {
    mode: cfg.mode === "http" ? "http" : "local",
    apiKey: String(cfg.apiKey ?? "").trim(),
    model: String(cfg.model ?? "").trim() || DEFAULT_AI_CONFIG.model,
    baseUrl: String(cfg.baseUrl ?? "").trim() || DEFAULT_AI_CONFIG.baseUrl,
  };
  localStorage.setItem(CONFIG_KEY, JSON.stringify(clean));
  return clean;
}

/* ---------------- built-in deterministic provider ---------------- */

export class LocalCoachProvider implements AiProvider {
  name = "CampusCore Deterministic Engine";
  model = "rule-based-analytics-v1";
  async ask(ctx: AiContext, message: string, _history: ChatTurn[]): Promise<CoachAnswer> {
    // Small think-time so the analysis step is perceptible in the UI.
    await new Promise((r) => setTimeout(r, 550 + Math.random() * 350));
    return runDeterministicCoach(ctx, message);
  }
}

/* ---------------- OpenAI-compatible HTTP provider ---------------- */

export class HttpCoachProvider implements AiProvider {
  name = "External LLM";
  model: string;
  private cfg: AiConfig;

  constructor(cfg: AiConfig) {
    this.cfg = cfg;
    this.model = cfg.model;
  }

  async ask(ctx: AiContext, message: string, history: ChatTurn[]): Promise<CoachAnswer> {
    if (!this.cfg.apiKey) {
      throw new AiUnavailableError("No AI_API_KEY configured. Add a key in Coach Settings, or switch to the built-in engine.");
    }
    const url = this.cfg.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          temperature: 0.3,
          messages: buildProviderMessages(JSON.stringify(ctx, null, 1), history.slice(-6), message),
        }),
      });
    } catch {
      clearTimeout(timer);
      throw new AiUnavailableError("The AI provider could not be reached (network error or timeout). The rest of the ERP is unaffected.");
    }
    clearTimeout(timer);
    if (res.status === 401 || res.status === 403) throw new AiUnavailableError("The AI provider rejected the API key. Check it in Coach Settings.");
    if (res.status === 429) throw new AiUnavailableError("The AI provider is rate-limiting requests. Please try again in a moment.");
    if (!res.ok) throw new AiUnavailableError(`The AI provider returned an error (HTTP ${res.status}).`);
    let text: unknown;
    try {
      const json = (await res.json()) as { choices?: { message?: { content?: unknown } }[] };
      text = json.choices?.[0]?.message?.content;
    } catch {
      throw new AiUnavailableError("The AI provider returned an invalid response.");
    }
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new AiUnavailableError("The AI provider returned an empty response.");
    }
    // Sources the HTTP model is allowed to cite, based on what the context contains.
    const sources: SourceTag[] = ["academic_profile"];
    if (ctx.attendanceRisks.length) sources.push("attendance");
    if (ctx.courseStatistics.some((c) => c.classAverage !== null)) sources.push("class_average");
    if (ctx.performanceTrends.length) sources.push("performance_trend");
    if (ctx.upcomingExams.length) sources.push("upcoming_exam");
    if (ctx.assignments.some((a) => a.status !== "SUBMITTED")) sources.push("assignment");
    return { answer: text.trim(), insights: [], sources };
  }
}

/* ---------------- resolution ---------------- */

export function resolveProvider(cfg: AiConfig = getAiConfig()): AiProvider {
  if (cfg.mode === "http") return new HttpCoachProvider(cfg);
  return new LocalCoachProvider();
}
