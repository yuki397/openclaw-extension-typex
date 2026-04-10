#!/usr/bin/env node

import fs from "node:fs";

const ALLOWED_TYPES = [
  "feat",
  "fix",
  "chore",
  "docs",
  "refactor",
  "test",
  "perf",
  "ci",
  "build",
  "revert",
  "release",
];

const input = process.argv[2];
const raw = input && fs.existsSync(input) ? fs.readFileSync(input, "utf8") : input ?? "";
const message = raw.trim().split(/\r?\n/)[0] ?? "";

const conventionalCommitPattern = new RegExp(
  `^(?:${ALLOWED_TYPES.join("|")})(?:\\([a-z0-9._/-]+\\))?!?:\\s.{1,72}$|^(?:${ALLOWED_TYPES.join("|")})!?:\\s.{1,72}$`,
  "i",
);

if (!message) {
  console.error("commitlint: missing commit message.");
  process.exit(1);
}

if (!conventionalCommitPattern.test(message)) {
  console.error("commitlint: commit message must follow Conventional Commits.");
  console.error(`Allowed types: ${ALLOWED_TYPES.join(", ")}`);
  console.error('Examples: feat: support delivery by contact name | feat(typex): support delivery by contact name');
  process.exit(1);
}
