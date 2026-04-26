import { textPart, type NormalizedContentPart, type NormalizedMessage } from "./normalize";

export type ActiveTurn = {
  history: NormalizedMessage[];
  input: NormalizedContentPart[];
  isSyntheticContinue: boolean;
};

export function chooseActiveTurn(messages: NormalizedMessage[], continueNudge: string, firstReplyNudge: string): ActiveTurn {
  const last = messages.at(-1);

  if (last?.role === "user") {
    return {
      history: messages.slice(0, -1),
      input: last.content,
      isSyntheticContinue: false,
    };
  }

  if (!last) {
    return {
      history: [],
      input: [textPart(firstReplyNudge)],
      isSyntheticContinue: false,
    };
  }

  return {
    history: messages,
    input: [textPart(continueNudge)],
    isSyntheticContinue: true,
  };
}
