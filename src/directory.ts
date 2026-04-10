import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import { getTypeXClient } from "./client/client.js";

type DirectoryEntry = {
  kind: "user" | "group" | "channel";
  id: string;
  name?: string;
  raw?: unknown;
};

function normalizeQuery(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function normalizeNameKey(value: string | undefined): string {
  return normalizeQuery(value).replace(/\s+/g, "");
}

function resolveClient(accountId: string | null | undefined, cfg: any) {
  const typexCfg = (cfg.channels?.["openclaw-extension-typex"] ?? {}) as Record<string, unknown>;
  const client = getTypeXClient(accountId ?? undefined, { typexCfg });
  return { client, typexCfg };
}

export const typexDirectory = {
  self: async () => null,
  listPeers: async ({ cfg, accountId, query, limit }: any) => {
    const { client, typexCfg } = resolveClient(accountId, cfg);
    const resolvedAccountId = accountId ?? DEFAULT_ACCOUNT_ID;
    const account = (typexCfg.accounts as Record<string, any> | undefined)?.[resolvedAccountId];
    const allowFrom = account?.allowFrom ?? (typexCfg.allowFrom as Array<string | number> | undefined) ?? [];
    const q = normalizeQuery(query);
    const max = limit && limit > 0 ? limit : undefined;
    const configPeers: DirectoryEntry[] = Array.from(
      new Set<string>(
        allowFrom
          .map((entry: string | number) => String(entry).trim())
          .filter((entry: string) => entry && entry !== "*")
          .map((entry: string) => entry.replace(/^typex:/i, "")),
      ),
    )
      .filter((id: string) => (!q ? true : id.toLowerCase().includes(q)))
      .map((id: string) => ({ kind: "user", id: `user:${id}`, name: id }));

    if (!q) return configPeers.slice(0, max);

    try {
      if (client.mode === "bot") return configPeers.slice(0, max);

      const [feeds, contacts] = await Promise.all([
        client.fetchFeedsByName(q),
        client.fetchContactsByName(q),
      ]);

      const contactEntries: DirectoryEntry[] = contacts.map((contact: any) => ({
        kind: "user" as const,
        id: `user:${contact.friend_id ?? contact.id}`,
        name: String(contact.name ?? contact.alias ?? contact.friend_id ?? contact.id),
        raw: contact,
      }));

      const seenContactNames = new Set(contactEntries.map((entry) => normalizeNameKey(entry.name)));
      const feedEntries: DirectoryEntry[] = feeds
        .filter((feed: any) => {
          const feedName = normalizeNameKey(feed.name ?? "");
          return feed.chat_id && (!feedName || !seenContactNames.has(feedName));
        })
        .map((feed: any) => ({
          kind: "user" as const,
          id: `chat:${feed.chat_id}`,
          name: String(feed.name ?? feed.chat_id),
          raw: feed,
        }));

      const all: DirectoryEntry[] = [...configPeers, ...contactEntries, ...feedEntries];
      const unique = Array.from(new Map(all.map((entry) => [entry.id, entry])).values());
      return unique.slice(0, max);
    } catch (error) {
      console.error("Failed to fetch peers from TypeX directory", error);
      return configPeers.slice(0, max);
    }
  },
  listGroups: async ({ cfg, accountId, query, limit }: any) => {
    const { client } = resolveClient(accountId, cfg);
    const q = normalizeQuery(query);
    const max = limit && limit > 0 ? limit : undefined;
    if (!q || client.mode !== "user") return [];

    try {
      const feeds = await client.fetchFeedsByName(q);
      const groups = feeds
        .filter((feed: any) => Boolean(feed.chat_id))
        .map((feed: any) => ({
          kind: "group" as const,
          id: `chat:${feed.chat_id}`,
          name: String(feed.name ?? feed.chat_id),
          raw: feed,
        }))
        .slice(0, max);
      return groups;
    } catch (error) {
      console.error("Failed to fetch groups from TypeX directory", error);
      return [];
    }
  },
  listPeersLive: async (params: any) => typexDirectory.listPeers(params),
  listGroupsLive: async (params: any) => typexDirectory.listGroups(params),
};
