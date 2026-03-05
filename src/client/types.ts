import { OpenClawConfig, WizardPrompter } from "openclaw/plugin-sdk";

export enum TypeXMessageEnum {
  text = 0,
  richText = 8,
}

export type TypeXMessage = {
  msg_type: TypeXMessageEnum;
  content: string;
};

export interface TypeXClientOptions {
  token?: string;
  mode?: "user" | "bot";
  skipConfigCheck?: boolean;
  typexCfg?: Record<string, unknown>;
  prompter?: WizardPrompter;
}

/** A mention entry inside a TypeX message (group messages only). */
export interface TypeXMention {
  /** Internal mention key, e.g. "@_user_1". */
  key: string;
  id: {
    open_id?: string;
    user_id?: string;
  };
  name: string;
}

/** A single message entry returned by the TypeX polling API. */
export interface TypeXMessageEntry {
  message_id: string;
  chat_id: string;
  /** "p2p" for direct messages, "group" for group chats. */
  chat_type?: "p2p" | "group";
  sender_id: string;
  sender_name?: string;
  msg_type: TypeXMessageEnum | string;
  content: {
    text?: string;
    file_name?: string;
    file_key?: string;
    image_key?: string;
    card?: unknown;
    items?: Array<{
      message_id?: string;
      msg_type?: string;
      content?: { text?: string };
      sender?: { id?: string; name?: string };
      create_time?: number;
    }>;
  };
  /** Parent message ID when the user replied/quoted another message. */
  parent_id?: string;
  /** Root message ID of the thread. */
  root_id?: string;
  /** @mentions in the message (group messages only). */
  mentions?: TypeXMention[];
  create_time: number;
  /** Monotonic position cursor used by the polling loop. */
  position: number;
}
