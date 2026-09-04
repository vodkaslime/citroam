import { invoke } from "@tauri-apps/api/core";
import type { AgentContext, AgentIntent, AgentModel } from "./agentCore";
import type { Card } from "../domain/canvas";

/** The activity returned by the DeepSeek Harness SDK bridge. */
export interface HarnessRun {
  finalResponse: string;
  events: unknown[];
}

/**
 * Keep the model-facing scene deliberately smaller than the local Workspace.
 * Geometry, areas, viewport history and persistence metadata are useful to the
 * renderer but are not needed to understand a user's maintenance request.
 */
export interface HarnessWorkspaceContext {
  now: string;
  currentPage: AgentContext["currentPage"];
  selectedCardId: string | null;
  view: AgentContext["view"];
  overviewStatus: AgentContext["overviewStatus"];
  workspace: {
    cards: Array<Pick<Card, "id" | "title" | "status" | "timeConstraint" | "priority">>;
    placements: Array<{ cardId: string; pageKey: string }>;
  };
}

export function serializeHarnessContext(context: AgentContext): HarnessWorkspaceContext {
  const workspace = context.workspace;
  const cards = (workspace?.cards ?? [])
    .filter((card) => card.status !== "deleted")
    .map(({ id, title, status, timeConstraint, priority }) => ({
      id,
      title,
      status,
      timeConstraint,
      priority,
    }));
  const visibleCardIds = new Set(cards.map((card) => card.id));
  const placements = (workspace?.placements ?? [])
    .filter((placement) => visibleCardIds.has(placement.cardId))
    .map(({ cardId, pageKey }) => ({ cardId, pageKey }));

  return {
    now: context.now.toISOString(),
    currentPage: context.currentPage,
    selectedCardId: context.selectedCardId,
    view: context.view,
    overviewStatus: context.overviewStatus,
    workspace: { cards, placements },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function textBlocks(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((block) => {
    if (!isRecord(block)) return [];
    if (block.type === "text" && typeof block.text === "string") return [block.text];
    return [];
  });
}

function toolResultText(event: unknown): string[] {
  if (!isRecord(event) || event.type !== "tool/result" || !isRecord(event.data)) return [];
  const message = event.data.message;
  if (!isRecord(message)) return [];
  const content = message.content;
  if (!Array.isArray(content)) return [];
  return content.flatMap((block) => {
    if (!isRecord(block) || block.type !== "tool-result") return [];
    return textBlocks(block.content);
  });
}

function parseJsonCandidate(value: string): unknown | null {
  const candidates = [value.trim()];
  const fenced = value.match(/```(?:json)?\s*([\s\S]*?)\s*```/iu)?.[1];
  if (fenced) candidates.push(fenced.trim());
  for (const candidate of candidates) {
    if (!candidate) continue;
    try {
      const parsed: unknown = JSON.parse(candidate);
      if (isRecord(parsed) && isRecord(parsed.intent)) return parsed.intent;
      if (isRecord(parsed) && typeof parsed.type === "string") return parsed;
    } catch {
      // The assistant's natural-language receipt is not an action. Keep
      // looking for the canonical JSON returned by citroam_apply.
    }
  }
  return null;
}

/**
 * Extract only the canonical value returned by the Harness workspace tool.
 * Ordinary assistant prose is deliberately ignored: a model acknowledgement
 * can never mutate the local workspace by itself.
 */
export function extractHarnessIntent(run: HarnessRun): unknown | null {
  for (let index = run.events.length - 1; index >= 0; index -= 1) {
    for (const text of toolResultText(run.events[index])) {
      const parsed = parseJsonCandidate(text);
      if (parsed) return parsed;
    }
  }
  return null;
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Send one user request through a real, Tauri-managed DeepSeek Harness run. */
export async function harnessAgentPrompt(request: string, context: AgentContext): Promise<AgentIntent> {
  if (!isTauriRuntime()) {
    throw new Error("DeepSeek Harness requires the Tauri runtime; no model call was made.");
  }
  const run = await invoke<HarnessRun>("agent_prompt", {
    requestText: request,
    context: serializeHarnessContext(context),
  });
  const intent = extractHarnessIntent(run);
  if (!intent) {
    throw new Error("DeepSeek Harness returned no canonical Citroam action.");
  }
  return intent as AgentIntent;
}

/** The production model. Local rule parsing remains available only as a test fixture. */
export const harnessAgentModel: AgentModel = {
  interpret: harnessAgentPrompt,
};
