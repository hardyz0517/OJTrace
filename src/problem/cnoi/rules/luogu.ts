import type { BuiltinAliases } from "./common";

export const luoguRules: BuiltinAliases = {
  aliases: {
    input: ["^(?:formatI|inputFormat)$"],
    output: ["^(?:formatO|outputFormat)$"],
    samples: [
      "^(?:输入输出样例|输入输出示例|samples?|examples?|入出力例)(?:\\s*#\\s*[0-9A-Za-z一二三四五六七八九十]+)?$",
    ],
    hint: ["^提示说明$"],
  },
};
