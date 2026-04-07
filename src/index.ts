import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { typexPlugin } from "./plugin.js";
import { normalizeTypeXTarget } from "./normalize.js";
import { setTypeXRuntime } from "./client/runtime.js";

const plugin = {
  ...typexPlugin,
  messaging: {
    normalizeTarget: normalizeTypeXTarget,
    targetResolver: {
      looksLikeId: () => true,
      hint: "chat_id",
    },
  },
};

export default defineChannelPluginEntry({
  id: plugin.id,
  name: plugin.meta.label,
  description: plugin.meta.blurb,
  plugin,
  setRuntime: setTypeXRuntime,
});
