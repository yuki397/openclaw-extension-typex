# Changelog

All notable changes to this project will be documented in this file.

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
