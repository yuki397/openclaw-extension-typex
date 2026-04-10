import { defineChannelPluginEntry } from "openclaw/plugin-sdk/channel-core";
import { typexPlugin } from "./plugin.js";
import { normalizeTypeXTarget } from "./normalize.js";
import { setTypeXRuntime } from "./client/runtime.js";

const plugin = {
  ...typexPlugin,
  messaging: {
    normalizeTarget: normalizeTypeXTarget,
    targetResolver: typexPlugin.messaging.targetResolver,
  },
};

export default defineChannelPluginEntry({
  id: plugin.id,
  name: plugin.meta.label,
  description: plugin.meta.blurb,
  plugin,
  setRuntime: setTypeXRuntime,
});
