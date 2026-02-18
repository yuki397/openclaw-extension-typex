import { typexPlugin } from "./plugin.js";
import { normalizeTypeXTarget } from "./normalize.js";
import { OpenClawPluginApi } from "openclaw/plugin-sdk";

const plugin = {
  ...typexPlugin,
  messaging: {
    normalizeTarget: normalizeTypeXTarget,
    targetResolver: {
      looksLikeId: () => true,
      hint: "chat_id",
    },
  },
  register(api: OpenClawPluginApi) {
    api.registerChannel(typexPlugin);
  },
};

export = plugin;