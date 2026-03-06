/**
 * message.ts
 *
 * Main message dispatch orchestrator for the TypeX standalone plugin.
 * Pure helpers live in ./message-helpers.ts.
 */

import type { HistoryEntry, OpenClawConfig } from "openclaw/plugin-sdk";
import {
  buildPendingHistoryContextFromMap,
  clearHistoryEntriesIfEnabled,
  DEFAULT_GROUP_HISTORY_LIMIT,
  recordPendingHistoryEntryIfEnabled,
} from "openclaw/plugin-sdk";
import type { TypeXClient } from "./client.js";
import {
  buildAgentBody,
  checkBotMentioned,
  isAllowedBySenderId,
  normalizeAllowEntry,
  normalizeMessageToText,
  resolveGroupConfig,
  stripBotMention,
} from "./message-helpers.js";
import { getTypeXRuntime } from "./runtime.js";
import { sendMessageTypeX } from "./send.js";
import { TypeXMessageEnum, type TypeXMessageEntry } from "./types.js";

export type ProcessTypeXMessageOptions = {
  cfg?: OpenClawConfig;
  accountId?: string;
  botName?: string;
  typexCfg?: Record<string, any>;
  chatHistories?: Map<string, HistoryEntry[]>;
  logger?: {
    warn: (msg: string) => void;
    info: (msg: string) => void;
    error: (msg: string) => void;
  };
};

// Re-export for convenience
export { buildAgentBody, checkBotMentioned, normalizeMessageToText, stripBotMention } from "./message-helpers.js";

const CHANNEL_ID = "openclaw-extension-typex";

