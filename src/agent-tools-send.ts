import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import type { ChannelAgentTool } from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/channel-core";
import { getTypeXClient } from "./client/client.js";
import { TypeXMessageEnum } from "./client/types.js";

type ResolvedPeerTarget =
  | { kind: "chat"; id: string; name: string; matchedBy: "feed" }
  | { kind: "user"; id: string; name: string; matchedBy: "contact" };

type ResolvedGroupMember = {
  id: string;
  name: string;
};

type ExecuteTypeXSendByNameParams = {
  cfg?: OpenClawConfig;
  recipient: string;
  message?: string;
  mediaPath?: string;
  mediaPaths?: string[];
  accountId?: string | null;
};

type ExecuteTypeXSendInGroupParams = {
  cfg?: OpenClawConfig;
  chatId: string;
  memberName: string;
  message?: string;
  mediaPath?: string;
  mediaPaths?: string[];
  accountId?: string | null;
};

const TYPEX_IMAGE_SEND_MSG_TYPE = 2 as TypeXMessageEnum;

const TYPEX_SEND_BY_NAME_SCHEMA = {
  type: "object",
  properties: {
    recipient: { type: "string", minLength: 1 },
    message: { type: "string" },
    mediaPath: { type: "string" },
    accountId: { type: "string" },
  },
  required: ["recipient"],
  additionalProperties: false,
} as const;

const TYPEX_SEND_IN_GROUP_SCHEMA = {
  type: "object",
  properties: {
    chatId: { type: "string", minLength: 1, description: "当前 TypeX 群聊 chat_id，可传 chat:123 形式。" },
    memberName: { type: "string", minLength: 1 },
    message: { type: "string" },
    mediaPath: { type: "string" },
    accountId: { type: "string" },
  },
  required: ["chatId", "memberName"],
  additionalProperties: false,
} as const;

function normalizeName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase().replace(/\s+/g, "");
}

function normalizeChatId(value: string): string {
  return value.trim().replace(/^chat:/i, "").replace(/^group:/i, "");
}

function resolveTypeXClient(cfg: OpenClawConfig | undefined, accountId?: string | null) {
  const typexCfg = (cfg?.channels?.["openclaw-extension-typex"] ?? {}) as Record<string, unknown>;
  const resolvedAccountId = accountId?.trim() || DEFAULT_ACCOUNT_ID;
  const client = getTypeXClient(resolvedAccountId, { typexCfg });
  return { client, accountId: resolvedAccountId };
}

