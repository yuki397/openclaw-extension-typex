import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-core";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type {
  ChannelMessageActionAdapter,
  ChannelMessageToolDiscovery,
} from "openclaw/plugin-sdk/channel-contract";
import { createTypeXSendByNameTool, createTypeXSendInGroupTool } from "./agent-tools-send.js";
import { monitorTypeXProvider } from "./client/monitor.js";
import { typexDirectory } from "./directory.js";
import { typexOutbound } from "./client/outbound.js";
import { TypeXConfigSchema } from "./config-schema.js";
import { typexSetupWizard } from "./onboarding.js";

const meta = {
  id: "openclaw-extension-typex",
  label: "TypeX",
  selectionLabel: "TypeX (QR Code Login)",
  detailLabel: "TypeX Bot",
  docsPath: "/channels/typex",
  docsLabel: "typex",
  blurb: "TypeX bot via QR Code login.",
  order: 100,
  showInSetup: true,
  exposure: { setup: true, docs: true, configured: true },
};

function listEnabledTypeXAccounts(
  cfg: Record<string, any> | undefined,
  accountId?: string | null,
): Array<{ accountId: string }> {
  const typexCfg = (cfg?.channels?.["openclaw-extension-typex"] ?? {}) as Record<string, any>;
  const accounts = (typexCfg.accounts ?? {}) as Record<string, Record<string, any>>;

  if (accountId) {
    const resolvedAccountId = accountId || DEFAULT_ACCOUNT_ID;
    const account =
      accounts[resolvedAccountId] ||
      (resolvedAccountId === DEFAULT_ACCOUNT_ID ? typexCfg : undefined);
    if (account?.enabled !== false && typeof account?.token === "string" && account.token.trim()) {
      return [{ accountId: resolvedAccountId }];
    }
    return [];
  }

  const enabled: Array<{ accountId: string }> = [];
  for (const [listedAccountId, account] of Object.entries(accounts)) {
    if (account?.enabled === false) {
      continue;
    }
    if (typeof account?.token !== "string" || !account.token.trim()) {
      continue;
    }
    enabled.push({ accountId: listedAccountId });
  }

  if (
    enabled.length === 0 &&
    typexCfg.enabled !== false &&
    typeof typexCfg.token === "string" &&
    typexCfg.token.trim()
  ) {
    enabled.push({ accountId: DEFAULT_ACCOUNT_ID });
  }

  return enabled;
}

function describeTypeXMessageTool({
  cfg,
  accountId,
}: Parameters<NonNullable<ChannelMessageActionAdapter["describeMessageTool"]>>[0]): ChannelMessageToolDiscovery {
  const enabledAccounts = listEnabledTypeXAccounts(cfg as Record<string, any> | undefined, accountId);
  return {
    actions: enabledAccounts.length > 0 ? ["send"] : [],
  };
}

const typexMessageActions: ChannelMessageActionAdapter = {
  describeMessageTool: describeTypeXMessageTool,
};