export async function processTypeXMessage(
  client: TypeXClient,
  payload: TypeXMessageEntry,
  appId: string,
  options: ProcessTypeXMessageOptions = {},
) {
  const cfg = options.cfg;
  const accountId = options.accountId ?? appId;
  const logger = options.logger;
  const typexCfg = options.typexCfg ?? {};
  const chatHistories = options.chatHistories;

  const runtime = getTypeXRuntime();
  const channel = (runtime as Record<string, unknown>).channel as
    | {
      reply?: {
        dispatchReplyWithBufferedBlockDispatcher?: (opts: unknown) => Promise<unknown>;
        resolveEnvelopeFormatOptions?: (cfg: unknown) => unknown;
        formatAgentEnvelope?: (opts: { channel: string; from: string; timestamp: unknown; envelope: unknown; body: string }) => string;
        finalizeInboundContext?: (ctx: unknown) => unknown;
      };
      routing?: { resolveAgentRoute?: (input: unknown) => any };
      commands?: {
        shouldComputeCommandAuthorized?: (body: string, cfg: unknown) => boolean;
      };
      pairing?: {
        readAllowFromStore?: (opts: unknown) => Promise<string[]>;
        upsertPairingRequest?: (opts: unknown) => Promise<{ code: string; created: boolean }>;
        buildPairingReply?: (opts: unknown) => string;
      };
    }
    | undefined;

  if (!channel?.reply?.dispatchReplyWithBufferedBlockDispatcher) {
    logger?.error(`[typex:${accountId}] dispatchReplyWithBufferedBlockDispatcher not available`);
    return;
  }

  if (!payload?.chat_id) {
    logger?.warn("Received invalid event payload");
    return;
  }

  if (!cfg) {
    logger?.error(`[typex:${accountId}] missing full OpenClaw cfg`);
    return;
  }

  const chatId = payload.chat_id;
  const senderId = payload.sender_id;
  const senderName = payload.sender_name ?? senderId;
  const isGroup = payload.chat_type === "group";
  const rawText = normalizeMessageToText(payload);

  logger?.info(`[typex:${accountId}] ${isGroup ? "group" : "DM"} message from ${senderId} in ${chatId}`);

  if (!rawText.trim()) {
    logger?.info(`[typex:${accountId}] skipping empty/system message`);
    return;
  }

  // ── Group access control ──────────────────────────────────────────────────
  if (isGroup) {
    const groupConfig = resolveGroupConfig(typexCfg, chatId);

    if (groupConfig?.enabled === false) {
      logger?.info(`[typex:${accountId}] group ${chatId} is disabled`);
      return;
    }

    const groupPolicy: string = typexCfg?.groupPolicy ?? "open";
    const groupAllowFrom: Array<string | number> = typexCfg?.groupAllowFrom ?? [];

    if (groupPolicy === "disabled") return;
    if (groupPolicy === "allowlist" && !isAllowedBySenderId(groupAllowFrom, chatId)) {
      logger?.info(`[typex:${accountId}] group ${chatId} not in groupAllowFrom`);
      return;
    }

    const effectiveSenderAllowFrom: Array<string | number> =
      groupConfig?.allowFrom ??
      (typexCfg?.groupSenderAllowFrom as Array<string | number> | undefined) ??
      [];
    if (effectiveSenderAllowFrom.length > 0 && !isAllowedBySenderId(effectiveSenderAllowFrom, senderId)) {
      logger?.info(`[typex:${accountId}] sender ${senderId} blocked by sender allowlist`);
      return;
    }

    const requireMention: boolean = groupConfig?.requireMention ?? typexCfg?.requireMention ?? true;
    const mentionedBot = checkBotMentioned(payload, appId);

    if (requireMention && !mentionedBot) {
      logger?.info(`[typex:${accountId}] no @mention — buffering to history`);
      if (chatHistories) {
        recordPendingHistoryEntryIfEnabled({
          historyMap: chatHistories,
          historyKey: chatId,
          limit: typexCfg?.historyLimit ?? cfg.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT,
          entry: {
            sender: senderId,
            body: `${senderName}: ${rawText}`,
            timestamp: typeof payload.create_time === "number" ? payload.create_time : Date.now(),
            messageId: payload.message_id,
          },
        });
      }
      return;
    }
  }

  // ── DM policy check ───────────────────────────────────────────────────────
  if (!isGroup) {
    const dmPolicy: string = typexCfg?.dmPolicy ?? "pairing";
    const configAllowFrom: Array<string | number> = typexCfg?.allowFrom ?? [];

    const storeAllowFrom =
      dmPolicy === "allowlist"
        ? []
        : (await channel.pairing?.readAllowFromStore?.({ channel: CHANNEL_ID, accountId }).catch(() => [] as string[])) ?? [];

    const effectiveDmAllowFrom = [...configAllowFrom.map(String), ...storeAllowFrom];
    const dmAllowed =
      senderId === accountId ||
      effectiveDmAllowFrom.some((e) => {
        const norm = normalizeAllowEntry(e);
        return norm === "*" || norm === normalizeAllowEntry(senderId);
      });

    console.table({
      dmPolicy,
      configAllowFrom,
      storeAllowFrom,
      effectiveDmAllowFrom,
      dmAllowed,
    });
    if (dmPolicy !== "open" && !dmAllowed) {
      if (dmPolicy === "pairing") {
        const result = await channel.pairing?.upsertPairingRequest?.({
          channel: CHANNEL_ID,
          accountId,
          id: senderId,
          meta: { name: senderName !== senderId ? senderName : undefined },
        });
        console.log('result', result);
        if (result) {
          const replyText = channel.pairing?.buildPairingReply?.({
            channel: CHANNEL_ID,
            idLine: `Your TypeX user id: ${senderId}`,
            code: result.code,
          }) ?? `Pairing code: ${result.code}`;
          await sendMessageTypeX(client, chatId, replyText, { msgType: TypeXMessageEnum.text });
        }
      } else {
        logger?.info(`[typex:${accountId}] blocked sender ${senderId} (dmPolicy=${dmPolicy})`);
      }
      return;
    }
  }

  // ── Fetch quoted/parent message ───────────────────────────────────────────
  let quotedContent: string | undefined;
  if (payload.parent_id) {
    try {
      const parentMsg = await client.getMessage(payload.parent_id);
      if (parentMsg) quotedContent = normalizeMessageToText(parentMsg);
    } catch { /* non-fatal */ }
  }

  // ── Fetch image/file attachments ──────────────────────────────────────────
  const attachments: { "content-type": string; size: number; payload: string }[] = [];
  const typeNum = Number(payload.msg_type);
  if ([TypeXMessageEnum.image, TypeXMessageEnum.photoCollageMsg, TypeXMessageEnum.file, TypeXMessageEnum.fileGroup].includes(typeNum)) {
    const objectKey = payload.content.image_key || payload.content.file_key;
    if (objectKey) {
      if (client.mode === "bot") {
        logger?.info(`[typex:${accountId}] fetching attachment objectKey=${objectKey}`);
        const fileData = await client.fetchFileBuffer(objectKey);
        if (fileData) {
          attachments.push({
            "content-type": fileData.mimeType,
            size: fileData.buffer.length,
            payload: fileData.buffer.toString("base64"),
          });
        }
      } else {
        logger?.info(`[typex:${accountId}] skipping attachment fetch because mode is not bot`);
      }
    }
  }

  // ── Normalise text ────────────────────────────────────────────────────────
  const cleanText = checkBotMentioned(payload, appId)
    ? stripBotMention(rawText, payload.mentions)
    : rawText;

  // ── Session routing ───────────────────────────────────────────────────────
  const peerId = isGroup ? chatId : senderId;
  let route: { sessionKey?: string; agentId?: string; accountId?: string } = {};
  try {
    route = channel.routing?.resolveAgentRoute?.({
      cfg,
      channel: CHANNEL_ID,
      accountId,
      peer: { kind: isGroup ? "group" : "direct", id: peerId },
    }) ?? {};
  } catch (e: any) {
    logger?.error(`[typex:${accountId}] resolveAgentRoute failed: ${e?.message ?? String(e)}`);
  }

  // ── Build message body ────────────────────────────────────────────────────
  const historyLimit: number =
    typexCfg?.historyLimit ?? cfg?.messages?.groupChat?.historyLimit ?? DEFAULT_GROUP_HISTORY_LIMIT;

  const envelopeOptions = channel.reply?.resolveEnvelopeFormatOptions?.(cfg) ?? {};
  const agentBody = buildAgentBody({
    messageId: payload.message_id,
    senderLabel: senderName,
    content: cleanText,
    quotedContent,
  });

  const envelopeFrom = isGroup ? `${chatId}:${senderId}` : senderId;
  const formattedBody: string =
    channel.reply?.formatAgentEnvelope?.({
      channel: "TypeX",
      from: envelopeFrom,
      timestamp: new Date(typeof payload.create_time === "number" ? payload.create_time : Date.now()),
      envelope: envelopeOptions,
      body: agentBody,
    }) ?? agentBody;

  let combinedBody = formattedBody;
  if (isGroup && chatHistories) {
    combinedBody = buildPendingHistoryContextFromMap({
      historyMap: chatHistories,
      historyKey: chatId,
      limit: historyLimit,
      currentMessage: formattedBody,
      formatEntry: (entry) =>
        channel.reply?.formatAgentEnvelope?.({
          channel: "TypeX",
          from: `${chatId}:${entry.sender}`,
          timestamp: entry.timestamp,
          envelope: envelopeOptions,
          body: entry.body,
        }) ?? entry.body,
    });
  }

  const inboundHistory =
    isGroup && chatHistories && historyLimit > 0
      ? (chatHistories.get(chatId) ?? []).map((e) => ({ sender: e.sender, body: e.body, timestamp: e.timestamp }))
      : undefined;

  const typexTo = isGroup ? `chat:${chatId}` : `user:${senderId}`;

  const ctxPayload = channel.reply?.finalizeInboundContext?.({
    Body: combinedBody,
    BodyForAgent: agentBody,
    InboundHistory: inboundHistory,
    ReplyToId: payload.parent_id,
    RootMessageId: payload.root_id,
    RawBody: cleanText,
    CommandBody: cleanText,
    From: `typex:${senderId}`,
    To: typexTo,
    SessionKey: route.sessionKey,
    AccountId: route.accountId ?? accountId,
    ChatType: isGroup ? "group" : "direct",
    GroupSubject: isGroup ? chatId : undefined,
    SenderName: senderName,
    SenderId: senderId,
    Provider: CHANNEL_ID,
    Surface: CHANNEL_ID,
    MessageSid: payload.message_id,
    ReplyToBody: quotedContent,
    Timestamp: typeof payload.create_time === "number" ? payload.create_time : Date.now(),
    WasMentioned: checkBotMentioned(payload, appId),
    OriginatingChannel: CHANNEL_ID,
    OriginatingTo: typexTo,
    Attachments: attachments.length > 0 ? attachments : undefined,
  });

  logger?.info(`[typex:${accountId}] dispatching (session=${route.sessionKey ?? "default"})`);

  // ── Dispatch to agent ─────────────────────────────────────────────────────
  await channel.reply.dispatchReplyWithBufferedBlockDispatcher({
    ctx: ctxPayload,
    cfg,
    dispatcherOptions: {
      channel: CHANNEL_ID,
      accountId,
      deliver: async (responsePayload: unknown) => {
        const rp = responsePayload as { text?: string; mediaUrls?: string[]; mediaUrl?: string };
        if (rp.text) {
          await sendMessageTypeX(client, chatId, rp.text, { msgType: TypeXMessageEnum.richText });
        }
        const urls = rp.mediaUrls?.length ? rp.mediaUrls : rp.mediaUrl ? [rp.mediaUrl] : [];
        for (const url of urls) {
          await sendMessageTypeX(client, chatId, {}, { mediaUrl: url, msgType: TypeXMessageEnum.richText });
        }
      },
      onError: (err: Error) => {
        logger?.error(`[typex:${accountId}] reply error: ${err.message}`);
      },
    },
    replyOptions: { disableBlockStreaming: true, embedded: false },
  });

  // ── Clear group history after dispatch ────────────────────────────────────
  if (isGroup && chatHistories) {
    clearHistoryEntriesIfEnabled({ historyMap: chatHistories, historyKey: chatId, limit: historyLimit });
  }
}
