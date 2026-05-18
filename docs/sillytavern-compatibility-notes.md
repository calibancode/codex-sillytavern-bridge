# SillyTavern Compatibility Notes

These notes summarize the parts of SillyTavern's current chat-completion path that matter for this bridge.

## Request Shape

SillyTavern's Custom OpenAI-compatible source builds an internal generation object, then its backend forwards a standard OpenAI-style body to the configured base URL plus `/chat/completions`.

Its status/model check also asks the configured base URL plus `/models`. The bridge accepts both root-style OpenAI-compatible paths and `/v1` paths so users can configure either `http://127.0.0.1:8787` or `http://127.0.0.1:8787/v1`.

The forwarded body is mostly:

- `messages`
- `model`
- sampling fields such as `temperature`, `top_p`, penalties, `stop`, `seed`, and `n`
- `stream`
- optional `tools` / `tool_choice` when SillyTavern function calling is enabled
- optional `response_format` for JSON schema requests
- optional `reasoning_effort` and `verbosity` for model ids SillyTavern recognizes

The bridge intentionally consumes the compatible subset and lets Codex own generation behavior instead of pretending every sampler can be mapped.

For Codex-specific knobs that SillyTavern does not model directly, use the Custom endpoint's Additional Parameters YAML. The bridge consumes these fields when present:

```yaml
service_tier: priority
include_reasoning: true
reasoning_effort: medium
```

`service_tier: fast` is also accepted and normalized to Codex's current `priority` request value. Keeping the model id as the real Codex model, for example `gpt-5.5`, preserves SillyTavern's model-gated reasoning-effort forwarding.

## Reasoning Summaries

Codex app-server has reasoning summary events, and the bridge requests and forwards them when reasoning is enabled. In testing on May 18, 2026, OpenAI/Codex did not populate those summaries for `gpt-5.5`: the bridge sent `summary: detailed` and `effort: xhigh`, then received a completed reasoning item with zero summary characters.

So the plumbing is present, but there may be no reasoning text to display. If Codex starts filling these summaries later, the bridge should pass them through without a SillyTavern-side change.

## Prompt Semantics

SillyTavern uses the OpenAI `name` field for prompt semantics that are easy to lose in a bridge:

- Chat history can carry speaker names when "names in completion" is enabled.
- Example dialogue messages are emitted as `role: "system"` with names such as `example_user` and `example_assistant`.
- Prompt post-processing can merge, strictify, or single-message-flatten prompts before the backend forwards them.

The bridge preserves those semantics before starting a Codex turn:

- Leading unnamed `system` messages become Codex base instructions.
- Later unnamed `system` messages become Codex developer instructions.
- `system` messages named `example_user` or `example_assistant` become transcript messages labeled as example user/assistant turns.
- Named user/assistant messages are text-prefixed with the name so Codex still sees speaker identity.

This keeps SillyTavern's prompt manager behavior closer to its OpenAI-compatible intent while retaining the bridge's read-only, no-tool-call Codex posture.

## Upstream Pointers

- SillyTavern message formatting and chat `name` handling: https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/openai.js#L561-L624
- SillyTavern named example-dialogue construction: https://github.com/SillyTavern/SillyTavern/blob/release/public/scripts/openai.js#L1097-L1124
- SillyTavern Custom backend forwarding: https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/backends/chat-completions.js#L2304-L2322 and https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/backends/chat-completions.js#L2537-L2573
- SillyTavern Custom status/model check: https://github.com/SillyTavern/SillyTavern/blob/release/src/endpoints/backends/chat-completions.js#L1735-L1995
- SillyTavern prompt post-processing and name prefixing: https://github.com/SillyTavern/SillyTavern/blob/release/src/prompt-converters.js#L823-L956
