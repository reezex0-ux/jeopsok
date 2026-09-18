import { describe, expect, it } from "vitest";

import { resolveRunMode } from "../src/run-mode.js";

describe("resolveRunMode", () => {
  it("does not trust labels or request metadata to remove interactive budgets", () => {
    expect(resolveRunMode("auto", { label: "nightly cron", env: {} })).toMatchObject({
      mode: "interactive",
      source: "default",
    });
    expect(resolveRunMode("auto", {
      requestMeta: { "openai/automation": { scheduled: true } },
      env: {},
    })).toMatchObject({
      mode: "interactive",
      source: "default",
      requestMetaKeys: ["openai/automation"],
    });
  });

  it("allows only server-owned environment configuration to enable unattended mode", () => {
    expect(resolveRunMode("interactive", { env: { MCP_RUN_MODE: "unattended" } })).toMatchObject({
      mode: "unattended",
      source: "environment",
    });
    expect(resolveRunMode("auto", { env: { MCP_RUN_MODE: "unattended" } })).toMatchObject({
      mode: "unattended",
      source: "environment",
    });
  });

  it("rejects a client-requested unattended mode without trusted server configuration", () => {
    expect(() => resolveRunMode("unattended", { label: "cron job", env: {} }))
      .toThrow(/server-owned MCP_RUN_MODE=unattended/);
  });

  it("defaults auto mode to interactive", () => {
    expect(resolveRunMode("auto", { label: "debug session", env: {} })).toMatchObject({
      mode: "interactive",
      source: "default",
    });
  });
});
