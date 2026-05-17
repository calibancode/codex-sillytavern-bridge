import { BridgeHttpError } from "../openai/errors";

export type ChatRole = "system" | "user" | "assistant";

export type NormalizedTextPart = {
  type: "text";
  text: string;
};

export type NormalizedImagePart = {
  type: "image";
  url: string;
  detail?: string;
};

export type NormalizedContentPart = NormalizedTextPart | NormalizedImagePart;

export type OpenAiChatMessage = {
  role?: string;
  content?: unknown;
  name?: string;
  tool_calls?: unknown;
  function_call?: unknown;
};

export type OpenAiChatRequest = {
  model?: string;
  messages?: OpenAiChatMessage[];
  stream?: boolean;
  tools?: unknown;
  functions?: unknown;
  tool_choice?: unknown;
  function_call?: unknown;
  reasoning_effort?: string;
  effort?: string;
  include_reasoning?: boolean;
  reasoning?: unknown;
  response_format?: unknown;
  [key: string]: unknown;
};

export type NormalizedMessage = {
  role: ChatRole;
  content: NormalizedContentPart[];
  name?: string;
};

export function normalizeChatRequest(body: unknown): { request: OpenAiChatRequest; messages: NormalizedMessage[] } {
  if (!isObject(body)) {
    throw new BridgeHttpError(400, "invalid_request", "Request body must be a JSON object.");
  }

  const request = body as OpenAiChatRequest;
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new BridgeHttpError(400, "invalid_request", "messages must be a non-empty array.");
  }

  rejectTooling(request);

  const messages = request.messages.map((message, index) => normalizeMessage(message, index));
  return { request, messages };
}

export function messagesToResponseItems(messages: NormalizedMessage[]): unknown[] {
  return messages.map((message) => ({
    type: "message",
    role: message.role,
    content: message.content.map((part) => contentPartToResponsePart(message.role, part)),
    end_turn: message.role === "assistant" ? true : undefined,
  }));
}

export function userInput(parts: NormalizedContentPart[]): unknown[] {
  return parts.map((part): unknown => {
    if (part.type === "text") {
      return { type: "text", text: part.text, text_elements: [] };
    }

    return { type: "image", url: part.url };
  });
}

export function textPart(text: string): NormalizedTextPart {
  return { type: "text", text };
}

export function messageText(message: NormalizedMessage): string {
  return message.content
    .filter((part): part is NormalizedTextPart => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function normalizeMessage(message: OpenAiChatMessage, index: number): NormalizedMessage {
  if (!isObject(message)) {
    throw new BridgeHttpError(400, "invalid_request", `messages[${index}] must be an object.`);
  }

  if (message.tool_calls || message.function_call) {
    throw new BridgeHttpError(400, "unsupported_request", `messages[${index}] contains tool/function calls, which are disabled for this bridge.`);
  }

  const role = message.role;
  if (role !== "system" && role !== "user" && role !== "assistant") {
    throw new BridgeHttpError(400, "unsupported_request", `messages[${index}].role must be system, user, or assistant.`);
  }

  return {
    role,
    content: normalizeContent(message.content, role, index),
    ...(typeof message.name === "string" && message.name.trim() ? { name: message.name.trim() } : {}),
  };
}

function normalizeContent(content: unknown, role: ChatRole, index: number): NormalizedContentPart[] {
  if (typeof content === "string") return [textPart(content)];
  if (content == null) return [textPart("")];

  if (!Array.isArray(content)) {
    throw new BridgeHttpError(400, "unsupported_request", `messages[${index}].content must be text or OpenAI content parts.`);
  }

  const parts: NormalizedContentPart[] = [];
  for (const [partIndex, part] of content.entries()) {
    if (!isObject(part)) {
      throw new BridgeHttpError(400, "unsupported_request", `messages[${index}].content[${partIndex}] must be an object.`);
    }

    const type = typeof part.type === "string" ? part.type : null;
    if (type === "text" || type === "input_text" || type === "output_text") {
      if (typeof part.text !== "string") {
        throw new BridgeHttpError(400, "unsupported_request", `messages[${index}].content[${partIndex}].text must be a string.`);
      }

      parts.push(textPart(part.text));
      continue;
    }

    if (type === "image_url" || type === "input_image") {
      if (role !== "user") {
        throw new BridgeHttpError(400, "unsupported_request", `messages[${index}] image content is only supported for user messages.`);
      }

      parts.push(normalizeImagePart(part, index, partIndex));
      continue;
    }

    throw new BridgeHttpError(400, "unsupported_request", `messages[${index}].content[${partIndex}] type ${String(type)} is not supported in roleplay mode.`);
  }

  return parts.length > 0 ? parts : [textPart("")];
}

function normalizeImagePart(part: Record<string, unknown>, messageIndex: number, partIndex: number): NormalizedImagePart {
  const imageUrl = part.image_url;
  const directUrl = typeof part.image_url === "string" ? part.image_url : typeof part.imageUrl === "string" ? part.imageUrl : null;
  const nestedUrl = isObject(imageUrl) && typeof imageUrl.url === "string" ? imageUrl.url : null;
  const url = directUrl ?? nestedUrl;

  if (!url) {
    throw new BridgeHttpError(400, "unsupported_request", `messages[${messageIndex}].content[${partIndex}] image URL is missing.`);
  }

  const detail = isObject(imageUrl) && typeof imageUrl.detail === "string"
    ? imageUrl.detail
    : typeof part.detail === "string"
      ? part.detail
      : undefined;

  return { type: "image", url, detail };
}

function contentPartToResponsePart(role: ChatRole, part: NormalizedContentPart): unknown {
  if (part.type === "text") {
    return {
      type: role === "assistant" ? "output_text" : "input_text",
      text: part.text,
    };
  }

  return {
    type: "input_image",
    image_url: part.url,
    detail: part.detail,
  };
}

function rejectTooling(request: OpenAiChatRequest): void {
  if (Array.isArray(request.tools) && request.tools.length > 0) {
    throw new BridgeHttpError(400, "unsupported_request", "OpenAI function tools are not mapped to Codex app-server dynamic tools yet.");
  }

  if (Array.isArray(request.functions) && request.functions.length > 0) {
    throw new BridgeHttpError(400, "unsupported_request", "OpenAI functions are not mapped to Codex app-server dynamic tools yet.");
  }

  if (request.tool_choice != null && request.tool_choice !== "none") {
    throw new BridgeHttpError(400, "unsupported_request", "tool_choice is disabled for this bridge.");
  }

  if (request.function_call != null && request.function_call !== "none") {
    throw new BridgeHttpError(400, "unsupported_request", "function_call is disabled for this bridge.");
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
