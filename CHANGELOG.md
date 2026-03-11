# Changelog

All notable changes to this project will be documented in this file.

## [1.0.17] - 2026-03-11

> **⚠️ Pre-release Notice**: Due to limitations in the OpenClaw plugin development workflow, the published package cannot be tested in a production environment prior to release. All testing was done locally. After release, a round of online testing will be performed manually. **Do not update until an official announcement is posted.**

### New Features

- **Dual-channel login**: Supports both `user` and `bot` account types simultaneously.
- **Group chat bot**: OpenClaw bot can now participate in group chats (non-E2E groups only — end-to-end encrypted groups are not supported).
- **Image recognition**: The bot is now able to read and analyze image content sent in messages. When an image is received, the bot downloads it to local disk and passes it to the AI for analysis.
  > ⚠️ The current pipeline is: `image URL in message → download & save locally → AI reads local file → reply`
  > Local cached files will accumulate over time and **must be cleared manually** when disk space is a concern.
  > Currently supported in **bot (group chat)** mode only; single-chat (DM) support is planned for a future release.
- **Outbound image sending**: The bot can now send image messages in reply (e.g., responding with a generated or retrieved image).

### Improved

- **Message position storage migration**: The `pos` storage location for TypeX user accounts has been moved from the old path to a private directory within the OpenClaw runtime environment (e.g., `~/.openclaw/typex/update-pos-<accountId>.json`). This eliminates the issue where writing to the old path could cause `openclaw.json` change detection and trigger a gateway restart. Automatic migration from the old storage location is included — no manual steps required.

---

## [1.0.15] - 2026-02-27


### Fixed

- **Message position is no longer lost on restart**: Previously, the message position was stored in `/tmp`, which the OS routinely clears. After a restart, the monitor would start from position 0 and re-process old messages. Position is now persisted directly in `openclaw.json` under your account config, so it survives restarts and system reboots.
- **Position is saved after every message, not at the end of a batch**: If an error occurred while processing a batch of messages, the entire batch's progress was lost and all messages would be re-delivered on the next poll. Now, position is saved immediately after each message is successfully processed, so only the failed message (and anything after it) will be retried.

### Migration

If you're upgrading from an earlier version, your existing position data will be automatically migrated to `openclaw.json` on first startup — no manual steps required. Old state files in `/tmp` will be cleaned up after migration.

---

## [1.0.14] - 2026-02-26


### Changed

- **Per-account pos storage**: State files are now stored under `baseDir/<accountId>/.typex_pos.json` instead of `baseDir/.typex_pos_<safeId>.json`, giving each account its own isolated directory.
- **Automatic legacy pos migration**: On startup, if no state file is found at the new path, the monitor automatically reads and migrates the pos from the legacy path to avoid replaying historical messages from position 0 after an upgrade.
- **Unified message type**: All `sendMessageTypeX` calls (text and media) now explicitly pass `TypeXMessageEnum.richText` to ensure consistent message formatting.
- **Improved error messages**.


