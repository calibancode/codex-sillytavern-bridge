export const DEFAULT_CONTINUE_NUDGE =
  "continue the next assistant reply naturally from the existing transcript. do not restart, summarize, break character, or speak for the user.";

export const DEFAULT_FIRST_REPLY_NUDGE =
  "write the next assistant reply now, following the supplied SillyTavern prompt. return only the assistant reply text.";

export type BridgeConfig = {
  host: string;
  port: number;
  codexCommand: string;
  codexArgs: string[];
  defaultModel: string | null;
  defaultReasoningEffort: string;
  forcedReasoningEffort: string | null;
  continueNudge: string;
  firstReplyNudge: string;
  requestTimeoutMs: number;
  generationTimeoutMs: number;
  maxBodyBytes: number;
  logUnsupportedFields: boolean;
  serviceName: string;
  defaultReasoningSummary: string | null;
  debugReasoning: boolean;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env, argv: string[] = process.argv.slice(2)): BridgeConfig {
  const args = parseArgs(argv);

  return {
    host: args.host ?? env.BRIDGE_HOST ?? "127.0.0.1",
    port: args.port ?? numberFromEnv(env.BRIDGE_PORT, 8787),
    codexCommand: env.CODEX_COMMAND ?? "codex",
    codexArgs: splitArgs(env.CODEX_APP_SERVER_ARGS) ?? ["app-server"],
    defaultModel: env.BRIDGE_DEFAULT_MODEL ?? null,
    defaultReasoningEffort: reasoningEffortFromEnv(env.BRIDGE_REASONING_EFFORT) ?? "low",
    forcedReasoningEffort: reasoningEffortFromEnv(env.BRIDGE_FORCE_REASONING_EFFORT),
    continueNudge: env.BRIDGE_CONTINUE_NUDGE ?? DEFAULT_CONTINUE_NUDGE,
    firstReplyNudge: env.BRIDGE_FIRST_REPLY_NUDGE ?? DEFAULT_FIRST_REPLY_NUDGE,
    requestTimeoutMs: numberFromEnv(env.BRIDGE_REQUEST_TIMEOUT_MS, 30_000),
    generationTimeoutMs: numberFromEnv(env.BRIDGE_GENERATION_TIMEOUT_MS, 600_000),
    maxBodyBytes: numberFromEnv(env.BRIDGE_MAX_BODY_BYTES, 16 * 1024 * 1024),
    logUnsupportedFields: booleanFromEnv(env.BRIDGE_LOG_UNSUPPORTED_FIELDS, false),
    serviceName: env.BRIDGE_SERVICE_NAME ?? "codex_sillytavern_bridge",
    defaultReasoningSummary: reasoningSummaryFromEnv(env.BRIDGE_REASONING_SUMMARY),
    debugReasoning: booleanFromEnv(env.BRIDGE_DEBUG_REASONING, false),
  };
}

function parseArgs(argv: string[]): { host?: string; port?: number } {
  const args: { host?: string; port?: number } = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--localhost") {
      args.host = "127.0.0.1";
      continue;
    }

    if (arg === "--host" && argv[i + 1]) {
      args.host = hostFromArg(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith("--host=")) {
      args.host = hostFromArg(arg.slice("--host=".length));
      continue;
    }

    if (arg === "--port" && argv[i + 1]) {
      args.port = numberFromString(argv[i + 1]);
      i += 1;
      continue;
    }

    if (arg.startsWith("--port=")) {
      args.port = numberFromString(arg.slice("--port=".length));
    }
  }

  return args;
}

function hostFromArg(value: string): string | undefined {
  const host = value.trim();
  return host.length > 0 ? host : undefined;
}

function numberFromString(value: string): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65_535 ? parsed : undefined;
}

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  return numberFromString(value) ?? fallback;
}

function booleanFromEnv(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function reasoningSummaryFromEnv(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  return ["auto", "concise", "detailed", "none"].includes(normalized) ? normalized : null;
}

function reasoningEffortFromEnv(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "min" || normalized === "minimal") return "low";
  if (normalized === "max") return "xhigh";
  return normalized;
}

function splitArgs(value: string | undefined): string[] | null {
  if (!value?.trim()) return null;
  return value.split(" ").map((part) => part.trim()).filter(Boolean);
}
