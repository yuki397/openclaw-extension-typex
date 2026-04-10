import type { WizardPrompter } from "openclaw/plugin-sdk/setup";
import { TYPEX_DOMAIN } from "./domain.js";
import {
  TypeXMessageEnum,
  type TypeXClientOptions,
  type TypeXContactSearchEntry,
  type TypeXFeedSearchEntry,
  type TypeXGroupMemberEntry,
  type TypeXMessageEntry,
} from "./types.js";

let prompter: WizardPrompter | undefined;

type TypeXSendOptions = {
  replyMsgId?: string;
  receiverId?: string;
  isDelegate?: boolean;
  atUserIds?: string[];
  atMentions?: Array<{ id: string; name: string }>;
};

function isSessionAuthFailure(status: number, bodyText: string, resJson?: { code?: number; msg?: string; message?: string }) {
  const combined = `${bodyText} ${resJson?.msg ?? ""} ${resJson?.message ?? ""}`.toLowerCase();
  return status === 401 || combined.includes("session auth error");
}

function summarizeInvalidResponse(status: number, bodyText: string): string {
  const normalized = bodyText.replace(/\s+/g, " ").trim();
  const htmlTitle = normalized.match(/<title>(.*?)<\/title>/i)?.[1]?.trim();
  const htmlHeading = normalized.match(/<h1>(.*?)<\/h1>/i)?.[1]?.trim();
  const summary = htmlTitle || htmlHeading || normalized.slice(0, 120) || "unexpected response body";
  return `HTTP ${status} - ${summary}`;
}

