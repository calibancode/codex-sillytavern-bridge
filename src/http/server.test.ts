import { test } from "node:test";
import * as assert from "node:assert/strict";
import { isChatCompletionsPath, isModelsPath } from "./server";

test("OpenAI route helpers accept SillyTavern root and /v1 paths", () => {
  assert.equal(isModelsPath("/models"), true);
  assert.equal(isModelsPath("/v1/models"), true);
  assert.equal(isModelsPath("/v2/models"), false);

  assert.equal(isChatCompletionsPath("/chat/completions"), true);
  assert.equal(isChatCompletionsPath("/v1/chat/completions"), true);
  assert.equal(isChatCompletionsPath("/v1/responses"), false);
});