function dedupeByKey<T>(items: T[], getKey: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = getKey(item).trim();
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function filterMembersByName<T extends { name?: string }>(items: T[], query: string): T[] {
  const normalizedQuery = normalizeName(query);
  const exact = items.filter((item) => normalizeName(item.name) === normalizedQuery);
  if (exact.length > 0) {
    return exact;
  }
  return items.filter((item) => normalizeName(item.name).includes(normalizedQuery));
}

function filterMembersMentionedInSentence<T extends { name?: string }>(items: T[], sentence: string): T[] {
  const normalizedSentence = normalizeName(sentence);
  if (!normalizedSentence) {
    return [];
  }
  return items.filter((item) => {
    const normalizedMemberName = normalizeName(item.name);
    return normalizedMemberName.length > 0 && normalizedSentence.includes(normalizedMemberName);
  });
}

async function resolvePeerTargetByName(params: {
  cfg?: OpenClawConfig;
  recipient: string;
  accountId?: string | null;
}): Promise<ResolvedPeerTarget> {
  const { client } = resolveTypeXClient(params.cfg, params.accountId);
  if (client.mode !== "user") {
    throw new Error("typex_send_by_name 需要使用 TypeX user 账号。");
  }

  const contacts = await client.searchContactsByName(params.recipient);
  const uniqueMatchingContacts = dedupeByKey(
    contacts
      .map((contact) => ({
        friendId: String(contact.friend_id ?? ""),
        name: String(contact.name ?? contact.friend_id ?? ""),
      }))
      .filter((entry) => entry.friendId),
    (entry) => entry.friendId,
  );
  console.log(
    `[TypeX tool] resolvePeerTargetByName recipient=${JSON.stringify(params.recipient)} contacts=${uniqueMatchingContacts.length}`,
  );

  if (uniqueMatchingContacts.length === 1) {
    return {
      kind: "user",
      id: uniqueMatchingContacts[0].friendId,
      name: uniqueMatchingContacts[0].name,
      matchedBy: "contact",
    };
  }
  if (uniqueMatchingContacts.length > 1) {
    console.log(
      `[TypeX tool] ambiguous contact matches recipient=${JSON.stringify(params.recipient)} matches=${JSON.stringify(uniqueMatchingContacts)}`,
    );
    throw new Error(`找到多个名为 ${params.recipient} 的联系人，请说得更具体一点。`);
  }

  const feeds = await client.searchFeedsByName(params.recipient);
  const uniqueMatchingFeeds = dedupeByKey(
    feeds
      .map((feed) => ({
        chatId: String(feed.chat_id ?? ""),
        name: String(feed.name ?? feed.chat_id ?? ""),
      }))
      .filter((entry) => entry.chatId),
    (entry) => entry.chatId,
  );
  console.log(
    `[TypeX tool] resolvePeerTargetByName recipient=${JSON.stringify(params.recipient)} feeds=${uniqueMatchingFeeds.length}`,
  );

  if (uniqueMatchingFeeds.length === 1) {
    return {
      kind: "chat",
      id: uniqueMatchingFeeds[0].chatId,
      name: uniqueMatchingFeeds[0].name,
      matchedBy: "feed",
    };
  }
  if (uniqueMatchingFeeds.length > 1) {
    console.log(
      `[TypeX tool] ambiguous feed matches recipient=${JSON.stringify(params.recipient)} matches=${JSON.stringify(uniqueMatchingFeeds)}`,
    );
    throw new Error(`找到多个名为 ${params.recipient} 的会话，请说得更具体一点。`);
  }

  throw new Error(`没有找到名为 ${params.recipient} 的会话或联系人。`);
}

async function buildUploadedMediaPayload(params: {
  cfg?: OpenClawConfig;
  accountId?: string | null;
  chatId: string;
  mediaPath: string;
}) {
  const { client } = resolveTypeXClient(params.cfg, params.accountId);
  const filePath = params.mediaPath.trim();
  const fileName = basename(filePath);
  const buffer = await readFile(filePath);
  const ext = extname(fileName).toLowerCase();
  const isImage = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"].includes(ext);
  const fileType = isImage ? "image" : "application";
  const upload = client.mode === "bot"
    ? await client.uploadResource(fileName, fileType, buffer, params.chatId)
    : await client.uploadUserResource(fileName, fileType, buffer, params.chatId);

  if (isImage) {
    return {
      msgType: TYPEX_IMAGE_SEND_MSG_TYPE,
      content: {
        object_url: upload.address || upload.objectKey,
        thumb_url: upload.address || upload.objectKey,
        width: upload.width || 800,
        height: upload.height || 600,
      },
      kindLabel: "image",
    };
  }

  return {
    msgType: TypeXMessageEnum.file,
    content: {
      object_url: upload.address || upload.objectKey,
      file_name: fileName,
      file_size: buffer.length,
      file_type: "application/octet-stream",
    },
    kindLabel: "file",
  };
}

function formatToolTextResult(text: string, details: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

export async function executeTypeXSendByName(params: ExecuteTypeXSendByNameParams) {
  const recipient = String(params.recipient ?? "").trim();
  const message = String(params.message ?? "").trim();
  const mediaPaths = [
    ...((params.mediaPaths ?? []).map((entry) => String(entry ?? "").trim()).filter(Boolean)),
    ...([params.mediaPath].map((entry) => String(entry ?? "").trim()).filter(Boolean)),
  ];

  if (!recipient) {
    throw new Error("recipient 不能为空。");
  }
  if (!message && mediaPaths.length === 0) {
    throw new Error("message 和 mediaPath 至少要提供一个。");
  }

  const target = await resolvePeerTargetByName({
    cfg: params.cfg,
    recipient,
    accountId: params.accountId,
  });
  const { client, accountId } = resolveTypeXClient(params.cfg, params.accountId);
  const sent: string[] = [];

  for (const mediaPath of mediaPaths) {
    if (target.kind !== "chat") {
      throw new Error("按联系人直发图片/文件需要已有会话 chat_id；当前只找到了联系人，没有可上传资源的会话。");
    }
    const uploaded = await buildUploadedMediaPayload({
      cfg: params.cfg,
      accountId,
      chatId: target.id,
      mediaPath,
    });
    await client.sendDelegatedChatMessage(target.id, uploaded.content, uploaded.msgType);
    sent.push(uploaded.kindLabel);
  }

  if (message) {
    if (target.kind === "chat") {
      await client.sendDelegatedChatMessage(target.id, { text: message }, TypeXMessageEnum.text);
    } else {
      await client.sendDelegatedContactMessage(target.id, { text: message }, TypeXMessageEnum.text);
    }
    sent.push("text");
  }

  return {
    target,
    sent,
  };
}

export async function executeTypeXSendInGroup(params: ExecuteTypeXSendInGroupParams) {
  const rawChatId = String(params.chatId ?? "").trim();
  const memberName = String(params.memberName ?? "").trim();
  const message = String(params.message ?? "").trim();
  const mediaPaths = [
    ...((params.mediaPaths ?? []).map((entry) => String(entry ?? "").trim()).filter(Boolean)),
    ...([params.mediaPath].map((entry) => String(entry ?? "").trim()).filter(Boolean)),
  ];

  if (!rawChatId || !memberName) {
    throw new Error("chatId 和 memberName 不能为空。");
  }
  if (!message && mediaPaths.length === 0) {
    throw new Error("message 和 mediaPath 至少要提供一个。");
  }

  const chatId = normalizeChatId(rawChatId);
  const member = await resolveGroupMemberByName({
    cfg: params.cfg,
    chatId,
    memberName,
    accountId: params.accountId,
  });
  const { client, accountId } = resolveTypeXClient(params.cfg, params.accountId);
  const sent: string[] = [];

  for (const mediaPath of mediaPaths) {
    const uploaded = await buildUploadedMediaPayload({
      cfg: params.cfg,
      accountId,
      chatId,
      mediaPath,
    });
    await client.sendBotGroupMessage(chatId, uploaded.content, uploaded.msgType, {
      atUserIds: [member.id],
    });
    sent.push(uploaded.kindLabel);
  }

  if (message) {
    await client.sendBotGroupMessage(chatId, message, TypeXMessageEnum.text, {
      atUserIds: [member.id],
    });
    sent.push("text");
  }

  return {
    chatId,
    member,
    sent,
  };
}

export function createTypeXSendByNameTool(params: { cfg?: OpenClawConfig }): ChannelAgentTool {
  return {
    label: "TypeX Send By Name",
    name: "typex_send_by_name",
    description:
      "当用户在 TypeX 单聊里明确要求“发给某人/转给某人”时，用这个工具。它会按名字查找 TypeX 会话或联系人，并以当前登录的 user 身份代发文本或本地图片/文件。",
    parameters: TYPEX_SEND_BY_NAME_SCHEMA as any,
    execute: async (_toolCallId, rawArgs) => {
      const args = rawArgs as {
        recipient?: string;
        message?: string;
        mediaPath?: string;
        accountId?: string;
      };
      const recipient = String(args.recipient ?? "").trim();
      const message = String(args.message ?? "").trim();
      const mediaPath = String(args.mediaPath ?? "").trim();
      if (!recipient) {
        throw new Error("recipient 不能为空。");
      }
      if (!message && !mediaPath) {
        throw new Error("message 和 mediaPath 至少要提供一个。");
      }
      console.log(
        `[TypeX tool] typex_send_by_name recipient=${JSON.stringify(recipient)} hasMessage=${message ? "1" : "0"} mediaPath=${JSON.stringify(mediaPath)}`,
      );
      const { target, sent } = await executeTypeXSendByName({
        cfg: params.cfg,
        recipient,
        message,
        mediaPath,
        accountId: args.accountId,
      });

      return formatToolTextResult(
        `已向 ${target.name || recipient} 发送 ${sent.join(" + ")}。`,
        {
          ok: true,
          channel: "openclaw-extension-typex",
          tool: "typex_send_by_name",
          targetKind: target.kind,
          targetId: target.id,
          matchedBy: target.matchedBy,
          sent,
        },
      );
    },
  };
}

async function resolveGroupMemberByName(params: {
  cfg?: OpenClawConfig;
  chatId: string;
  memberName: string;
  accountId?: string | null;
}): Promise<ResolvedGroupMember> {
  const { client } = resolveTypeXClient(params.cfg, params.accountId);
  if (client.mode !== "bot") {
    throw new Error("typex_send_in_group 需要使用 TypeX bot 账号。");
  }
  const members = dedupeByKey(
    (await client.listGroupMembers(params.chatId))
      .map((member) => ({
        id: String(member.user_id ?? ""),
        name: String(member.name ?? member.user_id ?? ""),
      }))
      .filter((entry) => entry.id),
    (entry) => entry.id,
  );
  const directMatches = filterMembersByName(members, params.memberName).filter((entry: { id: string; name: string }) => entry.id);
  const matches = directMatches.length > 0
    ? directMatches
    : filterMembersMentionedInSentence(members, params.memberName).filter((entry: { id: string; name: string }) => entry.id);
  console.log(
    `[TypeX tool] resolveGroupMemberByName memberName=${JSON.stringify(params.memberName)} directMatches=${directMatches.length} sentenceMatches=${matches.length}`,
  );

  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    throw new Error(`当前群里有多个成员匹配 ${params.memberName}，请说得更具体一点。`);
  }
  throw new Error(`当前群里没有找到名为 ${params.memberName} 的成员。`);
}

export function createTypeXSendInGroupTool(params: { cfg?: OpenClawConfig }): ChannelAgentTool {
  return {
    label: "TypeX Send In Group",
    name: "typex_send_in_group",
    description:
      "当用户在 TypeX 群聊里要求 bot 给某个群成员发消息时，用这个工具。它会在当前群里按名字找成员，并以 bot 身份在该群中 @ 对方发送文本或本地图片/文件。",
    parameters: TYPEX_SEND_IN_GROUP_SCHEMA as any,
    execute: async (_toolCallId, rawArgs) => {
      const args = rawArgs as {
        chatId?: string;
        memberName?: string;
        message?: string;
        mediaPath?: string;
        accountId?: string;
      };
      const rawChatId = String(args.chatId ?? "").trim();
      const memberName = String(args.memberName ?? "").trim();
      const message = String(args.message ?? "").trim();
      const mediaPath = String(args.mediaPath ?? "").trim();
      if (!rawChatId || !memberName) {
        throw new Error("chatId 和 memberName 不能为空。");
      }
      if (!message && !mediaPath) {
        throw new Error("message 和 mediaPath 至少要提供一个。");
      }
      console.log(
        `[TypeX tool] typex_send_in_group chatId=${JSON.stringify(rawChatId)} memberName=${JSON.stringify(memberName)} hasMessage=${message ? "1" : "0"} mediaPath=${JSON.stringify(mediaPath)}`,
      );
      const { chatId, member, sent } = await executeTypeXSendInGroup({
        cfg: params.cfg,
        chatId: rawChatId,
        memberName,
        message,
        mediaPath,
        accountId: args.accountId,
      });

      return formatToolTextResult(
        `已在群 ${chatId} 中发送给 ${member.name || memberName}：${sent.join(" + ")}。`,
        {
          ok: true,
          channel: "openclaw-extension-typex",
          tool: "typex_send_in_group",
          chatId,
          memberId: member.id,
          sent,
        },
      );
    },
  };
}
