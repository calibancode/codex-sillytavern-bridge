export class BridgeHttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BridgeHttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export type OpenAiErrorBody = {
  error: {
    message: string;
    type: string;
    code: string;
  };
};

export function toHttpError(error: unknown): BridgeHttpError {
  if (error instanceof BridgeHttpError) return error;

  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes("unauthorized") || lower.includes("not authenticated") || lower.includes("requires openai auth")) {
    return new BridgeHttpError(401, "unauthorized", message, error);
  }

  if (lower.includes("usagelimitexceeded") || lower.includes("rate limit") || lower.includes("usage limit")) {
    return new BridgeHttpError(429, "rate_limit_exceeded", message, error);
  }

  if (lower.includes("contextwindowexceeded") || lower.includes("context window")) {
    return new BridgeHttpError(422, "context_window_exceeded", message, error);
  }

  if (lower.includes("not initialized") || lower.includes("app-server") || lower.includes("child process")) {
    return new BridgeHttpError(503, "service_unavailable", message, error);
  }

  return new BridgeHttpError(500, "internal_error", message, error);
}

export function openAiErrorBody(error: BridgeHttpError): OpenAiErrorBody {
  return {
    error: {
      message: error.message,
      type: error.code,
      code: error.code,
    },
  };
}
