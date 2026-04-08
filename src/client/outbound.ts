import type { ChannelOutboundAdapter } from "openclaw/plugin-sdk/core";
import { getTypeXClient } from "./client.js";
import { sendMessageTypeX } from "./send.js";
import { TypeXMessageEnum } from "./types.js";

function resolveTypeXTarget(rawTarget: string): { chatId: string; receiverId?: string } {
  const trimmed = (rawTarget ?? "").trim();
  console.log(`[TypeX outbound] resolveTypeXTarget raw=${JSON.stringify(rawTarget ?? "")} trimmed=${JSON.stringify(trimmed)}`);
  if (/^user:\d+$/i.test(trimmed)) {
    const resolved = { chatId: trimmed.replace(/^user:/i, ""), receiverId: trimmed.replace(/^user:/i, "") };
    console.log(`[TypeX outbound] resolved user target chatId=${resolved.chatId} receiverId=${resolved.receiverId}`);
    return resolved;
  }
  if (/^(?:chat|group):\d+$/i.test(trimmed)) {
    const resolved = { chatId: trimmed.replace(/^(?:chat|group):/i, "") };
    console.log(`[TypeX outbound] resolved chat/group target chatId=${resolved.chatId}`);
    return resolved;
  }
  const resolved = { chatId: trimmed };
  console.log(`[TypeX outbound] resolved bare target chatId=${resolved.chatId}`);
  return resolved;
}

export const typexOutbound: ChannelOutboundAdapter = {
  deliveryMode: "direct",
  // chunker: ... (optional, default might be used or I can skip for MVP)
  chunkerMode: "markdown",
  textChunkLimit: 2000,
  resolveTarget: ({ to }) => {
    const trimmed = (to ?? "").trim();
    console.log(`[TypeX outbound] resolveTarget to=${JSON.stringify(to ?? "")} trimmed=${JSON.stringify(trimmed)}`);
    if (!trimmed) {
      return { ok: false as const, error: new Error("TypeX target is required.") };
    }

    if (/^(?:user|chat|group):\d+$/i.test(trimmed) || /^\d+$/.test(trimmed)) {
      console.log(`[TypeX outbound] resolveTarget accepted=${trimmed}`);
      return { ok: true as const, to: trimmed };
    }

    console.log(`[TypeX outbound] resolveTarget rejected=${trimmed}`);
    return {
      ok: false as const,
      error: new Error("TypeX target must be a numeric id or a user:/chat:/group: target."),
    };
  },

  sendText: async ({ to, text, accountId, cfg }: any) => {
    const typexCfg = (cfg?.channels?.["openclaw-extension-typex"] ?? {}) as Record<string, any>;
    const client = getTypeXClient(accountId ?? undefined, { typexCfg });
    const target = resolveTypeXTarget(to);
    console.log(
      `[TypeX outbound] sendText account=${accountId ?? ""} mode=${client.mode} to=${JSON.stringify(to)} chatId=${target.chatId} receiverId=${target.receiverId ?? ""}`,
    );
    
    let hasMention = false;
    const finalText = (text || "").replace(/<at\s+user_id="([^"]+)"(?:>([^<]*)<\/at>|\s*\/>)/g, (match: string, userId: string, name: string) => {
      hasMention = true;
      const label = name || userId;
      return `@${label} `;
    });

    const result = await sendMessageTypeX(client, target.chatId, finalText, {
      receiverId: target.receiverId,
      msgType: hasMention ? TypeXMessageEnum.text : undefined,
    });
    return {
      channel: "openclaw-extension-typex",
      messageId: result?.message_id || "unknown",
      chatId: target.chatId,
    };
  },

  sendMedia: async ({ to, text, mediaUrl, accountId, cfg }: any) => {
    const typexCfg = (cfg?.channels?.["openclaw-extension-typex"] ?? {}) as Record<string, any>;
    const client = getTypeXClient(accountId ?? undefined, { typexCfg });
    const target = resolveTypeXTarget(to);
    console.log(
      `[TypeX outbound] sendMedia account=${accountId ?? ""} mode=${client.mode} to=${JSON.stringify(to)} chatId=${target.chatId} receiverId=${target.receiverId ?? ""} mediaUrl=${JSON.stringify(mediaUrl ?? "")}`,
    );
    
    let hasMention = false;
    const finalText = (text || "").replace(/<at\s+user_id="([^"]+)"(?:>([^<]*)<\/at>|\s*\/>)/g, (match: string, userId: string, name: string) => {
      hasMention = true;
      const label = name || userId;
      return `@${label} `;
    });

    const result = await sendMessageTypeX(client, target.chatId, finalText, {
      mediaUrl,
      receiverId: target.receiverId,
      msgType: hasMention ? TypeXMessageEnum.text : undefined,
    });
    return {
      channel: "openclaw-extension-typex",
      messageId: result?.message_id || "unknown",
      chatId: target.chatId,
    };
  },
};
