import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { HistoryEntry, OpenClawConfig, RuntimeEnv } from "openclaw/plugin-sdk";
import { getTypeXClient } from "./client.js";
import { processTypeXMessage } from "./message.js";

export type MonitorTypeXOpts = {
  account: unknown; // ResolvedTypeXAccount + extras from gateway
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  log?: unknown;
  typexCfg: Record<string, any>;
  /** Full OpenClaw gateway config (needed for bindings/routing). */
  cfg: OpenClawConfig;
};

const OPENCLAW_CONFIG_PATH =
  process.env.OPENCLAW_CONFIG_PATH ||
  path.join(os.homedir(), ".openclaw", "openclaw.json");

/** Read pos from openclaw.json: channels.openclaw-extension-typex.accounts.<accountId>.pos */
async function readPos(accountId: string): Promise<number> {
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw);
    const pos = cfg?.channels?.["openclaw-extension-typex"]?.accounts?.[accountId]?.pos;
    if (typeof pos === "number") return pos;
  } catch {
    // ignore — will fall through to migration
  }

  // Migrate from legacy state file locations (pre-openclaw.json storage).
  // Priority (highest first):
  //   v1 (oldest): /tmp/typex/.typex_pos_<safeId>.json  — flat-file format
  //   v2:          /tmp/typex/<accountId>/.typex_pos.json — accountId-subdir format
  // If v1 exists it takes precedence; v2 is only used when v1 is absent.
  const safeId = (accountId || "default").replace(/[^a-z0-9]/gi, "_");
  const legacyCandidates = [
    path.join("/tmp", "typex", `.typex_pos_${safeId}.json`),          // v1 (oldest)
    path.join("/tmp", "typex", accountId, ".typex_pos.json"),          // v2
  ];

  for (const candidate of legacyCandidates) {
    try {
      const data = await fs.readFile(candidate, "utf-8");
      const json = JSON.parse(data);
      if (typeof json.pos === "number") {
        // Persist to openclaw.json and remove legacy file.
        await savePos(accountId, json.pos);
        await fs.unlink(candidate).catch(() => { });
        return json.pos;
      }
    } catch {
      /* try next */
    }
  }

  return 0;
}

/** Write pos back into openclaw.json under the account config. */
async function savePos(accountId: string, pos: number): Promise<void> {
  try {
    const raw = await fs.readFile(OPENCLAW_CONFIG_PATH, "utf-8");
    const cfg = JSON.parse(raw);
    cfg.channels ??= {};
    cfg.channels["openclaw-extension-typex"] ??= {};
    cfg.channels["openclaw-extension-typex"].accounts ??= {};
    cfg.channels["openclaw-extension-typex"].accounts[accountId] ??= {};
    cfg.channels["openclaw-extension-typex"].accounts[accountId].pos = pos;
    await fs.writeFile(OPENCLAW_CONFIG_PATH, JSON.stringify(cfg, null, 4));
  } catch {
    // Non-fatal: losing pos means re-processing a few messages at worst.
  }
}

export async function monitorTypeXProvider(opts: MonitorTypeXOpts) {
  try {
    const { account, runtime, abortSignal, log, typexCfg, cfg } = opts;
    const accountObj = account as {
      config: { token?: string; appId?: string; mode?: "user" | "bot" };
      accountId: string;
      name?: string;
    };
    const { token, appId, mode } = accountObj.config;
    // log is unknown, cast for usage
    const logger = log as
      | { warn: (msg: string) => void; info: (msg: string) => void; error: (msg: string) => void }
      | undefined;

    if (!token) {
      logger?.warn(`[${accountObj.accountId}] No token found. Stopping monitor.`);
      return;
    }

    // Initialize Client
    const client = getTypeXClient(undefined, { token, mode: mode ?? "user", skipConfigCheck: true });

    logger?.info(`[${accountObj.accountId}] Starting TypeX monitor (mode=${mode ?? "user"})...`);

    let currentPos = await readPos(accountObj.accountId);
    logger?.info(`[${accountObj.accountId}] Loaded pos: ${currentPos}`);

    // Group history buffer: lives for the entire monitor lifetime.
    const chatHistories = new Map<string, HistoryEntry[]>();

    // --- Polling Loop ---
    while (!abortSignal.aborted) {
      try {
        const messages = await client.fetchMessages(currentPos);

        if (messages && messages.length > 0) {
          for (const msg of messages) {
            // Dispatch to OpenClaw via processTypeXMessage
            await processTypeXMessage(client, msg, appId || accountObj.accountId, {
              accountId: accountObj.accountId,
              cfg,
              typexCfg,
              botName: accountObj.name,
              chatHistories,
              logger
            });

            if (typeof msg.position === "number") {
              currentPos = msg.position;
              await savePos(accountObj.accountId, currentPos);
            }
          }
        }
      } catch (err) {
        logger?.error(
          `Error in TypeX polling loop: ${err instanceof Error ? err.stack : String(err)}`,
        );
      }

      if (abortSignal.aborted) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
    logger?.info(`Stopping TypeX monitor...`);
  } catch (e) {
    throw e;
  }
}
