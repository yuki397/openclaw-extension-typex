/**
 * Global runtime reference for the TypeX plugin.
 */

import type { PluginRuntime } from "openclaw/plugin-sdk";

let runtime: any = null;

export function setTypeXRuntime(next: any): void {
  runtime = next;
}

export function getTypeXRuntime(): any {
  if (!runtime) {
    throw new Error("TypeX runtime not initialized");
  }
  return runtime;
}