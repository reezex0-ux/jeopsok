import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { createServices } from "../src/mcp-server.js";

describe("CodeAct profile boundary", () => {
  it("does not create a CodeAct manager for workspace", () => {
    const config = loadConfig({ MCP_AUTH_TOKEN: "x", JEOPSOK_PROFILE: "workspace" }, "/tmp");
    const services = createServices(config);
    expect(services.codeActManager).toBeUndefined();
  });

  it("creates a CodeAct manager only for full when enabled", async () => {
    const config = loadConfig({ MCP_AUTH_TOKEN: "x", JEOPSOK_PROFILE: "full" }, "/tmp");
    const services = createServices(config);
    expect(services.codeActManager).toBeDefined();
    await services.codeActManager?.shutdown();
  });

  it("honors MCP_CODEACT_ENABLED=false in full", () => {
    const config = loadConfig({
      MCP_AUTH_TOKEN: "x",
      JEOPSOK_PROFILE: "full",
      MCP_CODEACT_ENABLED: "false",
    }, "/tmp");
    const services = createServices(config);
    expect(services.codeActManager).toBeUndefined();
  });
});
