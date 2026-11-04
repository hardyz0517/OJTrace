import type { BuiltinAliases } from "./common";

export const atcoderRules: BuiltinAliases = {
  aliases: {
    input: ["^入力形式$"],
    output: ["^出力形式$"],
    explanation: ["^(?:入力例|出力例)\\s*[0-9A-Za-z]+\\s*(?:の説明|の解説)$"],
  },
};
