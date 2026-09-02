import { describe, expect, it } from "vitest";
import { defaultShellForPlatform, loadConfig } from "../src/config.js";

describe("config", () => {
  it("requires an authentication posture by default", () => {
    expect(() => loadConfig({}, "/tmp")).toThrow(/MCP_AUTH_TOKEN is required/);
  });

  it("defaults to workspace profile rooted at MCP_DEFAULT_CWD", () => {
    const config = loadConfig({ MCP_AUTH_TOKEN: "x", MCP_DEFAULT_CWD: "/tmp" }, "/tmp");
    expect(config.accessProfile).toBe("workspace");
    expect(config.allowedRoots).toEqual([expect.any(String)]);
    expect(config.allowedRoots[0]).toBe(config.defaultCwd);
  });

  it("allows readonly and full profiles", () => {
    expect(loadConfig({ MCP_AUTH_TOKEN: "x", JEOPSOK_PROFILE: "readonly" }, "/tmp").accessProfile).toBe("readonly");
    const full = loadConfig({ MCP_AUTH_TOKEN: "x", JEOPSOK_PROFILE: "full" }, "/tmp");
    expect(full).toMatchObject({ accessProfile: "full", allowedRoots: [] });
  });

  it("requires an explicit command allowlist for operator", () => {
    expect(() => loadConfig({ MCP_AUTH_TOKEN: "x", JEOPSOK_PROFILE: "operator" }, "/tmp"))
      .toThrow(/JEOPSOK_ALLOWED_COMMANDS/);
    const operator = loadConfig({
      MCP_AUTH_TOKEN: "x",
      JEOPSOK_PROFILE: "operator",
      JEOPSOK_ALLOWED_COMMANDS: "git,npm",
      JEOPSOK_ALLOWED_ENV: "CI,NODE_ENV",
    }, "/tmp");
    expect(operator).toMatchObject({ accessProfile: "operator", allowedCommands: ["git", "npm"], allowedEnv: ["CI", "NODE_ENV"] });
  });

  it("allows a trusted local tunnel configuration", () => {
    const config = loadConfig({ MCP_ALLOW_NO_AUTH: "true", MCP_HOST: "127.0.0.1" }, "/tmp");
    expect(config).toMatchObject({ allowNoAuth: true, host: "127.0.0.1", port: 3000, endpoint: "/mcp" });
  });

  it("normalizes endpoints and numeric limits", () => {
    const config = loadConfig({ MCP_AUTH_TOKEN: "x", MCP_ENDPOINT: "/agent/", MCP_PORT: "3456", MCP_MAX_PROCESSES: "9" }, "/tmp");
    expect(config).toMatchObject({ endpoint: "/agent", port: 3456, maxProcesses: 9 });
  });

  it("chooses platform-appropriate shells", () => {
    expect(defaultShellForPlatform({}, "win32")).toBe("powershell.exe");
    expect(defaultShellForPlatform({ SHELL: "/bin/zsh" }, "linux")).toBe("/bin/zsh");
  });
});