function buildTextContent(content: string | object) {
  return typeof content === "string" ? { text: content } : content;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildMentionRichText(text: string, mentions: Array<{ id: string; name: string }>) {
  const mentionMarkup = mentions
    .map((mention) => `<at userid="${escapeHtml(mention.id)}">${escapeHtml(mention.name)}</at>`)
    .join("&nbsp;");
  const suffix = text.trim() ? `&nbsp;${escapeHtml(text.trim())}` : "";
  return `<p>${mentionMarkup}${suffix}</p>`;
}

export class TypeXClient {
  private options: TypeXClientOptions;
  private accessToken?: string;
  private userId?: string;

  constructor(options: TypeXClientOptions) {
    this.options = options;
    if (options.token) {
      this.accessToken = options.token;
    }
  }

  get mode(): "user" | "bot" {
    return this.options.mode ?? "user";
  }

  async getAccessToken() {
    return this.accessToken ?? "";
  }

  async getCurUserId() {
    return this.userId ?? "";
  }

  private getAuthHeaders(extraHeaders: Record<string, string> = {}) {
    if (!this.accessToken) {
      throw new Error("TypeXClient: Not authenticated.");
    }

    return this.mode === "bot"
      ? { Authorization: `Bearer ${this.accessToken}`, ...extraHeaders }
      : { Cookie: this.accessToken, ...extraHeaders };
  }

  private async postJson<T>(endpoint: string, payload: unknown): Promise<T> {
    const response = await fetch(`${TYPEX_DOMAIN}${endpoint}`, {
      method: "POST",
      headers: this.getAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    let resJson: { code?: number; msg?: string; message?: string; data?: T };
    try {
      resJson = JSON.parse(bodyText);
    } catch {
      if (isSessionAuthFailure(response.status, bodyText)) {
        throw new Error("TypeX 用户登录态已失效，请在 OpenClaw 中重新扫码登录 TypeX user 账号后再试。");
      }
      throw new Error(`TypeX API ${endpoint} returned invalid JSON: ${summarizeInvalidResponse(response.status, bodyText)}`);
    }

    if (!response.ok || resJson.code !== 0) {
      if (isSessionAuthFailure(response.status, bodyText, resJson)) {
        throw new Error("TypeX 用户登录态已失效，请在 OpenClaw 中重新扫码登录 TypeX user 账号后再试。");
      }
      throw new Error(
        `TypeX API ${endpoint} failed: [${resJson.code ?? response.status}] ${resJson.msg || resJson.message || "unknown error"}`,
      );
    }

    return (resJson.data ?? []) as T;
  }

  async fetchQrcodeUrl() {
    const qrResponse = await fetch(`${TYPEX_DOMAIN}/user/qrcode?login_type=open`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (!qrResponse.ok) {
      throw new Error(`Failed to get QR code: ${qrResponse.statusText}`);
    }
    const qrResult = await qrResponse.json();
    if (qrResult.code !== 0 || !qrResult.data) {
      throw new Error(`Failed to get QR code: ${qrResult.msg}`);
    }
    return qrResult.data;
  }

  async checkLoginStatus(qrcodeId: string) {
    const checkRes = await fetch(`${TYPEX_DOMAIN}/open/qrcode/check_auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ qr_code_id: qrcodeId }),
    });
    const setCookieHeader = checkRes.headers.get("set-cookie");
    if (setCookieHeader) {
      const match = setCookieHeader.match(/(sessionid=[^;]+)/);
      if (match?.[1]) this.accessToken = match[1];
    }
    const checkData = await checkRes.json();
    if (checkData.code === 0) {
      this.userId = checkData.data.user_id;
      return true;
    }
    return false;
  }

  private async executeSendMessage(
    endpoint: string,
    to: string,
    payload: Record<string, unknown>,
    preview: string,
  ) {
    if (!this.accessToken) throw new Error("TypeXClient: Not authenticated.");
    if (prompter) prompter.note(`TypeXClient sending to ${to}: ${preview.slice(0, 80)}`);

    const payloadStr = JSON.stringify(payload);

    const response = await fetch(`${TYPEX_DOMAIN}${endpoint}`, {
      method: "POST",
      headers: this.getAuthHeaders({ "Content-Type": "application/json" }),
      body: payloadStr,
    });

    const bodyText = await response.text();
    let resJson;
    try {
      resJson = JSON.parse(bodyText);
    } catch (e) {
      if (isSessionAuthFailure(response.status, bodyText)) {
        throw new Error("TypeX 用户登录态已失效，请在 OpenClaw 中重新扫码登录 TypeX user 账号后再试。");
      }
      throw new Error(`Send message failed (invalid JSON): ${summarizeInvalidResponse(response.status, bodyText)}`);
    }

    if (resJson.code !== 0) {
      if (isSessionAuthFailure(response.status, bodyText, resJson)) {
        throw new Error("TypeX 用户登录态已失效，请在 OpenClaw 中重新扫码登录 TypeX user 账号后再试。");
      }
      throw new Error(`Send message failed: [${resJson.code}] ${resJson.msg || resJson.message}`);
    }
    return resJson.data || { message_id: `msg_${Date.now()}` };
  }

  async sendUserChatMessage(
    chatId: string,
    content: string | object,
    msgType: TypeXMessageEnum = TypeXMessageEnum.text,
  ) {
    return this.executeSendMessage(
      "/open/claw/send_message",
      chatId,
      {
        chat_id: chatId,
        content: buildTextContent(content),
        msg_type: msgType,
      },
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }

  async sendDelegatedChatMessage(
    chatId: string,
    content: string | object,
    msgType: TypeXMessageEnum = TypeXMessageEnum.text,
  ) {
    return this.executeSendMessage(
      "/open/claw/send_message",
      chatId,
      {
        chat_id: chatId,
        content: buildTextContent(content),
        msg_type: msgType,
        is_delegate: true,
      },
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }

  async sendDelegatedContactMessage(
    receiverId: string,
    content: string | object,
    msgType: TypeXMessageEnum = TypeXMessageEnum.text,
  ) {
    return this.executeSendMessage(
      "/open/claw/send_message",
      receiverId,
      {
        receiver_id: receiverId,
        content: buildTextContent(content),
        msg_type: msgType,
        is_delegate: true,
      },
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }

  async sendBotGroupMessage(
    chatId: string,
    content: string | object,
    msgType: TypeXMessageEnum = TypeXMessageEnum.text,
    options: Pick<TypeXSendOptions, "replyMsgId" | "atUserIds" | "atMentions"> = {},
  ) {
    const mentionIds = Array.isArray(options.atUserIds) && options.atUserIds.length > 0 ? options.atUserIds : undefined;
    const mentionEntries = Array.isArray(options.atMentions) && options.atMentions.length > 0 ? options.atMentions : undefined;
    const normalizedMsgType =
      msgType === TypeXMessageEnum.text || msgType === TypeXMessageEnum.richText
        ? TypeXMessageEnum.text
        : msgType;
    const normalizedContent =
      normalizedMsgType === TypeXMessageEnum.text
        ? {
          text:
            mentionEntries && mentionEntries.length > 0
              ? buildMentionRichText(typeof content === "string" ? content : JSON.stringify(content), mentionEntries)
              : typeof content === "string"
                ? content
                : JSON.stringify(content),
          at_user_ids: mentionIds,
        }
        : typeof content === "object" && content !== null
          ? {
            ...content,
            at_user_ids: mentionIds,
          }
          : content;

    return this.executeSendMessage(
      "/open/robot/send_message",
      chatId,
      {
        chat_id: chatId,
        content: normalizedContent,
        msg_type: normalizedMsgType,
        reply_msg_id: options.replyMsgId || "0",
      },
      typeof content === "string" ? content : JSON.stringify(content),
    );
  }

  /**
   * Compatibility wrapper. Prefer the explicit methods above for new call sites.
   */
  async sendMessage(
    to: string,
    content: string | object,
    msgType: TypeXMessageEnum = TypeXMessageEnum.text,
    options: TypeXSendOptions = {},
  ) {
    if (this.mode === "bot") {
      return this.sendBotGroupMessage(to, content, msgType, {
        replyMsgId: options.replyMsgId,
        atUserIds: options.atUserIds,
        atMentions: options.atMentions,
      });
    }

    if (options.isDelegate && options.receiverId) {
      return this.sendDelegatedContactMessage(options.receiverId, content, msgType);
    }

    if (options.isDelegate) {
      return this.sendDelegatedChatMessage(to, content, msgType);
    }

    return this.sendUserChatMessage(to, content, msgType);
  }

  async searchFeedsByName(name: string): Promise<TypeXFeedSearchEntry[]> {
    if (!name.trim()) return [];
    return this.postJson<TypeXFeedSearchEntry[]>("/open/claw/feeds_by_name", { name });
  }

  async searchContactsByName(name: string): Promise<TypeXContactSearchEntry[]> {
    if (!name.trim()) return [];
    return this.postJson<TypeXContactSearchEntry[]>("/open/claw/contacts_by_name", { name });
  }

  async listGroupMembers(chatId: string): Promise<TypeXGroupMemberEntry[]> {
    if (!chatId.trim() || this.mode !== "bot") return [];
    return this.postJson<TypeXGroupMemberEntry[]>("/open/robot/group_members", { chatid: chatId });
  }

  /**
   * Upload resource for the robot to send.
   * @param fileName Name of the file
   * @param fileType "image" | "audio" | "video" | "application"
   * @param fileContent Buffer or Blob containing the file data
   * @param chatId Optional chat_id
   */
  async uploadResource(
    fileName: string,
    fileType: "image" | "audio" | "video" | "application",
    fileContent: Buffer | Blob,
    chatId?: string
  ) {
    if (this.mode !== "bot" || !this.accessToken) {
      throw new Error("TypeXClient: uploadResource requires bot mode and an access token.");
    }

    const formData = new FormData();
    if (chatId) formData.append("chat_id", chatId);
    formData.append("file_name", fileName);
    formData.append("file_type", fileType);

    // Node.js fetch implementation of FormData requires a Blob-like object for files.
    // By providing a Blob we ensure it correctly adds boundaries and content types per form part.
    const blob = fileContent instanceof Buffer ? new Blob([fileContent as unknown as BlobPart]) : fileContent;
    formData.append("file_content", blob as Blob, fileName);

    const response = await fetch(`${TYPEX_DOMAIN}/open/robot/upload`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        // Note: fetch will automatically set the Content-Type boundary
      },
      body: formData,
    });

    const resJson = await response.json();
    if (resJson.code !== 0) {
      throw new Error(`Upload resource failed: [${resJson.code}] ${resJson.msg || resJson.message}`);
    }
    return resJson.data;
  }

  async uploadUserResource(
    fileName: string,
    fileType: "image" | "audio" | "video" | "application",
    fileContent: Buffer | Blob,
    chatId: string,
  ) {
    if (this.mode !== "user" || !this.accessToken) {
      throw new Error("TypeXClient: uploadUserResource requires user mode and a session token.");
    }

    const formData = new FormData();
    formData.append("chat_id", chatId);
    formData.append("file_name", fileName);
    formData.append("file_type", fileType);

    const blob = fileContent instanceof Buffer ? new Blob([fileContent as unknown as BlobPart]) : fileContent;
    formData.append("file_content", blob as Blob, fileName);

    const response = await fetch(`${TYPEX_DOMAIN}/open/upload`, {
      method: "POST",
      headers: {
        Cookie: this.accessToken,
      },
      body: formData,
    });

    const bodyText = await response.text();
    let resJson: { code?: number; msg?: string; message?: string; data?: any };
    try {
      resJson = JSON.parse(bodyText);
    } catch {
      if (isSessionAuthFailure(response.status, bodyText)) {
        throw new Error("TypeX 用户登录态已失效，请在 OpenClaw 中重新扫码登录 TypeX user 账号后再试。");
      }
      throw new Error(`Upload user resource failed (invalid JSON): ${summarizeInvalidResponse(response.status, bodyText)}`);
    }

    if (!response.ok || resJson.code !== 0) {
      if (isSessionAuthFailure(response.status, bodyText, resJson)) {
        throw new Error("TypeX 用户登录态已失效，请在 OpenClaw 中重新扫码登录 TypeX user 账号后再试。");
      }
      throw new Error(`Upload user resource failed: [${resJson.code ?? response.status}] ${resJson.msg || resJson.message || "unknown error"}`);
    }

    return resJson.data;
  }

  /**
   * Fetch messages. Dispatches to user or bot endpoint based on mode.
   */
  async fetchMessages(pos: number): Promise<TypeXMessageEntry[]> {
    return this.mode === "bot"
      ? this.fetchBotMessages()
      : this.fetchUserMessages(pos);
  }

  /** Pull messages for a regular user account (sessionid cookie auth). */
  private async fetchUserMessages(pos: number): Promise<TypeXMessageEntry[]> {
    if (!this.accessToken) return [];
    const response = await fetch(`${TYPEX_DOMAIN}/open/claw/message`, {
      method: "POST",
      headers: { Cookie: this.accessToken, "Content-Type": "application/json" },
      body: JSON.stringify({ pos }),
    });

    const bodyText = await response.text();
    let resJson: { code?: number; msg?: string; message?: string; data?: TypeXMessageEntry[] };
    try {
      resJson = JSON.parse(bodyText);
    } catch {
      throw new Error(
        `TypeX user poll returned non-JSON response: ${summarizeInvalidResponse(response.status, bodyText)}`,
      );
    }

    if (!response.ok || resJson.code !== 0) {
      throw new Error(
        `TypeX user poll failed: HTTP ${response.status} - ${resJson.msg || resJson.message || "unknown error"}`,
      );
    }

    return Array.isArray(resJson.data) ? resJson.data : [];
  }

  /**
   * Pull messages for a bot account (Bearer token auth).
   */
  private async fetchBotMessages(): Promise<TypeXMessageEntry[]> {
    if (!this.accessToken) return [];
    const response = await fetch(`${TYPEX_DOMAIN}/open/robot/message/pull`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({ limit: 5 }),
    });

    const bodyText = await response.text();
    let resJson: { code?: number; msg?: string; message?: string; data?: { messages?: TypeXMessageEntry[] } };
    try {
      resJson = JSON.parse(bodyText);
    } catch {
      throw new Error(
        `TypeX bot poll returned non-JSON response: ${summarizeInvalidResponse(response.status, bodyText)}`,
      );
    }

    if (!response.ok || resJson.code !== 0) {
      throw new Error(
        `TypeX bot poll failed: HTTP ${response.status} - ${resJson.msg || resJson.message || "unknown error"}`,
      );
    }

    return Array.isArray(resJson.data?.messages) ? resJson.data.messages : [];
  }

  /**
   * Fetch a single message by ID (used to resolve quoted/parent messages).
   */
  async getMessage(messageId: string): Promise<TypeXMessageEntry | null> {
    if (!this.accessToken) return null;
    try {
      const isBot = this.mode === "bot";
      const response = await fetch(`${TYPEX_DOMAIN}/open/claw/message/${messageId}`, {
        method: "GET",
        headers: isBot
          ? { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" }
          : { Cookie: this.accessToken, "Content-Type": "application/json" },
      });
      const resJson = await response.json();
      return resJson.code === 0 && resJson.data ? resJson.data : null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch file binary stream from TypeX using object_key.
   * Requires Bot Token authentication.
   */
  async fetchFileBuffer(objectKey: string, size?: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
    if (!this.accessToken) return null;
    try {
      const query = new URLSearchParams({ object_key: objectKey });
      if (size) query.append("size", size);
      const isBot = this.mode === "bot";
      const url = isBot
        ? `${TYPEX_DOMAIN}/open/robot/chat/file?${query.toString()}`
        : `${TYPEX_DOMAIN}/open/file?${query.toString()}`;

      const response = await fetch(url, {
        method: "GET",
        headers: this.getAuthHeaders(),
      });

      if (!response.ok) {
        console.warn(`fetchFileBuffer failed with status: ${response.status} ${response.statusText} for url: ${url}`);
        return null;
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const mimeType = response.headers.get("content-type") ?? "application/octet-stream";

      return { buffer, mimeType };
    } catch (e) {
      console.error(`fetchFileBuffer error: ${e}`);
      return null;
    }
  }

  /**
   * Search feeds by name (User mode)
   */
  async fetchFeedsByName(name: string): Promise<Array<{ id: string; name: string }>> {
    if (!this.accessToken || this.mode !== "user") return [];
    try {
      const response = await fetch(`${TYPEX_DOMAIN}/open/claw/feeds_by_name`, {
        method: "POST",
        headers: { Cookie: this.accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const resJson = await response.json();
      if (resJson.code !== 0) return [];
      return Array.isArray(resJson.data) ? resJson.data : [];
    } catch (e) {
      console.error(`fetchFeedsByName error: ${e}`);
      return [];
    }
  }

  /**
   * Search contacts by name (User mode)
   */
  async fetchContactsByName(name: string): Promise<Array<{ id: string; name: string; alias?: string }>> {
    if (!this.accessToken || this.mode !== "user") return [];
    try {
      const response = await fetch(`${TYPEX_DOMAIN}/open/claw/contacts_by_name`, {
        method: "POST",
        headers: { Cookie: this.accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const resJson = await response.json();
      if (resJson.code !== 0) return [];
      return Array.isArray(resJson.data) ? resJson.data : [];
    } catch (e) {
      console.error(`fetchContactsByName error: ${e}`);
      return [];
    }
  }

  /**
   * Search group members by name (Bot mode)
   */
  async fetchGroupMembersByName(name: string): Promise<Array<{ id: string; name: string; group_alias?: string }>> {
    if (!this.accessToken || this.mode !== "bot") return [];
    try {
      const response = await fetch(`${TYPEX_DOMAIN}/open/claw/group_members`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const resJson = await response.json();
      if (resJson.code !== 0) return [];
      return Array.isArray(resJson.data) ? resJson.data : [];
    } catch (e) {
      console.error(`fetchGroupMembersByName error: ${e}`);
      return [];
    }
  }
}

export function getTypeXClient(accountId?: string, manualOptions?: TypeXClientOptions) {
  const typexCfg = (manualOptions?.typexCfg ?? {}) as Record<string, any>;
  if (manualOptions?.prompter) prompter = manualOptions.prompter;

  let token = manualOptions?.token;
  let mode: "user" | "bot" = manualOptions?.mode ?? "user";

  if (accountId && typexCfg.accounts?.[accountId]) {
    const acctCfg = typexCfg.accounts[accountId] as Record<string, unknown>;
    token = token ?? (acctCfg.token as string | undefined);
    if (acctCfg.mode === "bot" || acctCfg.mode === "user") mode = acctCfg.mode;
  }

  // Config check: outbound sends should fail only when we truly lack credentials.
  // Historically this was a stub that always threw, which broke outbound delivery.
  if (!manualOptions?.skipConfigCheck) {
    if (!token?.trim()) {
      throw new Error(
        "TypeX not configured: missing token. Run the TypeX onboarding (QR login / bot token) or set channels.openclaw-extension-typex.accounts.<accountId>.token",
      );
    }
  }

  return new TypeXClient({ token, mode });
}
