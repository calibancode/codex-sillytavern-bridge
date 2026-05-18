# Codex SillyTavern Bridge

Local OpenAI-compatible HTTP bridge from SillyTavern to `codex app-server`.

## Requirements

- Node.js 18+
- A working `codex` CLI
- Codex already authenticated locally

## Run

```bash
npm install
npm run build
npm start
```

Default base URL:

```text
http://127.0.0.1:8787
```

## SillyTavern Setup

Use Chat Completion with a Custom OpenAI-compatible endpoint.

Either base URL works:

```text
http://127.0.0.1:8787
http://127.0.0.1:8787/v1
```

Use prompt post-processing `none` for the first test.

## Additional Parameters

SillyTavern Custom endpoint "Additional Parameters" accepts YAML. The bridge reads:

```yaml
service_tier: priority
include_reasoning: true
reasoning_summary: detailed
reasoning_effort: medium
effort: xhigh
```

- `service_tier` is passed to Codex as `serviceTier`.
- `service_tier: fast` is accepted as an alias for `priority`.
- `include_reasoning` requests reasoning chunks for SillyTavern to display.
- `reasoning_summary` can be `auto`, `concise`, `detailed`, or `none`.
- `reasoning_effort` can also come from SillyTavern's built-in Reasoning Effort control when SillyTavern forwards it for the selected model.
- `effort` overrides `reasoning_effort`; use it for `xhigh`.

For SillyTavern to show streamed reasoning, its Request model reasoning toggle must be on too.

Reasoning summaries are wired through, but as of May 18, 2026, Codex did not return visible summary text in local testing. The bridge requested `summary: detailed` with `effort: xhigh`; Codex emitted an empty reasoning item.

## Behavior

- Starts a fresh ephemeral Codex thread per request.
- Sends turns with `approvalPolicy: "never"` and read-only sandboxing.
- Preserves SillyTavern `name` fields as speaker prefixes.
- Converts named example dialogue into transcript turns.
- Forwards user image parts to Codex.
- Rejects OpenAI tools/functions.

## Useful Endpoints

- `GET /models`
- `GET /v1/models`
- `POST /chat/completions`
- `POST /v1/chat/completions`
- `GET /bridge/status`
- `POST /bridge/login/start`
- `GET /bridge/rate-limits`
- `GET /bridge/debug/last-generation`

The debug endpoint reports parameter selection and event counts only. It does not include prompt, reply, or reasoning text.

## Configuration

- `BRIDGE_HOST`, default `127.0.0.1`
- `BRIDGE_PORT`, default `8787`
- `CODEX_COMMAND`, default `codex`
- `CODEX_APP_SERVER_ARGS`, default `app-server`
- `BRIDGE_DEFAULT_MODEL`, optional model id override
- `BRIDGE_REASONING_EFFORT`, default `low`
- `BRIDGE_FORCE_REASONING_EFFORT`, optional override; use `xhigh` to force maximum
- `BRIDGE_REASONING_SUMMARY`, optional default: `auto`, `concise`, `detailed`, or `none`
- `BRIDGE_DEBUG_REASONING`, default `false`; logs sanitized reasoning event counts
- `BRIDGE_GENERATION_TIMEOUT_MS`, default `600000`

Host and port can also be set with CLI args:

```bash
npm start -- --host 127.0.0.1 --port 8787
```

## Limits

- No persistent SillyTavern chat-to-Codex thread mapping.
- No OpenAI tool/function support.
- No built-in HTTP authentication.

## More Notes

- [SillyTavern compatibility notes](docs/sillytavern-compatibility-notes.md)
- [Maintainer notes](docs/sillytavern-maintainer-notes.md)

## License

MIT
