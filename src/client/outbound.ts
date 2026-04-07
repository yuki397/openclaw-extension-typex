import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk/core";
import { getTypeXClient } from "./client.js";
import { sendMessageTypeX } from "./send.js";
import { TypeXMessageEnum } from "./types.js";

export const typexOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  // chunker: ... (optional, default might be used or I can skip for MVP)
  chunkerMode: "markdown",
  textChunkLimit: 2000,

  sendText: async ({ to, text, accountId, cfg }: any) => {
    const typexCfg = (cfg?.channels?.["openclaw-extension-typex"] ?? {}) as Record<string, any>;
    const client = getTypeXClient(accountId ?? undefined, { typexCfg });
    
    let hasMention = false;
    const finalText = (text || "").replace(/<at\s+user_id="([^"]+)"(?:>([^<]*)<\/at>|\s*\/>)/g, (match: string, userId: string, name: string) => {
      hasMention = true;
      const label = name || userId;
      return `@${label} `;
    });

    const result = await sendMessageTypeX(client, to, finalText, { 
      msgType: hasMention ? TypeXMessageEnum.mentioned : undefined 
    });
    return {
      channel: "openclaw-extension-typex",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },

  sendMedia: async ({ to, text, mediaUrl, accountId, cfg }: any) => {
    const typexCfg = (cfg?.channels?.["openclaw-extension-typex"] ?? {}) as Record<string, any>;
    const client = getTypeXClient(accountId ?? undefined, { typexCfg });
    
    let hasMention = false;
    const finalText = (text || "").replace(/<at\s+user_id="([^"]+)"(?:>([^<]*)<\/at>|\s*\/>)/g, (match: string, userId: string, name: string) => {
      hasMention = true;
      const label = name || userId;
      return `@${label} `;
    });

    const result = await sendMessageTypeX(client, to, finalText, { 
      mediaUrl, 
      msgType: hasMention ? TypeXMessageEnum.mentioned : undefined 
    });
    return {
      channel: "openclaw-extension-typex",
      messageId: result?.message_id || "unknown",
      chatId: to,
    };
  },
};
