import { WizardPrompter } from "openclaw/plugin-sdk";
import { TypeXMessageEnum, type TypeXClientOptions, type TypeXMessageEntry } from "./types.js";

const TYPEX_DOMAIN = "https://api-coco.typex.im";
// const TYPEX_DOMAIN = "https://api-tx.bossjob.net.cn";

let prompter: WizardPrompter | undefined;

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

  /**
   * Send a message to a specific chat (group or DM).
   * @param to  chat_id to send to
   * @param content  message text or object
   */
  async sendMessage(to: string, content: string | object, msgType: TypeXMessageEnum = 0) {
    const token = this.accessToken;
    if (!token) throw new Error("TypeXClient: Not authenticated.");

    let finalContent = content;
    if (typeof content === "object") {
      try { finalContent = JSON.stringify(content); } catch { finalContent = String(content as unknown); }
    }

    if (prompter) prompter.note(`TypeXClient sending to ${to}: ${String(finalContent).slice(0, 80)}`);
    else console.log(`TypeXClient sending to ${to}: ${String(finalContent).slice(0, 80)}`);

    const isBot = this.mode === "bot";
    const response = await fetch(`${TYPEX_DOMAIN}/open/claw/send_message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(isBot ? { Authorization: `Bearer ${token}` } : { Cookie: token }),
      },
      body: JSON.stringify({
        chat_id: to,
        content: { text: finalContent },
        msg_type: msgType,
      }),
    });
    const resJson = await response.json();
    if (resJson.code !== 0) {
      throw new Error(`Send message failed: [${resJson.code}] ${resJson.message}`);
    }
    return resJson.data || { message_id: `msg_${Date.now()}` };
  }

  /**
   * Fetch messages. Dispatches to user or bot endpoint based on mode.
   */
  async fetchMessages(pos: number): Promise<TypeXMessageEntry[]> {
    console.log('mode: ', this.mode);
    return this.mode === "bot"
      ? this.fetchBotMessages(pos)
      : this.fetchUserMessages(pos);
  }

  /** Pull messages for a regular user account (sessionid cookie auth). */
  private async fetchUserMessages(pos: number): Promise<TypeXMessageEntry[]> {
    if (!this.accessToken) return [];
    try {
      const response = await fetch(`${TYPEX_DOMAIN}/open/claw/message`, {
        method: "POST",
        headers: { Cookie: this.accessToken, "Content-Type": "application/json" },
        body: JSON.stringify({ pos }),
      });
      const resJson = await response.json();
      if (resJson.code !== 0) return [];
      return Array.isArray(resJson.data) ? resJson.data : [];
    } catch (e) {
      console.log(`Fetch messages error: ${e}`);
      return [];
    }
  }

  /**
   * Pull messages for a bot account (Bearer token auth).
   * TODO: replace /open/bot/message with the actual endpoint path once confirmed.
   */
  private async fetchBotMessages(pos: number): Promise<TypeXMessageEntry[]> {
    if (!this.accessToken) return [];
    try {
      const response = await fetch(`${TYPEX_DOMAIN}/open/bot/message`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pos }),
      });
      const resJson = await response.json();
      if (resJson.code !== 0) return [];
      return Array.isArray(resJson.data) ? resJson.data : [];
    } catch (e) {
      console.log(`Bot fetch messages error: ${e}`);
      return [];
    }
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

  if (!manualOptions?.skipConfigCheck) {
    throw new Error("TypeX not configured yet.");
  }

  return new TypeXClient({ token, mode });
}
