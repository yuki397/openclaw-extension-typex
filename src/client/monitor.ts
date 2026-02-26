import * as fs from "fs/promises";
import * as path from "path";
import { getTypeXClient } from "./client.js";
import { processTypeXMessage } from "./message.js";
import type { RuntimeEnv, OpenClawConfig } from "openclaw/plugin-sdk";

export type MonitorTypeXOpts = {
  account: unknown; // ResolvedTypeXAccount + extras from gateway
  runtime: RuntimeEnv;
  abortSignal: AbortSignal;
  log?: unknown;
  typexCfg: Record<string, any>;
  /** Full OpenClaw gateway config (needed for bindings/routing). */
  cfg: OpenClawConfig;
};

export async function monitorTypeXProvider(opts: MonitorTypeXOpts) {
  try {
    const { account, runtime, abortSignal, log, typexCfg, cfg } = opts;
    const accountObj = account as {
      config: { token?: string; appId?: string };
      accountId: string;
      name?: string;
    };
    const { token, appId } = accountObj.config;
    // log is unknown, cast for usage
    const logger = log as
      | { warn: (msg: string) => void; info: (msg: string) => void; error: (msg: string) => void }
      | undefined;

    if (!token) {
      logger?.warn(`[${accountObj.accountId}] No token found. Stopping monitor.`);
      return;
    }

    // Initialize Client
    const client = getTypeXClient(undefined, { token, skipConfigCheck: true });

    logger?.info(
      `[${accountObj.accountId}] Starting TypeX monitor for ${accountObj.accountId}...`,
    );

    const baseDir = (runtime as any).dirs?.state || (runtime as any).dirs?.data || "/tmp/typex";
    const accountDir = path.join(baseDir, accountObj.accountId);
    await fs.mkdir(accountDir, { recursive: true });
    const stateFile = path.join(accountDir, ".typex_pos.json");

    let currentPos = 0;
    try {
      const data = await fs.readFile(stateFile, "utf-8");
      const json = JSON.parse(data);
      if (typeof json.pos === "number") {
        currentPos = json.pos;
      }
    } catch {
      // New-path file not found — try migrating from legacy path (pre-accountId-subdir layout).
      try {
        const safeId = (accountObj.accountId || "default").replace(/[^a-z0-9]/gi, "_");
        const legacyFile = path.join(baseDir, `.typex_pos_${safeId}.json`);
        const legacyData = await fs.readFile(legacyFile, "utf-8");
        const legacyJson = JSON.parse(legacyData);
        if (typeof legacyJson.pos === "number") {
          currentPos = legacyJson.pos;
          // Persist to new location so future starts use the correct pos.
          await fs.writeFile(stateFile, JSON.stringify({ pos: currentPos }));
          await fs.unlink(legacyFile).catch(() => { });
          logger?.info(`[${accountObj.accountId}] Migrated pos (${currentPos}) from legacy state file.`);
        }
      } catch {
        /* No legacy file either — start from 0. */
      }
    }

    // --- Polling Loop ---
    while (!abortSignal.aborted) {
      try {
        const messages = await client.fetchMessages(currentPos);
        logger?.info(`[${accountObj.accountId}] Received ${messages?.length || 0} messages.`);

        if (messages && messages.length > 0) {
          for (const msg of messages) {
            // Dispatch to OpenClaw via processTypeXMessage
            await processTypeXMessage(client, msg, appId || accountObj.accountId, {
              accountId: accountObj.accountId,
              // Pass the full OpenClaw config so routing/bindings work.
              cfg,
              typexCfg,
              botName: accountObj.name,
              logger
            });

            if (typeof msg.position === "number") {
              currentPos = msg.position;
            }
          }
          // Save message position
          await fs.writeFile(stateFile, JSON.stringify({ pos: currentPos }));
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
