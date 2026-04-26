export type MessagePhase = "commentary" | "final_answer";

export type AgentMessageItem = {
  type: "agentMessage";
  id: string;
  text: string;
  phase: MessagePhase | null;
};

export function shouldEmitAgentMessagePhase(phase: MessagePhase | null | undefined): boolean {
  return phase === null || phase === "final_answer";
}

export function isAgentMessageItem(item: unknown): item is AgentMessageItem {
  if (typeof item !== "object" || item === null) return false;
  const record = item as Record<string, unknown>;
  return record.type === "agentMessage" && typeof record.id === "string";
}
