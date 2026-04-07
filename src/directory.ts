import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/account-id";
import { getTypeXClient } from "./client/client.js";

export const typexDirectory = {
  self: async () => null,
  listPeers: async ({ cfg, accountId, query, limit }: any) => {
    const typexCfg = (cfg.channels?.['openclaw-extension-typex'] ?? {}) as any;
    const account = typexCfg.accounts?.[accountId ?? DEFAULT_ACCOUNT_ID];
    const allowFrom = account?.allowFrom ?? typexCfg.allowFrom ?? [];
    const q = query?.trim().toLowerCase() || "";
    
    const configPeers = Array.from(
      new Set<string>(
        allowFrom
          .map((entry: any) => String(entry).trim())
          .filter((entry: string) => Boolean(entry) && entry !== "*")
          .map((entry: string) => entry.replace(/^typex:/i, ""))
      )
    )
      .filter((id: string) => (q ? id.toLowerCase().includes(q) : true))
      .map((id: string) => ({ kind: "user", id } as const));

    if (!q) {
      return configPeers.slice(0, limit && limit > 0 ? limit : undefined);
    }

    try {
      const client = getTypeXClient(accountId ?? undefined, { typexCfg });
      
      let apiResults: Array<{ id: string }> = [];
      if (client.mode === "user") {
        apiResults = await client.fetchContactsByName(q);
      } else if (client.mode === "bot") {
        apiResults = await client.fetchGroupMembersByName(q);
      }

      const apiPeers = apiResults.map((p: any) => ({ 
        kind: "user", 
        id: p.id, 
        name: p.name || p.alias 
      } as const));
      
      const all = [...configPeers, ...apiPeers];
      const unique = Array.from(new Map(all.map(item => [item.id, item])).values());
      
      return unique.slice(0, limit && limit > 0 ? limit : undefined);
    } catch (e) {
      console.error("Failed to fetch peers from API", e);
      return configPeers.slice(0, limit && limit > 0 ? limit : undefined);
    }
  },
  listGroups: async ({ cfg, accountId, query, limit }: any) => {
    const typexCfg = (cfg.channels?.['openclaw-extension-typex'] ?? {}) as any;
    const q = query?.trim().toLowerCase() || "";
    if (!q) return [];
    
    try {
      const client = getTypeXClient(accountId ?? undefined, { typexCfg });
      
      if (client.mode === "user") {
        const feeds = await client.fetchFeedsByName(q);
        return feeds
          .map((f: any) => ({ kind: "group", id: f.id, name: f.name } as const))
          .slice(0, limit && limit > 0 ? limit : undefined);
      }
      return [];
    } catch (e) {
      console.error("Failed to fetch groups from API", e);
      return [];
    }
  },
};
