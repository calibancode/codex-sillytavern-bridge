import { test } from "node:test";
import * as assert from "node:assert/strict";
import { chooseActiveTurn } from "./continue";
import { normalizeChatRequest } from "./normalize";
import { preparePrompt } from "./prompt";

test("preparePrompt preserves SillyTavern named dialogue examples as transcript messages", () => {
  const { messages } = normalizeChatRequest({
    messages: [
      { role: "system", content: "Write the next reply in character." },
      { role: "system", name: "example_user", content: "Hello there." },
      { role: "system", name: "example_assistant", content: "Well hello!" },
      { role: "user", name: "Alice", content: "What now?" },
    ],
  });

  const prepared = preparePrompt(messages);

  assert.equal(prepared.baseInstructions, "Write the next reply in character.");
  assert.equal(prepared.developerInstructions, "");
  assert.equal(prepared.conversationMessages.length, 3);
  assert.equal(prepared.conversationMessages[0].role, "user");
  assert.equal(prepared.conversationMessages[0].content[0]?.type, "text");
  assert.equal(prepared.conversationMessages[0].content[0]?.text, "Example user: Hello there.");
  assert.equal(prepared.conversationMessages[1].role, "assistant");
  assert.equal(prepared.conversationMessages[1].content[0]?.type, "text");
  assert.equal(prepared.conversationMessages[1].content[0]?.text, "Example assistant: Well hello!");
  assert.equal(prepared.conversationMessages[2].content[0]?.type, "text");
  assert.equal(prepared.conversationMessages[2].content[0]?.text, "Alice: What now?");
});

test("preparePrompt carries non-leading system messages as developer instructions", () => {
  const { messages } = normalizeChatRequest({
    messages: [
      { role: "user", content: "Hi." },
      { role: "system", content: "Keep the answer terse." },
      { role: "assistant", content: "Sure." },
    ],
  });

  const prepared = preparePrompt(messages);

  assert.equal(prepared.baseInstructions, "");
  assert.equal(prepared.developerInstructions, "Keep the answer terse.");
  assert.deepEqual(prepared.conversationMessages.map((message) => message.role), ["user", "assistant"]);
});

test("chooseActiveTurn receives name-prefixed active user input", () => {
  const { messages } = normalizeChatRequest({
    messages: [
      { role: "system", content: "Reply naturally." },
      {
        role: "user",
        name: "Morgan",
        content: [
          { type: "text", text: "Look at this." },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc", detail: "low" } },
        ],
      },
    ],
  });

  const prepared = preparePrompt(messages);
  const activeTurn = chooseActiveTurn(prepared.conversationMessages, "continue", "first");

  assert.equal(activeTurn.isSyntheticContinue, false);
  assert.equal(activeTurn.input[0]?.type, "text");
  assert.equal(activeTurn.input[0]?.text, "Morgan: Look at this.");
  assert.equal(activeTurn.input[1]?.type, "image");
});
