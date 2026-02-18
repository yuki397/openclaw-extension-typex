# @openclaw/typex

TypeX channel plugin for OpenClaw.

This plugin is modeled after the Feishu channel plugin in `extensions/feishu/`, so you can
use that implementation as a reference when wiring up the real TypeX provider.

## Install (local checkout)

```bash
openclaw plugins install ./extensions/typex
```

## Install (npm)

```bash
openclaw plugins install @openclaw/typex
```

Onboarding: select TypeX and confirm the install prompt to fetch the plugin automatically.

## Config

```json5
{
  channels: {
    typex: {
      accounts: {
        default: {
          appId: "app_xxx",
          appSecret: "xxx",
          enabled: true,
        },
      },
      dmPolicy: "pairing",
      groupPolicy: "open",
      blockStreaming: true,
    },
  },
}
```

Once the actual TypeX provider is implemented in the core `openclaw` repo, you can extend
this plugin to wire outbound messaging and gateway/runtime logic, mirroring the Feishu
implementation.

## Docs

https://docs.openclaw.ai/channels/typex
