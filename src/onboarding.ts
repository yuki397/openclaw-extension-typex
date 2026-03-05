import type { ChannelOnboardingAdapter } from "openclaw/plugin-sdk";
import qrcode from "qrcode-terminal";
import { resolveDefaultTypeXAccountId } from "./client/accounts.js";
import { getTypeXClient } from "./client/client.js";

const CHANNEL_ID = "openclaw-extension-typex";

function extractQrCodeId(qrcodeData: string): string {
  try {
    const url = new URL(qrcodeData);
    return url.searchParams.get("qr_code_id") || "";
  } catch {
    // Fallback for raw querystrings or non-URL payloads.
    const queryOnly = qrcodeData.includes("?") ? qrcodeData.split("?")[1] || "" : qrcodeData;
    return new URLSearchParams(queryOnly).get("qr_code_id") || "";
  }
}

export const typexOnboardingAdapter: ChannelOnboardingAdapter = {
  channel: CHANNEL_ID,
  getStatus: async ({ cfg }) => {
    const accountId = resolveDefaultTypeXAccountId(cfg);
    const accountToken = cfg.channels?.[CHANNEL_ID]?.accounts?.[accountId]?.token;
    const topLevelToken = cfg.channels?.[CHANNEL_ID]?.token;
    const configured = Boolean(
      (typeof accountToken === "string" && accountToken.trim()) ||
      (typeof topLevelToken === "string" && topLevelToken.trim()),
    );

    return {
      channel: CHANNEL_ID,
      configured,
      statusLines: [`TypeX (${accountId}): ${configured ? "configured" : "not configured"}`],
      selectionHint: configured ? "configured" : "setup needed",
      quickstartScore: configured ? 5 : 0,
    };
  },
  configure: async ({ cfg, prompter }) => {
    const typexCfg = (cfg.channels?.[CHANNEL_ID] ?? {}) as Record<string, any>;

    // ── Step 1: choose account mode ───────────────────────────────────────────
    const modeChoice = await prompter.select<"user" | "bot">({
      message: "Choose Account type",
      options: [
        { label: "User — Scan QR code to login, send and receive messages as a user", value: "user" },
        { label: "Bot  — Fill in Bot Token, serve groups as a bot", value: "bot" },
      ],
    });

    // ── Step 2a: Bot mode — just ask for the token ────────────────────────────
    if (modeChoice === "bot") {
      const botToken = await prompter.text({
        message: "Enter Bot Token (Bot Token):",
        placeholder: "bot-xxxxxxxxxxxxxxxx",
        validate: (v) => (v?.trim() ? undefined : "Bot Token is required"),
      });

      if (!botToken?.trim()) {
        throw new Error("Bot Token is required.");
      }

      const botName = await prompter.text({
        message: "Give this bot a name (optional):",
        placeholder: "My Group Bot",
      });

      const accountId = `bot-${Date.now()}`;
      if (!cfg.channels) cfg.channels = {};
      if (!cfg.channels[CHANNEL_ID]) cfg.channels[CHANNEL_ID] = {};
      if (!cfg.channels[CHANNEL_ID].accounts) cfg.channels[CHANNEL_ID].accounts = {};

      cfg.channels[CHANNEL_ID].accounts[accountId] = {
        mode: "bot",
        token: botToken.trim(),
        ...(botName?.trim() ? { botName: botName.trim(), name: botName.trim() } : {}),
      };
      cfg.channels[CHANNEL_ID].defaultAccount = accountId;

      await prompter.note(`Bot "${botName?.trim() || accountId}" configured successfully!`, "Done");

      return { cfg, accountId };
    }

    // ── Step 2b: User mode — QR-code login flow ───────────────────────────────
    const client = getTypeXClient(undefined, { skipConfigCheck: true, typexCfg, prompter, mode: "user" });
    await prompter.note(`Initializing TypeX ...\nPlease scan the QR code shortly.`, "TypeX Setup");

    try {
      const qrcodeData = await client.fetchQrcodeUrl();
      const qrcodeId = extractQrCodeId(qrcodeData);
      if (!qrcodeId) {
        throw new Error("TypeX QR payload missing qr_code_id.");
      }
      console.log("\nScan this QR code with TypeX App:\n");
      qrcode.generate(qrcodeData, { small: true });

      await prompter.note("Waiting for scan...", "Status");

      let token: string | null = null;
      let userId: string = "";
      let attempts = 0;
      const maxAttempts = 60;

      while (!token && attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 2000));
        const loginSuccessfully = await client.checkLoginStatus(qrcodeId);
        if (loginSuccessfully) {
          token = await client.getAccessToken();
          userId = await client.getCurUserId();
          break;
        }
        attempts++;
        process.stdout.write(".");
      }

      console.log("\n");

      if (!token) {
        throw new Error("Login timed out. Please try again.");
      }

      if (!cfg.channels) cfg.channels = {};
      if (!cfg.channels[CHANNEL_ID]) cfg.channels[CHANNEL_ID] = {};
      if (!cfg.channels[CHANNEL_ID].accounts) cfg.channels[CHANNEL_ID].accounts = {};

      // Merge with existing account config to preserve any other fields.
      const existingAccount = ((
        cfg.channels[CHANNEL_ID].accounts as Record<string, Record<string, unknown>>
      )[userId] ?? {}) as Record<string, unknown>;
      cfg.channels[CHANNEL_ID].accounts[userId] = {
        ...existingAccount,
        mode: "user",
        token,
      };
      cfg.channels[CHANNEL_ID].defaultAccount = userId;

      await prompter.note("Success! TypeX linked.", "Done");
      await client.sendMessage(userId, "openclaw linked");

      return { cfg, accountId: userId };
    } catch (error) {
      await prompter.note(`Setup Failed: ${String(error)}`, "Error");
      throw error;
    }
  },
};
