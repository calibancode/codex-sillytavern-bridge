# Codex SillyTavern Bridge

Local OpenAI-compatible HTTP bridge from SillyTavern to `codex app-server`.

Run it locally, point SillyTavern at it, and it translates OpenAI-style chat completion requests into Codex app-server turns.

## Requirements

- Node.js 18+
- A working local `codex` CLI installation
- Codex already authenticated locally

## Run

```bash
npm install
npm run build
npm start
```

Default endpoint:

```text
http://127.0.0.1:8787
```

To force localhost binding through npm args:

```bash
npm start -- --localhost
```

In SillyTavern, use Chat Completion with a Custom OpenAI-compatible endpoint and point it at the bridge URL. Use prompt post-processing `none` for the first test.

## Features

- Text and OpenAI-style image content parts are accepted. User image parts are forwarded to Codex as image inputs.
- `reasoning_effort` / `effort` are forwarded when supported by the selected Codex model.
- `/v1/models` includes basic metadata for SillyTavern UI hints: reasoning-effort support, supported reasoning efforts, vision support, and `function_call: false`.
- OpenAI tools/functions are rejected intentionally. Codex app-server dynamic tools use a different JSON-RPC request flow.

## Limits

- No persistent SillyTavern chat-to-Codex thread mapping. Each request starts a fresh ephemeral Codex thread.
- No visible reasoning blocks unless Codex app-server emits reasoning events. Current Codex app-server builds may accept reasoning effort without emitting visible reasoning summaries.
- No OpenAI tool/function support.
- No built-in HTTP authentication.

## Endpoints

- `GET /v1/models`
- `POST /v1/chat/completions`
- `GET /bridge/status`
- `POST /bridge/login/start`
- `POST /bridge/login/cancel`
- `GET /bridge/rate-limits`
- `POST /bridge/logout`

## Configuration

- `BRIDGE_HOST`, default `127.0.0.1`
- `BRIDGE_PORT`, default `8787`
- CLI args override env: `--localhost`, `--host <host>`, `--port <port>`
- `CODEX_COMMAND`, default `codex`
- `CODEX_APP_SERVER_ARGS`, default `app-server`
- `BRIDGE_DEFAULT_MODEL`, optional model id override
- `BRIDGE_REASONING_EFFORT`, default `low`
- `BRIDGE_CONTINUE_NUDGE`, synthetic continue prompt
- `BRIDGE_FIRST_REPLY_NUDGE`, synthetic first assistant reply prompt when ST sends only system messages
- `BRIDGE_REQUEST_TIMEOUT_MS`, default `30000`
- `BRIDGE_GENERATION_TIMEOUT_MS`, default `600000`
- `BRIDGE_MAX_BODY_BYTES`, default `16777216`

CLI args override env for host/port:

```bash
npm start -- --host 127.0.0.1 --port 8787
```

## Runtime Model

The bridge starts fresh Codex threads per request, maps SillyTavern `system` messages into Codex `baseInstructions`, injects non-system message history, and starts turns with `approvalPolicy: "never"` plus read-only sandboxing.

It rejects tool/function request shapes and streams only `agentMessage` final-answer text when Codex phase metadata is available.

The HTTP API has no built-in authentication and uses permissive CORS for local SillyTavern compatibility. Keep the default loopback binding unless you are putting your own trusted network/auth controls in front of it.

## Maintainer Notes

For notes on the OpenAI/Codex policy posture, see [`docs/sillytavern-maintainer-notes.md`](docs/sillytavern-maintainer-notes.md).

## License

MIT
