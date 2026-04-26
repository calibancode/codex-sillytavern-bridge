import type { ServerResponse } from "node:http";

export function writeSseHeaders(res: ServerResponse): void {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
    "Access-Control-Allow-Origin": "*",
  });
}

export function writeSseData(res: ServerResponse, data: unknown): void {
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

export function streamChunk(id: string, model: string, content: string, created: number): unknown {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { content },
        finish_reason: null,
      },
    ],
  };
}

export function reasoningChunk(id: string, model: string, reasoning: string, created: number): unknown {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { reasoning, reasoning_content: reasoning },
        finish_reason: null,
      },
    ],
  };
}

export function roleChunk(id: string, model: string, created: number): unknown {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: { role: "assistant" },
        finish_reason: null,
      },
    ],
  };
}

export function doneChunk(id: string, model: string, created: number, finishReason = "stop"): unknown {
  return {
    id,
    object: "chat.completion.chunk",
    created,
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: finishReason,
      },
    ],
  };
}
