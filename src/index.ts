#!/usr/bin/env node
import { loadConfig } from "./bridge/config";
import { CodexBridge } from "./codex/client";
import { createBridgeHttpServer } from "./http/server";

const config = loadConfig();
const bridge = new CodexBridge(config);

void bridge.start().catch((error) => {
  console.error("Initial Codex app-server startup failed:", error);
  console.error("The HTTP bridge will keep running; inspect /bridge/status and retry after fixing Codex/auth/config.");
});

const server = createBridgeHttpServer(bridge, config);

server.listen(config.port, config.host, () => {
  console.log(`codex-sillytavern-bridge listening at http://${config.host}:${config.port}`);
});

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

function shutdown(signal: string): void {
  console.log(`Received ${signal}, shutting down.`);
  bridge.stop();
  server.close(() => process.exit(0));
}
