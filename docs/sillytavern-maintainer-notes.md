# Maintainer Notes

This repository is an external local bridge for using SillyTavern's Custom OpenAI-compatible endpoint with `codex app-server`.

The bridge uses the documented Codex app-server protocol and the user's local Codex installation/authentication state.

It does not include OpenAI credentials, API keys, browser-cookie extraction, or token scraping.

By default, it listens on `127.0.0.1` and is intended for local use.

It does not implement remote access control. If exposed beyond loopback, it should be placed behind trusted network/auth controls.

For safety, each request starts a fresh ephemeral Codex thread, uses read-only sandboxing, sets `approvalPolicy: "never"`, and rejects OpenAI tool/function requests.

The current implementation is best treated as experimental and community-maintained rather than official OpenAI or SillyTavern functionality.

Users remain responsible for using OpenAI services in accordance with OpenAI's applicable terms and policies.

## Policy Posture

OpenAI documents Codex app-server as a protocol for building rich clients and product integrations around Codex. This bridge uses that documented local protocol rather than reverse-engineered web endpoints, copied tokens, browser cookies, or shared API keys.

OpenAI's terms generally permit use of its services subject to documentation, applicable law, and usage policies. They prohibit sharing account credentials, making an account available to others, reselling or leasing account access, bypassing usage limits or safety measures, reverse engineering services, and using services for disallowed content or activity.

This bridge is therefore best understood as a local single-user compatibility layer over a documented Codex integration surface. It is not an official OpenAI or SillyTavern integration, and roleplay/chat frontend use is not an explicitly listed Codex use case in OpenAI's public Codex examples.

The risk profile changes materially if the bridge is used as a hosted/shared service, exposed without authentication, backed by one user's account for other users, marketed as official support, used to bypass usage limits, or used for content that violates OpenAI's Usage Policies.

## References

- https://developers.openai.com/codex/app-server
- https://developers.openai.com/codex/sdk
- https://developers.openai.com/codex/open-source
- https://openai.com/policies/terms-of-use/
- https://openai.com/policies/service-terms/
- https://openai.com/policies/usage-policies/
