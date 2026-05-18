import { randomUUID } from "node:crypto";
import { chooseActiveTurn } from "../bridge/continue";
import type { BridgeConfig } from "../bridge/config";
import { isAgentMessageItem, shouldEmitAgentMessagePhase, type MessagePhase } from "../bridge/filters";
import { messagesToResponseItems, normalizeChatRequest, userInput, type OpenAiChatRequest } from "../bridge/normalize";
import { preparePrompt } from "../bridge/prompt";
import { BridgeHttpError } from "../openai/errors";
import type { ChatCompletionResult } from "../openai/types";
import { CodexRpc, type RpcNotification } from "./rpc";

type CodexAccount =
  | { type: "apiKey" }
  | { type: "chatgpt"; email: string; planType: string }
  | { type: "amazonBedrock" };

type AccountSummary =
  | { type: "apiKey" }
  | { type: "chatgpt"; planType: string }
  | { type: "amazonBedrock" };

type CodexModel = {
  id: string;
  model: string;
  displayName?: string;
  hidden?: boolean;
  supportedReasoningEfforts?: Array<{ reasoningEffort: string; description?: string }>;
  defaultReasoningEffort?: string;
  inputModalities?: string[];
  isDefault?: boolean;
};

type ConfigRequirements = {
  allowedApprovalPolicies: unknown[] | null;
  allowedSandboxModes: string[] | null;
};

type TurnCompletion = {
  status: string;
  error?: { message?: string; additionalDetails?: string | null } | null;
};

export type BridgeStatus = {
  codexProcessAlive: boolean;
  initialized: boolean;
  startupError: string | null;
  account: AccountSummary | null;
  requiresOpenaiAuth: boolean | null;
  defaultModel: string | null;
  modelCount: number;
  safetyMode: "declawed_roleplay_v1";
  pendingLoginId: string | null;
};

export type GenerateOptions = {
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
  onReasoningDelta?: (delta: string) => void;
};

export class CodexBridge {
  private readonly rpc: CodexRpc;
  private initialized = false;
  private initializing: Promise<void> | null = null;
  private startupError: string | null = null;
  private account: CodexAccount | null = null;
  private requiresOpenaiAuth: boolean | null = null;
  private models: CodexModel[] = [];
  private requirements: ConfigRequirements | null = null;
  private pendingLoginId: string | null = null;

  constructor(private readonly config: BridgeConfig) {
    this.rpc = new CodexRpc({
      command: config.codexCommand,
      args: config.codexArgs,
      requestTimeoutMs: config.requestTimeoutMs,
    });

    this.rpc.on("stderr", (line) => console.error(`[codex app-server] ${String(line)}`));
    this.rpc.on("exit", () => {
      this.initialized = false;
      this.startupError = "codex app-server exited";
    });
    this.rpc.on("notification:account/login/completed", (params) => this.handleLoginCompleted(params));
    this.rpc.on("notification:account/rateLimits/updated", (params) => this.rpc.emit("rateLimits", params));
  }

  async start(): Promise<void> {
    await this.ensureReady();
  }

  stop(): void {
    this.rpc.stop();
  }

  status(): BridgeStatus {
    return {
      codexProcessAlive: this.rpc.isAlive,
      initialized: this.initialized,
      startupError: this.startupError,
      account: accountSummary(this.account),
      requiresOpenaiAuth: this.requiresOpenaiAuth,
      defaultModel: this.defaultModel()?.id ?? this.config.defaultModel,
      modelCount: this.models.length,
      safetyMode: "declawed_roleplay_v1",
      pendingLoginId: this.pendingLoginId,
    };
  }

  async openAiModels(): Promise<unknown> {
    await this.ensureReady();

    return {
      object: "list",
      data: this.models.map((model) => openAiModelEntry(model)),
    };
  }

  async loginStart(): Promise<unknown> {
    await this.ensureReady();
    const response = await this.rpc.request<{ type: string; loginId?: string }>("account/login/start", { type: "chatgptDeviceCode" });
    this.pendingLoginId = typeof response.loginId === "string" ? response.loginId : null;
    return response;
  }

  async loginCancel(loginId?: string): Promise<unknown> {
    await this.ensureReady();
    const id = loginId ?? this.pendingLoginId;
    if (!id) {
      throw new BridgeHttpError(400, "invalid_request", "No loginId was supplied and no bridge login is pending.");
    }

    const response = await this.rpc.request("account/login/cancel", { loginId: id });
    if (this.pendingLoginId === id) this.pendingLoginId = null;
    return response;
  }

