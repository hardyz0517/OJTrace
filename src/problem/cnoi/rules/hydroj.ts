import type { BuiltinAliases } from "./common";

export const hydrojRules: BuiltinAliases = {
  aliases: {
    input: ["^输入说明$"],
    output: ["^输出说明$"],
    samples: ["^(?:输入输出示例|测试样例|sample cases)$"],
    hint: ["^(?:样例解释与提示|提示与说明)$"],
  },
};
