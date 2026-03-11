import type { TypeXClient } from "./client.js";
import { TypeXMessageEnum } from "./types.js";

export type TypeXSendOpts = {
  msgType?: TypeXMessageEnum;
  mediaUrl?: string;
  maxBytes?: number;
  replyMsgId?: string;
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
  content: string | { text?: string; object_url?: string; file_name?: string; file_size?: number; file_type?: string; width?: number; height?: number },
  opts: TypeXSendOpts = {},
) {
  let msgType = opts.msgType ?? TypeXMessageEnum.text;
  let finalContent: any = content;

  if (opts.mediaUrl) {
    const isBot = client.mode === "bot";
    // Infer file type from extension
    const urlLower = opts.mediaUrl.toLowerCase();
    const isImage = urlLower.match(/\.(jpeg|jpg|gif|png|webp|bmp)$/) != null;
    const isVideo = urlLower.match(/\.(mp4|mov|avi|wmv|flv|mkv)$/) != null;
    const isAudio = urlLower.match(/\.(mp3|wav|ogg|m4a)$/) != null;

    // Choose appropriate message type
    msgType = isImage ? TypeXMessageEnum.image :
      isVideo ? TypeXMessageEnum.video :
        TypeXMessageEnum.file;

    if (isBot) {
      // 1. Download the media
      try {
        const fetchRes = await fetch(opts.mediaUrl);
        if (!fetchRes.ok) throw new Error(`Failed to fetch media: ${fetchRes.statusText}`);
        const arrayBuffer = await fetchRes.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const mimeType = fetchRes.headers.get("content-type") || "application/octet-stream";
        const fileName = opts.mediaUrl.split("/").pop() || "file.bin";

        let typexFileType: "image" | "audio" | "video" | "application" = "application";
        if (isImage) typexFileType = "image";
        else if (isVideo) typexFileType = "video";
        else if (isAudio) typexFileType = "audio";

        // 2. Upload to TypeX
        const uploadRes = await client.uploadResource(fileName, typexFileType, buffer, chatId);
        const objectKey = uploadRes.objectKey;

        // 3. Construct payload format according to new API
        if (isImage) {
          finalContent = {
            object_url: uploadRes.address || opts.mediaUrl,
            width: uploadRes.width || 800,
            height: uploadRes.height || 600,
            image_id: objectKey
          };
        } else {
          finalContent = {
            object_url: uploadRes.address || opts.mediaUrl,
            file_name: fileName,
            file_size: buffer.length,
            file_type: mimeType,
            file_id: objectKey
          };
          msgType = TypeXMessageEnum.file; // Force file to be safe
        }
      } catch (err) {
        console.error(`Failed to upload/send media URL: ${opts.mediaUrl}`, err);
        // Fallback to text message with the URL
        msgType = TypeXMessageEnum.text;
        finalContent = opts.mediaUrl;
      }
    } else {
      // For normal users, maybe we just send the URL directly or TypeX supports URL payloads
      // (assuming original flow handles it or sends as text)
      msgType = TypeXMessageEnum.text;
      finalContent = opts.mediaUrl;
    }
  }

  const res = await client.sendMessage(chatId, finalContent, msgType, { replyMsgId: opts.replyMsgId });
  return res;
}
