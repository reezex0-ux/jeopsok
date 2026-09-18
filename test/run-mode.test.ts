import { describe, expect, it } from "vitest";

import { resolveRunMode } from "../src/run-mode.js";

describe("resolveRunMode", () => {
  it("forces unattended when runtime scheduling signals conflict with an interactive hint", () => {
    expect(resolveRunMode("interactive", { label: "nightly cron" })).toMatchObject({
      mode: "unattended",
      source: "label",
    });
    expect(resolveRunMode("interactive", { requestMeta: { "openai/automation": { scheduled: true } } })).toMatchObject({
      mode: "unattended",
      source: "request_meta",
    });
    expect(resolveRunMode("unattended", { label: "live chat" })).toMatchObject({
      mode: "unattended",
      source: "explicit",
    });
  });

  it("detects automation from request metadata, environment, and labels in auto mode", () => {
    expect(resolveRunMode("auto", { requestMeta: { "openai/automation": { scheduled: true } } })).toMatchObject({
      mode: "unattended",
      source: "request_meta",
      requestMetaKeys: ["openai/automation"],
    });
    expect(resolveRunMode("auto", { env: { MCP_RUN_MODE: "unattended" } })).toMatchObject({
      mode: "unattended",
      source: "environment",
    });
    expect(resolveRunMode("auto", { label: "morning-briefing scheduled" })).toMatchObject({
      mode: "unattended",
      source: "label",
    });
  });

  it("defaults auto mode to interactive when no unattended signal exists", () => {
    expect(resolveRunMode("auto", { label: "debug session" , env: {} })).toMatchObject({
      mode: "interactive",
      source: "default",
    });
  });
});
