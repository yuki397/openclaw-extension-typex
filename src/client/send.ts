import type { TypeXClient } from "./client.js";
import { TypeXMessageEnum } from "./types.js";

export type TypeXSendOpts = {
  msgType?: TypeXMessageEnum;
  mediaUrl?: string;
  maxBytes?: number;
};

/**
 * Send a message via the TypeX client to a specific chat.
 * @param client  TypeX client instance
 * @param chatId  Destination chat_id (group or DM)
 * @param content Message text or content object
 * @param opts    Additional send options
 */
export async function sendMessageTypeX(
  client: TypeXClient,
  chatId: string,
  content: string | { text?: string },
  opts: TypeXSendOpts = {},
) {
  const msgType = opts.msgType ?? TypeXMessageEnum.text;
  const res = await client.sendMessage(chatId, content, msgType);
  return res;
}
