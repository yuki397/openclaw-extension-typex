# Changelog

All notable changes to this project will be documented in this file.

## [1.0.14] - 2026-02-26

### Changed

- **Per-account pos storage**: State files are now stored under `baseDir/<accountId>/.typex_pos.json` instead of `baseDir/.typex_pos_<safeId>.json`, giving each account its own isolated directory.
- **Automatic legacy pos migration**: On startup, if no state file is found at the new path, the monitor automatically reads and migrates the pos from the legacy path to avoid replaying historical messages from position 0 after an upgrade.
- **Unified message type**: All `sendMessageTypeX` calls (text and media) now explicitly pass `TypeXMessageEnum.richText` to ensure consistent message formatting.
- **Improved error messages**.
