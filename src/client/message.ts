import type { TypeXClient } from "./client.js";
import type { TypeXMessageEntry } from "./types.js";
import { sendMessageTypeX } from "./send.js";
import { getTypeXRuntime } from "./runtime.js";
import { OpenClawConfig } from "openclaw/plugin-sdk";

export type ProcessTypeXMessageOptions = {
  cfg?: OpenClawConfig;
  accountId?: string;
  botName?: string;
  typexCfg?: Record<string, any>;
  logger?: { warn: (msg: string) => void; info: (msg: string) => void; error: (msg: string) => void }
  | undefined;
};

export async function processTypeXMessage(
  client: TypeXClient,
  payload: TypeXMessageEntry,
  appId: string,
  options: ProcessTypeXMessageOptions = {},
) {
  const cfg = options.typexCfg;
  const accountId = options.accountId ?? appId;
  const logger = options.logger;
  const runtime = getTypeXRuntime();
  const channel = (runtime as Record<string, unknown>).channel as
    | { reply?: { dispatchReplyWithBufferedBlockDispatcher?: (opts: unknown) => Promise<unknown> } }
    | undefined;
  if (!channel?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
    logger?.error(`[typex:${accountId}] dispatchReplyWithBufferedBlockDispatcher not available`);
    return;
  }

  if (!payload || !payload.chat_id) {
    logger?.warn("Received invalid event payload");
    return;
  }

  const chatId = payload.chat_id;
  const senderId = payload.sender_id;
  // Use content as text for now. If content is JSON string, parse it.
  let text = payload.content.text;
  // Attempt simple parsing if it looks like JSON? For now assume plain text or handle in future.

  // Basic logging
  logger?.info(`Processing TypeX message from ${senderId} in ${chatId}`);
  logger?.info(`channel: ${JSON.stringify(channel)}, account: ${accountId}, type: ${typeof accountId}}`);

  // Build Context for Agent
  const ctx = {
    Body: text,
    RawBody: text,
    From: senderId,
    To: chatId,
    SenderId: senderId,
    SenderName: payload.sender_name || "User",
    ChatType: "dm", // Simplified, TypeX mostly DM for now?
    Provider: "openclaw-extension-typex",
    Surface: "openclaw-extension-typex",
    Timestamp: payload.create_time || Date.now(),
    MessageSid: payload.message_id,
    AccountId: accountId,
    OriginatingChannel: "openclaw-extension-typex",
    OriginatingTo: chatId,
  };

  // Dispatch to Agent
  await channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx,
    cfg,
    dispatcherOptions: {
      channel: "openclaw-extension-typex",
      accountId,
      deliver: async (payload: unknown) => {
        logger?.info(`payload: ${payload}`)
        const responsePayload = payload as {
          text?: string;
          mediaUrls?: string[];
          mediaUrl?: string;
        };
        // Handle text response
        if (responsePayload.text) {
          await sendMessageTypeX(client, responsePayload.text);
        }

        // Handle media if present in response
        const mediaUrls = responsePayload.mediaUrls?.length
          ? responsePayload.mediaUrls
          : responsePayload.mediaUrl
            ? [responsePayload.mediaUrl]
            : [];

        for (const mediaUrl of mediaUrls) {
          await sendMessageTypeX(client, {}, { mediaUrl });
        }
      },
      onError: (err: Error) => {
        logger?.error(`Reply dispatch error: ${err.message}`);
      },
    },
    replyOptions: {
      disableBlockStreaming: true,
      embedded: true,
    },
  });
}