export const typexPlugin = {
  id: "openclaw-extension-typex",
  meta,
  setupWizard: typexSetupWizard,
  capabilities: {
    chatTypes: ["direct", "group"],
    media: true,
    reactions: false,
    threads: false,
    polls: false,
    nativeCommands: false,
    blockStreaming: true,
  },
  agentPrompt: {
    messageToolHints: () => [
      "- TypeX: normal聊天时直接正常回复当前会话，不要调用发送工具。",
      "- TypeX 单聊里如果用户明确要求“帮我发给/转给某人”，优先使用 `typex_send_by_name`，不要只把草稿贴回当前聊天。",
      "- `typex_send_by_name` 适用于 user 身份代发，支持按名字匹配现有会话或联系人；传 `recipient`、`message`，需要转发本地图片/文件时再传 `mediaPath`。",
      "- TypeX 群聊里如果用户要求 bot 在当前群里发给某个成员，优先使用 `typex_send_in_group`；传当前群 `chatId`、成员名 `memberName`，以及 `message` 或 `mediaPath`。",
      "- 当前 TypeX 群上下文里，群 chat id 通常会出现在上下文的 `To: chat:<id>` 一类字段中；给 `typex_send_in_group` 时传这个 id。",
      "- 如果名字匹配不唯一或目标不存在，先简短追问，不要猜。",
    ],
  },
  agentTools: ({ cfg }) => [createTypeXSendByNameTool({ cfg }), createTypeXSendInGroupTool({ cfg })],
  actions: typexMessageActions,
  reload: { configPrefixes: ["channels.typex"] },
  outbound: typexOutbound as any,

  messaging: {
    normalizeTarget: (t) => t.trim().replace(/^typex:/i, ""),
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        return /^(?:\d+|user:\d+|chat:\d+|group:\d+)$/i.test(trimmed);
      },
      hint: "<name | chat_id | user:id | chat:id>",
    },
  },

  configSchema: buildChannelConfigSchema(TypeXConfigSchema as any),

  config: {
    listAccountIds: (cfg) => {
      const accs = cfg.channels?.['openclaw-extension-typex']?.accounts || {};
      return Object.keys(accs);
    },
    resolveAccount: (cfg, accountId) => {
      const id = accountId || DEFAULT_ACCOUNT_ID;
      const globalCheck = cfg.channels?.['openclaw-extension-typex'];
      const account =
        cfg.channels?.['openclaw-extension-typex']?.accounts?.[id] ||
        (id === DEFAULT_ACCOUNT_ID ? globalCheck : undefined);
      return {
        accountId: id,
        name: account?.name || "TypeX",
        enabled: account?.enabled !== false,
        configured: Boolean(account?.token),
        tokenSource: "config",
        config: account || {},
      };
    },
    defaultAccountId: (cfg) => {
      const accs = cfg.channels?.['openclaw-extension-typex']?.accounts || {};
      const first = Object.keys(accs)[0];
      return first || DEFAULT_ACCOUNT_ID;
    },
    setAccountEnabled: ({ cfg }) => cfg,
    deleteAccount: ({ cfg }) => cfg,
    isConfigured: (acc) => acc.configured,
    describeAccount: (acc) => ({
      accountId: acc.accountId!,
      name: acc.name,
      enabled: acc.enabled,
      configured: acc.configured,
      tokenSource: acc.tokenSource,
    }),
    resolveAllowFrom: ({ cfg, accountId }) => {
      const typexCfg = (cfg.channels?.['openclaw-extension-typex'] ?? {}) as any;
      const account = typexCfg.accounts?.[accountId ?? DEFAULT_ACCOUNT_ID];
      const allowFrom = account?.allowFrom ?? typexCfg.allowFrom ?? [];
      return allowFrom.map((e: any) => String(e));
    },
    formatAllowFrom: ({ allowFrom }) =>
      allowFrom
        .map((entry) => String(entry).trim())
        .filter(Boolean)
        .map((entry) => entry.replace(/^typex:/i, "")),
  },

  gateway: {
    startAccount: async (ctx) => {
      const { account, log, setStatus, abortSignal, runtime, cfg } = ctx;
      const typexCfg = (cfg.channels?.['openclaw-extension-typex'] ?? {}) as Record<string, any>;

      log?.info(`[${account.accountId}] TypeX Provider starting...`);

      setStatus({
        accountId: account.accountId,
        running: true,
        lastStartAt: Date.now(),
      });

      try {
        await monitorTypeXProvider({
          account,
          runtime,
          abortSignal,
          log,
          typexCfg,
          cfg,
        });
      } catch (err) {
        log?.error(`TypeX Provider crashed: ${err}`);
        setStatus({
          accountId: account.accountId,
          running: false,
          lastError: err instanceof Error ? err.message : String(err),
          lastStopAt: Date.now(),
        });
        throw err;
      }
    },
  },
  security: {
    // Simplified security policy
    resolveDmPolicy: () => ({
      policy: "open",
      allowFrom: [],
      policyPath: "",
      allowFromPath: "",
      approveHint: "",
      normalizeEntry: (s) => s,
    }),
  },

  groups: {
    resolveRequireMention: ({ cfg, groupId }) => {
      const typexCfg = cfg.channels?.["openclaw-extension-typex"] as Record<string, any> | undefined;
      const groups = typexCfg?.groups ?? {};
      const groupCfg = (groups[groupId ?? ""] ?? groups["*"]) as { requireMention?: boolean } | undefined;
      return groupCfg?.requireMention ?? typexCfg?.requireMention ?? true;
    },
  },

  directory: typexDirectory,

  status: {
    defaultRuntime: {
      accountId: DEFAULT_ACCOUNT_ID,
      running: false,
      lastStartAt: null,
      lastStopAt: null,
      lastError: null,
    },
    collectStatusIssues: () => [],
    buildChannelSummary: async ({ snapshot }) => ({
      configured: snapshot.configured,
      tokenSource: snapshot.tokenSource,
      running: snapshot.running,
      lastStartAt: snapshot.lastStartAt,
      lastStopAt: snapshot.lastStopAt,
      lastError: snapshot.lastError,
      probe: snapshot.probe,
      lastProbeAt: snapshot.lastProbeAt,
    }),
    probeAccount: async () => ({ ok: true, timestamp: Date.now() }),
    buildAccountSnapshot: ({ account, runtime }) => ({
      accountId: account.accountId,
      name: account.name,
      enabled: account.enabled,
      configured: account.configured,
      tokenSource: account.tokenSource,
      running: runtime?.running ?? false,
      lastStartAt: runtime?.lastStartAt ?? null,
      lastStopAt: runtime?.lastStopAt ?? null,
      lastError: runtime?.lastError ?? null,
      lastInboundAt: null,
      lastOutboundAt: null,
    }),
    logSelfId: () => { },
  },
} satisfies ChannelPlugin<any>;
