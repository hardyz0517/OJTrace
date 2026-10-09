import type { AdapterMetadata } from "../domain/adapter";
import { SOURCE_IDS, type SourceId } from "../domain/types";

/** Static source facts; account labels and Hydro instance scope remain account-specific. */
export interface SourceDefinition {
  readonly metadata: AdapterMetadata;
  readonly officialHomeUrl: string;
  /** Hydro uses its configured origin and deliberately has no fixed origin. */
  readonly fixedOrigin?: string;
}

type SourceDefinitionMap = {
  readonly [Source in SourceId]: SourceDefinition & {
    readonly metadata: AdapterMetadata & {
      readonly id: Source;
    } & (Source extends "atcoder"
        ? { readonly dataOrigins: readonly [string, ...string[]] }
        : object);
  } & (Source extends "hydroj" ? object : { readonly fixedOrigin: string });
};

export const sourceDefinitions: SourceDefinitionMap = {
  codeforces: {
    metadata: {
      id: "codeforces",
      displayName: "Codeforces",
      availability: "stable",
      authModes: [
        {
          type: "browser-session",
          recommended: true,
        },
        {
          type: "manual-cookie",
          credentialFields: [
            {
              key: "cookie",
              label: "JSESSIONID",
              type: "password",
              credentialType: "cookie",
              placeholder: "粘贴 JSESSIONID 的值",
            },
          ],
          identifierRequired: false,
        },
        {
          type: "public-handle",
          label: "直接输入用户名",
          description: "直接输入 Codeforces 用户名，使用公开提交记录。",
        },
      ],
    },
    officialHomeUrl: "https://codeforces.com/",
    fixedOrigin: "https://codeforces.com",
  },
  luogu: {
    metadata: {
      id: "luogu",
      displayName: "洛谷",
      availability: "stable",
      authModes: [
        {
          type: "browser-session",
          recommended: true,
        },
        {
          type: "manual-cookie",
          credentialFields: [
            {
              key: "__client_id",
              label: "__client_id",
              type: "password",
              credentialType: "cookie",
              placeholder: "粘贴 __client_id 的值",
              required: true,
            },
            {
              key: "_uid",
              label: "_uid",
              type: "password",
              credentialType: "cookie",
              placeholder: "粘贴 _uid 的值",
              required: true,
            },
          ],
          identifierRequired: false,
        },
      ],
    },
    officialHomeUrl: "https://www.luogu.com.cn/",
    fixedOrigin: "https://www.luogu.com.cn",
  },
  qoj: {
    metadata: {
      id: "qoj",
      displayName: "QOJ",
      availability: "experimental",
      authModes: [
        {
          type: "browser-session",
          recommended: true,
        },
        {
          type: "manual-cookie",
          credentialFields: [
            {
              key: "cookie",
              label: "Cookie",
              type: "password",
              credentialType: "cookie",
              placeholder: "粘贴 QOJ 完整 Cookie（如 __Host-UOJSESSID=...）",
            },
          ],
          identifierRequired: false,
        },
      ],
    },
    officialHomeUrl: "https://qoj.ac/",
    fixedOrigin: "https://qoj.ac",
  },
  atcoder: {
    metadata: {
      id: "atcoder",
      displayName: "AtCoder",
      availability: "stable",
      dataOrigins: ["https://kenkoooo.com/*", "https://atcoder.jp/*"],
      authModes: [
        {
          type: "browser-session",
          recommended: true,
        },
        {
          type: "manual-cookie",
          credentialFields: [
            {
              key: "REVEL_SESSION",
              label: "REVEL_SESSION",
              type: "password",
              credentialType: "cookie",
              placeholder: "粘贴 REVEL_SESSION 值",
            },
          ],
          identifierRequired: false,
        },
      ],
    },
    officialHomeUrl: "https://atcoder.jp/",
    fixedOrigin: "https://atcoder.jp",
  },
  hydroj: {
    metadata: {
      id: "hydroj",
      displayName: "HydroOJ",
      availability: "stable",
      authModes: [
        {
          type: "browser-session",
          recommended: true,
        },
        {
          type: "manual-cookie",
          identifierRequired: false,
          credentialFields: [
            {
              key: "sid",
              label: "sid",
              type: "password",
              credentialType: "cookie",
              placeholder: "粘贴 sid 值",
            },
            {
              key: "sid.sig",
              label: "sid.sig",
              type: "password",
              credentialType: "cookie",
              placeholder: "粘贴 sid.sig 值",
            },
          ],
        },
        {
          type: "password",
          label: "账号密码登录",
          description:
            "使用 HydroOJ 用户名和密码登录；会话过期后自动重新登录。",
          identifierRequired: false,
          credentialFields: [
            {
              key: "username",
              label: "用户名",
              type: "text",
              placeholder: "例如 username",
            },
            {
              key: "password",
              label: "密码",
              type: "password",
              placeholder: "输入 HydroOJ 密码",
            },
          ],
        },
      ],
    },
    officialHomeUrl: "https://hydro.ac/",
  },
} as const satisfies SourceDefinitionMap;

/** UI and permission consumers follow the domain source order. */
export const sources: readonly SourceDefinition[] = SOURCE_IDS.map(
  (source) => sourceDefinitions[source],
);
