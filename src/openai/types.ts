export type ChatCompletionResult = {
  id: string;
  model: string;
  created: number;
  content: string;
  reasoning?: string;
  finishReason: string;
};

export function chatCompletionResponse(result: ChatCompletionResult): unknown {
  const completionTokens = roughTokenCount(result.content);

  return {
    id: result.id,
    object: "chat.completion",
    created: result.created,
    model: result.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: result.content,
          ...(result.reasoning ? { reasoning: result.reasoning, reasoning_content: result.reasoning } : {}),
        },
        finish_reason: result.finishReason,
      },
    ],
    usage: {
      prompt_tokens: 0,
      completion_tokens: completionTokens,
      total_tokens: completionTokens,
    },
  };
}

function roughTokenCount(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}