  async logout(): Promise<unknown> {
    await this.ensureReady();
    const response = await this.rpc.request("account/logout", {});
    await this.refreshAccount();
    return response;
  }

  async rateLimits(): Promise<unknown> {
    await this.ensureReady();
    return this.rpc.request("account/rateLimits/read", {});
  }

  async generate(body: unknown, options: GenerateOptions = {}): Promise<ChatCompletionResult> {
    await this.ensureReady();
    this.validateSafetyRequirements();

    const { request, messages } = normalizeChatRequest(body);
    this.logUnsupportedFields(request);

    const preparedPrompt = preparePrompt(messages);
    const activeTurn = chooseActiveTurn(preparedPrompt.conversationMessages, this.config.continueNudge, this.config.firstReplyNudge);
    const model = this.selectModel(request.model);
    const effort = this.selectEffort(model, request);
    const summary = this.selectReasoningSummary(request);
    const serviceTier = selectServiceTier(request);
    const includeReasoning = summary !== null && summary !== "none";
    const outputSchema = this.selectOutputSchema(request);
    const completionId = `chatcmpl-${randomUUID()}`;
    const created = Math.floor(Date.now() / 1000);

    const thread = await this.rpc.request<{ thread: { id: string } }>("thread/start", {
      model: model.id,
      approvalPolicy: "never",
      sandbox: "read-only",
      serviceName: this.config.serviceName,
      serviceTier,
      baseInstructions: preparedPrompt.baseInstructions,
      developerInstructions: preparedPrompt.developerInstructions,
      personality: null,
      ephemeral: true,
      experimentalRawEvents: false,
      persistExtendedHistory: false,
    });

    const threadId = thread.thread.id;
    const injectedItems = messagesToResponseItems(activeTurn.history);
    if (injectedItems.length > 0) {
      await this.rpc.request("thread/inject_items", { threadId, items: injectedItems });
    }

    let turnId: string | null = null;
    const itemPhases = new Map<string, MessagePhase | null>();
    const itemText = new Map<string, string>();
    const itemHadDelta = new Set<string>();
    const pendingDeltas = new Map<string, string[]>();
    const chunks: string[] = [];
    const reasoningChunks: string[] = [];
    let hadReasoningDelta = false;
    let completed = false;
    let finishReason = "stop";
    let turnFailure: string | null = null;

    const emitDelta = (itemId: string, delta: string): void => {
      const phase = itemPhases.get(itemId);
      if (phase === undefined) {
        const pending = pendingDeltas.get(itemId) ?? [];
        pending.push(delta);
        pendingDeltas.set(itemId, pending);
        return;
      }

      if (!shouldEmitAgentMessagePhase(phase)) return;

      itemHadDelta.add(itemId);
      chunks.push(delta);
      options.onDelta?.(delta);
    };

    const flushPendingDeltas = (itemId: string): void => {
      const pending = pendingDeltas.get(itemId);
      if (!pending) return;
      pendingDeltas.delete(itemId);

      for (const delta of pending) emitDelta(itemId, delta);
    };

    const notificationHandler = (notification: RpcNotification): void => {
      const params = notification.params;
      if (!isRecord(params) || params.threadId !== threadId) return;

      if (typeof params.turnId === "string" && turnId != null && params.turnId !== turnId) return;

      if (notification.method === "turn/started" && isRecord(params.turn)) {
        turnId = typeof params.turn.id === "string" ? params.turn.id : turnId;
        return;
      }

      if (notification.method === "item/started" && isAgentMessageItem(params.item)) {
        itemPhases.set(params.item.id, params.item.phase);
        itemText.set(params.item.id, params.item.text ?? "");
        flushPendingDeltas(params.item.id);
        return;
      }

      if (notification.method === "item/agentMessage/delta") {
        const itemId = typeof params.itemId === "string" ? params.itemId : null;
        const delta = typeof params.delta === "string" ? params.delta : null;
        if (itemId && delta) emitDelta(itemId, delta);
        return;
      }

      if (includeReasoning && notification.method === "item/reasoning/summaryTextDelta") {
        const delta = typeof params.delta === "string" ? params.delta : null;
        if (delta) {
          hadReasoningDelta = true;
          reasoningChunks.push(delta);
          options.onReasoningDelta?.(delta);
        }
        return;
      }

      if (includeReasoning && notification.method === "item/reasoning/summaryPartAdded") {
        if (reasoningChunks.length > 0 && !reasoningChunks.at(-1)?.endsWith("\n")) {
          reasoningChunks.push("\n\n");
          options.onReasoningDelta?.("\n\n");
        }
        return;
      }

      if (includeReasoning && notification.method === "item/reasoning/textDelta") {
        const delta = typeof params.delta === "string" ? params.delta : null;
        if (delta) {
          hadReasoningDelta = true;
          reasoningChunks.push(delta);
          options.onReasoningDelta?.(delta);
        }
        return;
      }

      if (notification.method === "item/completed" && isAgentMessageItem(params.item)) {
        itemPhases.set(params.item.id, params.item.phase);
        itemText.set(params.item.id, params.item.text ?? "");
        flushPendingDeltas(params.item.id);

        if (!itemHadDelta.has(params.item.id) && shouldEmitAgentMessagePhase(params.item.phase) && params.item.text) {
          emitDelta(params.item.id, params.item.text);
        }
        return;
      }

      if (includeReasoning && notification.method === "item/completed" && isRecord(params.item) && params.item.type === "reasoning") {
        const summary = reasoningItemText(params.item.summary) || reasoningItemText(params.item.content);
        if (!hadReasoningDelta && summary) {
          hadReasoningDelta = true;
          reasoningChunks.push(summary);
          options.onReasoningDelta?.(summary);
        }
        return;
      }

      if (notification.method === "turn/completed" && isRecord(params.turn)) {
        const turn = params.turn as TurnCompletion;
        completed = true;
        finishReason = turn.status === "interrupted" ? "stop" : turn.status === "failed" ? "error" : "stop";
        if (turn.status === "failed") {
          turnFailure = turn.error?.message ?? turn.error?.additionalDetails ?? "Codex turn failed.";
        }
      }
    };

    this.rpc.on("notification", notificationHandler);

    let timeout: NodeJS.Timeout | null = null;
    const abortHandler = (): void => {
      if (turnId) void this.rpc.request("turn/interrupt", { threadId, turnId }).catch(() => undefined);
    };

    try {
      options.signal?.addEventListener("abort", abortHandler, { once: true });
      if (options.signal?.aborted) {
        throw new BridgeHttpError(499, "client_closed_request", "Client disconnected before generation started.");
      }

      const turn = await this.rpc.request<{ turn: { id: string } }>("turn/start", {
        threadId,
        input: userInput(activeTurn.input),
        approvalPolicy: "never",
        sandboxPolicy: {
          type: "readOnly",
          access: { type: "fullAccess" },
          networkAccess: false,
        },
        model: model.id,
        serviceTier,
        effort,
        summary,
        outputSchema,
      });
      turnId = turn.turn.id;
      if (options.signal?.aborted) {
        abortHandler();
        throw new BridgeHttpError(499, "client_closed_request", "Client disconnected before generation completed.");
      }

      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const interval = setInterval(() => {
          if (options.signal?.aborted) {
            settle(() => reject(new BridgeHttpError(499, "client_closed_request", "Client disconnected before generation completed.")));
            return;
          }

          if (completed) {
            settle(resolve);
            return;
          }
        }, 25);

        timeout = setTimeout(() => {
          settle(() => reject(new BridgeHttpError(504, "generation_timeout", "Timed out waiting for Codex turn completion.")));
        }, this.config.generationTimeoutMs);

        const settle = (finish: () => void): void => {
          if (settled) return;
          settled = true;
          clearInterval(interval);
          if (timeout) clearTimeout(timeout);
          finish();
        };
      });
    } finally {
      if (timeout) clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortHandler);
      this.rpc.off("notification", notificationHandler);
      void this.rpc.request("thread/unsubscribe", { threadId }).catch(() => undefined);
    }

    if (turnFailure) {
      throw new BridgeHttpError(500, "codex_turn_failed", turnFailure);
    }

    return {
      id: completionId,
      model: model.id,
      created,
      content: chunks.join("") || fallbackTextFromCompletedItems(itemText, itemPhases),
      reasoning: reasoningChunks.join("") || undefined,
      finishReason,
    };
  }

  private async ensureReady(): Promise<void> {
    if (this.initialized && this.rpc.isAlive) return;
    if (this.initializing) return this.initializing;

    this.initializing = this.initialize().finally(() => {
      this.initializing = null;
    });

    return this.initializing;
  }

  private async initialize(): Promise<void> {
    try {
      await this.rpc.start();
      await this.rpc.request("initialize", {
        clientInfo: {
          name: "codex_sillytavern_bridge",
          title: "Codex SillyTavern Bridge",
          version: "0.1.0",
        },
      });
      this.rpc.notify("initialized", {});
      this.initialized = true;
      this.startupError = null;
      await this.refreshStartupState();
    } catch (error) {
      this.initialized = false;
      this.startupError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  private async refreshStartupState(): Promise<void> {
    const results = await Promise.allSettled([
      this.refreshAccount(),
      this.refreshModels(),
      this.refreshRequirements(),
    ]);

    const failures = results
      .filter((result): result is PromiseRejectedResult => result.status === "rejected")
      .map((result) => result.reason instanceof Error ? result.reason.message : String(result.reason));

    try {
      this.validateSafetyRequirements();
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }

    this.startupError = failures.length > 0 ? failures.join("; ") : null;
  }

  private async refreshAccount(): Promise<void> {
    const response = await this.rpc.request<{ account: CodexAccount | null; requiresOpenaiAuth: boolean }>("account/read", { refreshToken: false });
    this.account = response.account;
    this.requiresOpenaiAuth = response.requiresOpenaiAuth;
  }

  private async refreshModels(): Promise<void> {
    const models: CodexModel[] = [];
    let cursor: string | null = null;

    do {
      const response: { data: CodexModel[]; nextCursor: string | null } = await this.rpc.request("model/list", {
        cursor,
        limit: 100,
        includeHidden: false,
      });
      models.push(...response.data);
      cursor = response.nextCursor;
    } while (cursor);

    this.models = models;
  }

  private async refreshRequirements(): Promise<void> {
    const response = await this.rpc.request<{ requirements: ConfigRequirements | null }>("configRequirements/read", {});
    this.requirements = response.requirements;
  }

  private validateSafetyRequirements(): void {
    const requirements = this.requirements;
    if (!requirements) return;

    if (requirements.allowedApprovalPolicies && !requirements.allowedApprovalPolicies.some((policy) => policy === "never")) {
      throw new BridgeHttpError(503, "unsafe_codex_policy", "Codex config requirements do not allow approvalPolicy: never.");
    }

    if (requirements.allowedSandboxModes && !requirements.allowedSandboxModes.includes("read-only")) {
      throw new BridgeHttpError(503, "unsafe_codex_policy", "Codex config requirements do not allow sandbox mode read-only.");
    }
  }

  private selectModel(requestedModel: string | undefined): CodexModel {
    const configuredDefault = this.config.defaultModel ? this.models.find((model) => model.id === this.config.defaultModel || model.model === this.config.defaultModel) : null;
    const requested = requestedModel ? this.models.find((model) => model.id === requestedModel || model.model === requestedModel) : null;
    const preferred = requested ?? configuredDefault ?? this.defaultModel();

    if (preferred) return preferred;

    const fallback = requestedModel ?? this.config.defaultModel ?? "gpt-5.4";
    return {
      id: fallback,
      model: fallback,
      supportedReasoningEfforts: [{ reasoningEffort: this.config.defaultReasoningEffort }],
      defaultReasoningEffort: this.config.defaultReasoningEffort,
    };
  }

  private defaultModel(): CodexModel | null {
    return this.models.find((model) => model.isDefault) ?? this.models[0] ?? null;
  }

  private selectEffort(model: CodexModel, request: OpenAiChatRequest): string | null {
    const requested = requestedReasoningEffort(request);
    const supported = new Set((model.supportedReasoningEfforts ?? []).map((effort) => effort.reasoningEffort));

    if (requested && (supported.size === 0 || supported.has(requested))) return requested;
    if (supported.has(this.config.defaultReasoningEffort)) return this.config.defaultReasoningEffort;
    if (model.defaultReasoningEffort) return model.defaultReasoningEffort;
    return null;
  }

  private selectReasoningSummary(request: OpenAiChatRequest): string | null {
    const requested = reasoningObjectString(request.reasoning, "summary");
    if (isReasoningSummary(requested)) return requested;
    if (request.include_reasoning === true) return "concise";
    if (request.include_reasoning === false) return "none";

    const effort = requestedReasoningEffort(request);
    if (effort && effort !== "none") return "concise";

    return null;
  }

  private selectOutputSchema(request: OpenAiChatRequest): unknown | null {
    if (!isRecord(request.response_format)) return null;
    if (request.response_format.type !== "json_schema") return null;

    const jsonSchema = request.response_format.json_schema;
    if (!isRecord(jsonSchema)) return null;
    return isRecord(jsonSchema.schema) ? jsonSchema.schema : null;
  }

  private handleLoginCompleted(params: unknown): void {
    if (isRecord(params) && typeof params.loginId === "string" && params.loginId === this.pendingLoginId) {
      this.pendingLoginId = null;
    }

    void this.refreshAccount().catch((error) => {
      console.error("Failed to refresh Codex account after login completion:", error);
    });
  }

  private logUnsupportedFields(request: OpenAiChatRequest): void {
    if (!this.config.logUnsupportedFields) return;

    const supported = new Set([
      "model",
      "messages",
      "stream",
      "tools",
      "functions",
      "tool_choice",
      "function_call",
      "reasoning_effort",
      "effort",
      "include_reasoning",
      "reasoning",
      "service_tier",
      "serviceTier",
      "response_format",
      "verbosity",
      "max_tokens",
      "max_completion_tokens",
      "temperature",
      "top_p",
      "top_k",
      "presence_penalty",
      "frequency_penalty",
      "stop",
      "seed",
      "n",
      "logit_bias",
    ]);

    for (const field of Object.keys(request)) {
      if (!supported.has(field)) console.warn(`Ignoring unsupported OpenAI chat field: ${field}`);
    }
  }
}

function fallbackTextFromCompletedItems(itemText: Map<string, string>, itemPhases: Map<string, MessagePhase | null>): string {
  const chunks: string[] = [];
  for (const [itemId, text] of itemText.entries()) {
    if (text && shouldEmitAgentMessagePhase(itemPhases.get(itemId))) chunks.push(text);
  }

  return chunks.join("");
}

function accountSummary(account: CodexAccount | null): AccountSummary | null {
  if (!account) return null;
  if (account.type === "chatgpt") return { type: account.type, planType: account.planType };
  return { type: account.type };
}

function openAiModelEntry(model: CodexModel): unknown {
  return {
    id: model.id,
    object: "model",
    owned_by: "openai",
    input_modalities: model.inputModalities ?? ["text"],
    supported_features: model.supportedReasoningEfforts?.length ? ["reasoning_effort"] : [],
    metadata: {
      reasoning: false,
      reasoning_effort: Boolean(model.supportedReasoningEfforts?.length),
      supported_reasoning_efforts: model.supportedReasoningEfforts?.map((effort) => effort.reasoningEffort) ?? [],
      visible_reasoning: false,
      vision: (model.inputModalities ?? []).includes("image"),
      function_call: false,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function reasoningItemText(value: unknown): string {
  if (!Array.isArray(value)) return "";

  return value
    .map((part) => {
      if (typeof part === "string") return part;
      if (isRecord(part) && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function reasoningObjectString(reasoning: unknown, key: string): string | null {
  if (!isRecord(reasoning)) return null;
  const value = reasoning[key];
  return typeof value === "string" ? value : null;
}

function requestedReasoningEffort(request: OpenAiChatRequest): string | null {
  return normalizeReasoningEffort(
    typeof request.reasoning_effort === "string"
      ? request.reasoning_effort
      : typeof request.effort === "string"
        ? request.effort
        : reasoningObjectString(request.reasoning, "effort"),
  );
}

function selectServiceTier(request: OpenAiChatRequest): string | null {
  const requested = typeof request.serviceTier === "string"
    ? request.serviceTier
    : typeof request.service_tier === "string"
      ? request.service_tier
      : null;

  const normalized = requested?.trim();
  if (!normalized) return null;
  if (normalized === "fast") return "priority";
  return normalized;
}

function normalizeReasoningEffort(effort: string | null): string | null {
  if (effort === "min") return "minimal";
  if (effort === "max") return "high";
  return effort;
}

function isReasoningSummary(value: string | null): value is string {
  return value === "auto" || value === "concise" || value === "detailed" || value === "none";
}
