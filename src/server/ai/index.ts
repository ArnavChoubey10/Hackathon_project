/* ============================================================================
   Academic Coach Service — POST /api/ai/chat backend logic
   Pipeline: authenticated profile → deterministic analytics (already in the
   profile) → AI context builder → provider → validated safe response.
   The AI layer never queries the database and never chooses whose data to
   load — the API layer derives the student identity from the session token.
   ========================================================================= */

import type { AcademicProfile } from "../logic";
import { buildAiContext } from "./context";
import { AiUnavailableError, getAiConfig, resolveProvider, type ChatTurn, type SourceTag } from "./provider";

export type AiErrorCode = "AI_SERVICE_UNAVAILABLE" | "INVALID_REQUEST";

export type AiChatResponse =
  | { success: true; answer: string; insights: string[]; sources: SourceTag[]; provider: string; model: string }
  | { success: false; error: AiErrorCode; message: string };

/** `profile` is always built server-side from the token-derived student ID. */
export async function aiChat(profile: AcademicProfile, message: string, history: ChatTurn[]): Promise<AiChatResponse> {
  const clean = message.trim().slice(0, 800);
  if (!clean) {
    return { success: false, error: "INVALID_REQUEST", message: "Please ask a question about your academics." };
  }
  try {
    const ctx = buildAiContext(profile);
    const provider = resolveProvider(getAiConfig());
    const result = await provider.ask(ctx, clean, history);
    if (typeof result.answer !== "string" || result.answer.trim().length === 0) {
      return { success: false, error: "AI_SERVICE_UNAVAILABLE", message: "The coach returned an empty response. Please try again." };
    }
    return {
      success: true,
      answer: result.answer.trim(),
      insights: Array.isArray(result.insights) ? result.insights.filter((i) => typeof i === "string").slice(0, 6) : [],
      sources: Array.isArray(result.sources) ? result.sources.slice(0, 8) : ["academic_profile"],
      provider: provider.name,
      model: provider.model,
    };
  } catch (e) {
    if (e instanceof AiUnavailableError) {
      return { success: false, error: "AI_SERVICE_UNAVAILABLE", message: e.message };
    }
    return { success: false, error: "AI_SERVICE_UNAVAILABLE", message: "The Academic Coach is temporarily unavailable. Your ERP data is unaffected — try again shortly." };
  }
}

export { getAiConfig, saveAiConfig, type AiConfig } from "./provider";
