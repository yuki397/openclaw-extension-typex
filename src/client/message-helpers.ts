/**
 * message-helpers.ts
 *
 * Pure, stateless helper functions for TypeX message processing.
 * All functions are free of side-effects and easy to unit-test.
 */

import { TypeXMessageEnum, type TypeXMessageEntry, type TypeXMention } from "./types.js";

// ---------------------------------------------------------------------------
// Message content normalisation
// ---------------------------------------------------------------------------

export function normalizeMessageToText(msg: TypeXMessageEntry): string {
  const typeNum = Number(msg.msg_type);

  switch (typeNum) {
    case TypeXMessageEnum.text:
    case TypeXMessageEnum.richText:
      return msg.content.text ?? "";

    case TypeXMessageEnum.image:
    case TypeXMessageEnum.photoCollageMsg:
      return "<media:image>";

    case TypeXMessageEnum.file:
    case TypeXMessageEnum.fileGroup:
      return msg.content.file_name ? `<media:file:${msg.content.file_name}>` : "<media:file>";

    case TypeXMessageEnum.video:
      return "<media:video>";

    case TypeXMessageEnum.emoji:
      return "<media:sticker>";

    case TypeXMessageEnum.newCard: {
      const card = msg.content.card;
      if (!card) return "[Card message]";
      try {
        const raw = typeof card === "string" ? card : JSON.stringify(card);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        const title =
          (parsed.header as Record<string, unknown> | undefined)?.title ?? parsed.title ?? "";
        const body = parsed.body ?? parsed.content ?? parsed.text ?? "";
        const parts = [title, body].map((p) => String(p ?? "").trim()).filter(Boolean);
        return parts.length > 0 ? parts.join("\n") : "[Card message]";
      } catch {
        return "[Card message]";
      }
    }

    case TypeXMessageEnum.forward: {
      const items = msg.content.items ?? [];
      if (items.length === 0) return "[Merged and Forwarded Messages]";
      const lines = ["[Merged and Forwarded Messages]"];
      const limit = Math.min(items.length, 50);
      for (let i = 0; i < limit; i++) {
        const item = items[i];
        const itemText = item.content?.text?.trim() ?? `[type: ${item.msg_type ?? "unknown"}]`;
        const sender = item.sender?.name ?? item.sender?.id ?? "unknown";
        lines.push(`- ${sender}: ${itemText}`);
      }
      if (items.length > 50) lines.push(`... and ${items.length - 50} more messages`);
      return lines.join("\n");
    }

    case TypeXMessageEnum.mentioned:
    case TypeXMessageEnum.custom:
    case TypeXMessageEnum.via:
      return msg.content.text ?? `[Message type: ${typeNum}]`;

    default:
      return `[Unsupported message type: ${msg.msg_type}]`;
  }
}

// ---------------------------------------------------------------------------
// @mention helpers
// ---------------------------------------------------------------------------

export function checkBotMentioned(msg: TypeXMessageEntry, botId?: string): boolean {
  if (!botId) return false;
  return (msg.mentions ?? []).some(
    (m) => m.id.open_id === botId || m.id.user_id === botId,
  );
}

export function stripBotMention(text: string, mentions?: TypeXMention[]): string {
  if (!mentions || mentions.length === 0) return text;
  let result = text;
  for (const mention of mentions) {
    result = result.replace(new RegExp(`@${escapeRegExp(mention.name)}\\s*`, "g"), "");
    if (mention.key) result = result.replace(new RegExp(escapeRegExp(mention.key), "g"), "");
  }
  return result.trim();
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ---------------------------------------------------------------------------
// Access control helpers
// ---------------------------------------------------------------------------

export type TypeXGroupConfig = {
  enabled?: boolean;
  requireMention?: boolean;
  allowFrom?: Array<string | number>;
};

export function resolveGroupConfig(
  typexCfg: Record<string, any>,
  groupId: string,
): TypeXGroupConfig | undefined {
  const groups = typexCfg?.groups ?? {};
  return (groups[groupId] as TypeXGroupConfig | undefined) ?? (groups["*"] as TypeXGroupConfig | undefined);
}

export function normalizeAllowEntry(raw: string): string {
  return raw.trim().toLowerCase().replace(/^typex:/i, "");
}

export function isAllowedBySenderId(
  allowFrom: Array<string | number>,
  senderId: string,
): boolean {
  const norm = allowFrom.map((e) => normalizeAllowEntry(String(e))).filter(Boolean);
  if (norm.includes("*")) return true;
  return norm.includes(normalizeAllowEntry(senderId));
}

// ---------------------------------------------------------------------------
// Agent message body builder
// ---------------------------------------------------------------------------

export function buildAgentBody(params: {
  messageId: string;
  senderLabel: string;
  content: string;
  quotedContent?: string;
}): string {
  const { messageId, senderLabel, content, quotedContent } = params;
  let body = content;
  if (quotedContent) body = `[Replying to: "${quotedContent}"]\n\n${body}`;
  return `[message_id: ${messageId}]\n${senderLabel}: ${body}`;
}
