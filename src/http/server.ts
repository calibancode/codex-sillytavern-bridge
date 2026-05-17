import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { URL } from "node:url";
import type { BridgeConfig } from "../bridge/config";
import type { CodexBridge } from "../codex/client";
import { BridgeHttpError, openAiErrorBody, toHttpError } from "../openai/errors";
import { doneChunk, reasoningChunk, roleChunk, streamChunk, writeSseData, writeSseHeaders } from "../openai/sse";
import { chatCompletionResponse } from "../openai/types";

export function createBridgeHttpServer(bridge: CodexBridge, config: BridgeConfig) {
  return createServer(async (req, res) => {
    setCommonHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);

    try {
      if (req.method === "GET" && url.pathname === "/healthz") {
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/bridge/status") {
        sendJson(res, 200, bridge.status());
        return;
      }

      if (req.method === "GET" && url.pathname === "/bridge/rate-limits") {
        sendJson(res, 200, await bridge.rateLimits());
        return;
      }

      if (req.method === "POST" && url.pathname === "/bridge/login/start") {
        sendJson(res, 200, await bridge.loginStart());
        return;
      }

      if (req.method === "POST" && url.pathname === "/bridge/login/cancel") {
        const body = await readJson(req, config.maxBodyBytes, true);
        const loginId = isRecord(body) && typeof body.loginId === "string" ? body.loginId : undefined;
        sendJson(res, 200, await bridge.loginCancel(loginId));
        return;
      }

      if (req.method === "POST" && url.pathname === "/bridge/logout") {
        sendJson(res, 200, await bridge.logout());
        return;
      }

      if (req.method === "GET" && isModelsPath(url.pathname)) {
        sendJson(res, 200, await bridge.openAiModels());
        return;
      }

      if (req.method === "POST" && isChatCompletionsPath(url.pathname)) {
        const body = await readJson(req, config.maxBodyBytes, false);
        if (isRecord(body) && body.stream === true) {
          await streamChatCompletion(req, res, bridge, body);
          return;
        }

        const result = await bridge.generate(body);
        sendJson(res, 200, chatCompletionResponse(result));
        return;
      }

      sendJson(res, 404, openAiErrorBody(new BridgeHttpError(404, "not_found", `Unknown route: ${url.pathname}`)));
    } catch (error) {
      if (res.headersSent) {
        const httpError = toHttpError(error);
        writeSseData(res, { error: openAiErrorBody(httpError).error });
        writeSseData(res, "[DONE]");
        res.end();
        return;
      }

      const httpError = toHttpError(error);
      sendJson(res, httpError.status, openAiErrorBody(httpError));
    }
  });
}

async function streamChatCompletion(req: IncomingMessage, res: ServerResponse, bridge: CodexBridge, body: unknown): Promise<void> {
  const abortController = new AbortController();
  req.on("aborted", () => abortController.abort());
  res.on("close", () => {
    if (!res.writableEnded) abortController.abort();
  });

  writeSseHeaders(res);

  const id = `chatcmpl-stream-${Date.now().toString(36)}`;
  const created = Math.floor(Date.now() / 1000);
  const requestedModel = isRecord(body) && typeof body.model === "string" ? body.model : "codex";
  writeSseData(res, roleChunk(id, requestedModel, created));

  try {
    const result = await bridge.generate(body, {
      signal: abortController.signal,
      onDelta: (delta) => writeSseData(res, streamChunk(id, requestedModel, delta, created)),
      onReasoningDelta: (delta) => writeSseData(res, reasoningChunk(id, requestedModel, delta, created)),
    });

    writeSseData(res, doneChunk(id, result.model, created, result.finishReason));
    writeSseData(res, "[DONE]");
  } catch (error) {
    const httpError = toHttpError(error);
    writeSseData(res, { error: openAiErrorBody(httpError).error });
    writeSseData(res, "[DONE]");
  } finally {
    res.end();
  }
}

async function readJson(req: IncomingMessage, maxBytes: number, allowEmpty: boolean): Promise<unknown> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.byteLength;
    if (total > maxBytes) {
      throw new BridgeHttpError(413, "request_too_large", `Request body exceeded ${maxBytes} bytes.`);
    }
    chunks.push(buffer);
  }

  if (chunks.length === 0) return allowEmpty ? {} : null;

  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return allowEmpty ? {} : null;
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new BridgeHttpError(400, "invalid_json", "Request body must be valid JSON.", error);
  }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function setCommonHeaders(res: ServerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function isModelsPath(pathname: string): boolean {
  return pathname === "/v1/models" || pathname === "/models";
}

export function isChatCompletionsPath(pathname: string): boolean {
  return pathname === "/v1/chat/completions" || pathname === "/chat/completions";
}
