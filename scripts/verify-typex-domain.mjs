#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const filePath = path.resolve("src/client/domain.ts");
const source = fs.readFileSync(filePath, "utf8");
const match = source.match(/ACTIVE_TYPEX_DOMAIN_TARGET:\s*TypeXDomainTarget\s*=\s*"([^"]+)"/);
const currentTarget = match?.[1];

if (!currentTarget) {
  console.error("verify-typex-domain: could not determine ACTIVE_TYPEX_DOMAIN_TARGET.");
  process.exit(1);
}

if (currentTarget !== "prod") {
  console.error(
    `verify-typex-domain: refusing to publish/push while ACTIVE_TYPEX_DOMAIN_TARGET="${currentTarget}". Switch it to "prod" first.`,
  );
  process.exit(1);
}

console.log("verify-typex-domain: ACTIVE_TYPEX_DOMAIN_TARGET is prod.");
