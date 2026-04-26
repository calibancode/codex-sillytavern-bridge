import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import * as readline from "node:readline";

export type RpcMessage = Record<string, unknown>;
export type RpcNotification = { method: string; params?: unknown };

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timeout: NodeJS.Timeout;
};

export type CodexRpcOptions = {
  command: string;
  args: string[];
  requestTimeoutMs: number;
};

export class CodexRpc extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, PendingRequest>();
  private starting: Promise<void> | null = null;

  constructor(private readonly options: CodexRpcOptions) {
    super();
  }

  get isAlive(): boolean {
    return this.proc != null && this.proc.exitCode == null && !this.proc.killed;
  }

  async start(): Promise<void> {
    if (this.isAlive) return;
    if (this.starting) return this.starting;

    const starting = new Promise<void>((resolve, reject) => {
      const child = spawn(this.options.command, this.options.args, {
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.proc = child;

      child.once("spawn", () => resolve());
      child.once("error", (error) => {
        this.rejectAll(error);
        reject(error);
      });

      child.once("exit", (code, signal) => {
        const reason = new Error(`codex app-server child process exited with code ${String(code)} signal ${String(signal)}`);
        this.proc = null;
        this.rejectAll(reason);
        this.emit("exit", { code, signal });
      });

      readline.createInterface({ input: child.stdout }).on("line", (line: string) => this.handleLine(line));
      readline.createInterface({ input: child.stderr }).on("line", (line: string) => this.emit("stderr", line));
    }).finally(() => {
      this.starting = null;
    });

    this.starting = starting;
    return starting;
  }

  stop(): void {
    if (!this.proc) return;
    this.proc.kill("SIGTERM");
    this.proc = null;
    this.rejectAll(new Error("codex app-server child process stopped"));
  }

  async request<T = unknown>(method: string, params?: unknown, timeoutMs = this.options.requestTimeoutMs): Promise<T> {
    await this.start();

    const id = this.nextId++;
    const payload: RpcMessage = { method, id };
    if (params !== undefined) payload.params = params;

    const promise = new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`codex app-server request timed out: ${method}`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeout,
      });
    });

    try {
      this.send(payload);
    } catch (error) {
      const pending = this.pending.get(id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(id);
        pending.reject(error);
      }
    }

    return promise;
  }

  notify(method: string, params?: unknown): void {
    const payload: RpcMessage = { method };
    if (params !== undefined) payload.params = params;
    this.send(payload);
  }

  private send(payload: RpcMessage): void {
    if (!this.proc?.stdin.writable) {
      throw new Error("codex app-server child process is not writable");
    }

    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  private handleLine(line: string): void {
    let message: RpcMessage;
    try {
      message = JSON.parse(line) as RpcMessage;
    } catch (error) {
      this.emit("protocolError", new Error(`failed to parse app-server JSONL: ${line}`), error);
      return;
    }

    if (typeof message.id === "number") {
      this.handleResponse(message.id, message);
      return;
    }

    if (typeof message.method === "string") {
      const notification: RpcNotification = { method: message.method, params: message.params };
      this.emit("notification", notification);
      this.emit(`notification:${notification.method}`, notification.params);
    }
  }

  private handleResponse(id: number, message: RpcMessage): void {
    const pending = this.pending.get(id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(id);

    if (message.error) {
      pending.reject(new Error(formatRpcError(message.error)));
      return;
    }

    pending.resolve(message.result);
  }

  private rejectAll(reason: unknown): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
    }

    this.pending.clear();
  }
}

function formatRpcError(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>;
    const message = typeof record.message === "string" ? record.message : JSON.stringify(record);
    const code = record.code == null ? "" : ` (${String(record.code)})`;
    return `${message}${code}`;
  }

  return String(error);
}
