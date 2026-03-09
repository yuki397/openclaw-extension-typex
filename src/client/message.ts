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
import fs from "node:fs";
import path from "node:path";

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

    const requireMention: boolean = groupConfig?.requireMention ?? typexCfg?.requireMention ?? false;
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
    const dmPolicy: string = typexCfg?.dmPolicy ?? "open";
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

    if (dmPolicy !== "open" && !dmAllowed) {
      if (dmPolicy === "pairing") {
        const result = await channel.pairing?.upsertPairingRequest?.({
          channel: CHANNEL_ID,
          accountId,
          id: senderId,
          meta: { name: senderName !== senderId ? senderName : undefined },
        });
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
  const attachments: any[] = [];
  const attachmentPaths: string[] = [];
  const typeNum = Number(payload.msg_type);
  if ([TypeXMessageEnum.image, TypeXMessageEnum.photoCollageMsg, TypeXMessageEnum.file, TypeXMessageEnum.fileGroup].includes(typeNum)) {
    const parsedContent: any = typeof payload.content === "string" ? JSON.parse(payload.content) : payload.content;
    const objectKeys = new Set<string>();

    const extractKey = (urlStr?: string) => {
      if (!urlStr) return;
      try {
        const u = new URL(urlStr);
        const k = u.searchParams.get("object_key");
        if (k) objectKeys.add(k);
      } catch { }
    };

    if (parsedContent.image_key) objectKeys.add(parsedContent.image_key);
    if (parsedContent.file_key) objectKeys.add(parsedContent.file_key);
    extractKey(parsedContent.object_url);

    if (Array.isArray(parsedContent.images)) {
      parsedContent.images.forEach((img: any) => extractKey(img.object_url));
    }
    if (Array.isArray(parsedContent.videos)) {
      parsedContent.videos.forEach((vid: any) => extractKey(vid.object_url));
    }
    if (Array.isArray(parsedContent.items)) {
      parsedContent.items.forEach((item: any) => {
        const mc = typeof item.content === 'string' ? JSON.parse(item.content) : item.content;
        if (mc?.image_key) objectKeys.add(mc.image_key);
        if (mc?.file_key) objectKeys.add(mc.file_key);
        extractKey(mc?.object_url);
      });
    }

    if (objectKeys.size > 0) {
      if (client.mode === "bot") {
        for (const objectKey of objectKeys) {
          logger?.info(`[typex:${accountId}] fetching attachment objectKey=${objectKey}`);
          const fileData = await client.fetchFileBuffer(objectKey);
          if (fileData) {
            const isImage = fileData.mimeType.startsWith("image/");

            // Persist to local disk so the agent can open the image via the read tool
            // even if this surface can't transport binary attachments to the model.
            try {
              const extRaw = String(fileData.mimeType ?? "application/octet-stream").split("/")[1] ?? "bin";
              const ext = extRaw === "jpeg" ? "jpg" : extRaw;
              const outDir = path.join(process.env.HOME ?? ".", ".openclaw", "typex-attachments", String(payload.message_id));
              fs.mkdirSync(outDir, { recursive: true });
              const baseName = String(objectKey).replace(/[^a-zA-Z0-9._-]+/g, "_");
              const outPath = path.join(outDir, `${baseName}.${ext}`);
              fs.writeFileSync(outPath, fileData.buffer);
              attachmentPaths.push(outPath);
              logger?.info?.(`[typex:${accountId}] saved attachment to ${outPath}`);
              console.log('saved attachment to', outPath);
            } catch (e: any) {
              const msg = e?.message ?? String(e);
              logger?.warn?.(`[typex:${accountId}] failed to persist attachment: ${msg}`);
              console.log('failed to persist attachment', msg);
              try {
                console.log('persist debug', {
                  home: process.env.HOME,
                  cwd: process.cwd(),
                  messageId: payload.message_id,
                  objectKey,
                  mimeType: fileData.mimeType,
                });
              } catch { }
            }

            attachments.push({
              contentType: fileData.mimeType,
              mimeType: fileData.mimeType, // Alias
              size: fileData.buffer.length,
              payload: fileData.buffer.toString("base64"),
              data: fileData.buffer.toString("base64"), // Alias
              type: isImage ? "image" : "file", // Alias
            });
          }
        }
        console.log('processed attachments:', attachments.map(a => ({ type: a.contentType, size: a.size })));
      } else {
        logger?.info(`[typex:${accountId}] skipping attachment fetch because mode is not bot`);
      }
    }
  }

  // ── Normalise text ────────────────────────────────────────────────────────
  const cleanText = checkBotMentioned(payload, appId)
    ? stripBotMention(rawText, payload.mentions)
    : rawText;

  const cleanTextWithAttachments = attachmentPaths.length > 0
    ? `${cleanText}\n\n[TypeX attachments saved locally]\n${attachmentPaths.map(p => `- ${p}`).join("\n")}`
    : cleanText;

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
    content: cleanTextWithAttachments,
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
    RawBody: cleanTextWithAttachments,
    CommandBody: cleanTextWithAttachments,
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
    attachments: attachments.length > 0 ? attachments : undefined, // Alias
    Media: attachments.length > 0 ? attachments : undefined,
    media: attachments.length > 0 ? attachments : undefined, // Alias
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

        // Allow a simple escape hatch for sending local/remote media even when
        // the upstream agent interface can't emit structured mediaUrls.
        // If the agent includes lines like:
        //   [[typex_send_media:/abs/path/to.png]]
        //   [[typex_send_media:https://example.com/a.jpg]]
        // we will upload+send that media and strip the directive from the text.
        const extractedFromText: string[] = [];
        let text = rp.text;
        if (text) {
          const re = /\[\[typex_send_media:([^\]]+)\]\]/g;
          text = text.replace(re, (_m, p1) => {
            const v = String(p1 ?? "").trim();
            if (v) extractedFromText.push(v);
            return "";
          }).trim();
        }

        if (text) {
          await sendMessageTypeX(client, chatId, text, { msgType: TypeXMessageEnum.richText });
        }

        const urls = rp.mediaUrls?.length
          ? rp.mediaUrls
          : rp.mediaUrl
            ? [rp.mediaUrl]
            : [];

        for (const url of [...urls, ...extractedFromText]) {
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
