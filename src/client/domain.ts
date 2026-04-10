export const TYPEX_DOMAINS = {
  prod: "https://api-coco.typex.im",
  test: "https://api-tx.typex-test.cn",
} as const;

export type TypeXDomainTarget = keyof typeof TYPEX_DOMAINS;

export const ACTIVE_TYPEX_DOMAIN_TARGET: TypeXDomainTarget = "prod";

export const TYPEX_DOMAIN = TYPEX_DOMAINS[ACTIVE_TYPEX_DOMAIN_TARGET];
