import {
  messageText,
  textPart,
  type ChatRole,
  type NormalizedContentPart,
  type NormalizedImagePart,
  type NormalizedMessage,
  type NormalizedTextPart,
} from "./normalize";

export type PreparedPrompt = {
  baseInstructions: string;
  developerInstructions: string;
  conversationMessages: NormalizedMessage[];
};

export function preparePrompt(messages: NormalizedMessage[]): PreparedPrompt {
  const baseInstructions: string[] = [];
  const developerInstructions: string[] = [];
  const conversationMessages: NormalizedMessage[] = [];
  let sawConversation = false;

  for (const message of messages) {
    if (message.role === "system") {
      const converted = convertNamedSystemMessage(message);
      if (converted) {
        conversationMessages.push(converted);
        sawConversation = true;
        continue;
      }

      const text = messageText(message).trim();
      if (text) {
        if (sawConversation) {
          developerInstructions.push(text);
        } else {
          baseInstructions.push(text);
        }
      }
      continue;
    }

    conversationMessages.push(applyMessageName(message));
    sawConversation = true;
  }

  return {
    baseInstructions: baseInstructions.join("\n\n"),
    developerInstructions: developerInstructions.join("\n\n"),
    conversationMessages,
  };
}

function convertNamedSystemMessage(message: NormalizedMessage): NormalizedMessage | null {
  if (!message.name) return null;

  const exampleRole = exampleRoleFromName(message.name);
  if (exampleRole) {
    return {
      role: exampleRole,
      content: prefixContent(message.content, exampleLabelFromRole(exampleRole)),
    };
  }

  return {
    role: "user",
    content: prefixContent(message.content, `System ${message.name}`),
  };
}

function applyMessageName(message: NormalizedMessage): NormalizedMessage {
  if (!message.name) return message;

  return {
    role: message.role,
    content: prefixContent(message.content, message.name),
    name: message.name,
  };
}

function exampleRoleFromName(name: string): ChatRole | null {
  if (name === "example_user") return "user";
  if (name === "example_assistant") return "assistant";
  return null;
}

function exampleLabelFromRole(role: ChatRole): string {
  return role === "assistant" ? "Example assistant" : "Example user";
}

function prefixContent(content: NormalizedContentPart[], label: string): NormalizedContentPart[] {
  const parts = content.map(cloneContentPart);
  const prefix = `${label}:`;
  const textPartIndex = parts.findIndex((part) => part.type === "text");

  if (textPartIndex === -1) {
    return [textPart(prefix), ...parts];
  }

  const part = parts[textPartIndex] as NormalizedTextPart;
  const text = part.text.trimStart();
  if (text === prefix || text.startsWith(`${prefix} `)) return parts;

  parts[textPartIndex] = { type: "text", text: part.text ? `${prefix} ${part.text}` : prefix };
  return parts;
}

function cloneContentPart(part: NormalizedContentPart): NormalizedContentPart {
  if (part.type === "text") return { ...part };
  return { ...(part as NormalizedImagePart) };
}
