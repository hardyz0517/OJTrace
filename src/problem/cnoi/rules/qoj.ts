import type { BuiltinAliases } from "./common";

export const qojRules: BuiltinAliases = {
  aliases: {
    input: ["^input specification$"],
    output: ["^output specification$"],
    samples: [
      "^(?:sample tests?|sample cases?|example tests?|样例测试|样例数据)$",
    ],
    hint: ["^(?:sample notes|备注)$"],
  },
};
