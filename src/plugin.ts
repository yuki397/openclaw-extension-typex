import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { buildChannelConfigSchema } from "openclaw/plugin-sdk/channel-core";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
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
      "You can send messages to other users or groups on TypeX by using the messaging tools.",
      "Always resolve the recipient's ID using directory search (listPeers or listGroups) if you only have a name.",
    ],
  },
  reload: { configPrefixes: ["channels.typex"] },
  outbound: typexOutbound as any,

  messaging: {
    normalizeTarget: (t) => t.trim().replace(/^typex:/i, ""),
    targetResolver: {
      looksLikeId: (raw) => {
        const trimmed = raw.trim();
        return /^(?:\d+|user:\d+|chat:\d+|group:\d+)$/i.test(trimmed);
      },
      hint: "<chat_id | user:id | chat:id>",
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
