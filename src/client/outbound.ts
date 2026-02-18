import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk";
import { getTypeXClient } from "./client.js";
import { sendMessageTypeX } from "./send.js";

export const typexOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  // chunker: ... (optional, default might be used or I can skip for MVP)
  chunkerMode: "markdown",
  textChunkLimit: 2000,

  sendText: async ({ to, text, accountId }: any) => {
    const client = getTypeXClient(accountId ?? undefined);
    const result = await sendMessageTypeX(client, { text });
    return {
      channel: "typex",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },

  sendMedia: async ({ to, text, mediaUrl, accountId }: any) => {
    const client = getTypeXClient(accountId ?? undefined);
    const result = await sendMessageTypeX(client, { text: text || "" }, { mediaUrl });
    return {
      channel: "typex",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },
};
