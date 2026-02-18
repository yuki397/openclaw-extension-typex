import { typexPlugin } from "./plugin.js";
import { normalizeTypeXTarget } from "./normalize.js";
import { OpenClawPluginApi } from "openclaw/plugin-sdk";
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
  register(api: OpenClawPluginApi) {
    setTypeXRuntime(api.runtime);
    api.registerChannel(typexPlugin);
  },
};

export = plugin;