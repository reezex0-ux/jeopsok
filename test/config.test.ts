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

  it("allows OAuth without a static bearer token", () => {
    const config = loadConfig({
      MCP_OAUTH_ENABLED: "true",
      MCP_OAUTH_APPROVAL_KEY: "approval-secret",
      MCP_PUBLIC_URL: "https://mcp.example.com",
    }, "/tmp");
    expect(config).toMatchObject({
      oauthEnabled: true,
      oauthIssuerUrl: "https://mcp.example.com/",
      oauthResourceUrl: "https://mcp.example.com/mcp",
    });
  });

  it("keeps CodeAct configurable without weakening the workspace default", () => {
    const workspace = loadConfig({ MCP_AUTH_TOKEN: "x" }, "/tmp");
    expect(workspace).toMatchObject({ accessProfile: "workspace", codeActEnabled: true });
    const full = loadConfig({ MCP_AUTH_TOKEN: "x", JEOPSOK_PROFILE: "full" }, "/tmp");
    expect(full).toMatchObject({ accessProfile: "full", codeActEnabled: true });
  });

  it("allows no-auth only on loopback", () => {
    const config = loadConfig({ MCP_ALLOW_NO_AUTH: "true", MCP_HOST: "127.0.0.1" }, "/tmp");
    expect(config).toMatchObject({ allowNoAuth: true, host: "127.0.0.1", port: 3000, endpoint: "/mcp" });

    expect(() => loadConfig({
      MCP_ALLOW_NO_AUTH: "true",
      MCP_HOST: "0.0.0.0",
      JEOPSOK_PROFILE: "full",
    }, "/tmp")).toThrow(/loopback MCP_HOST/);
  });

  it("allows trust proxy only behind a loopback listener", () => {
    expect(loadConfig({
      MCP_AUTH_TOKEN: "x",
      MCP_HOST: "127.0.0.1",
      MCP_TRUST_PROXY_HOPS: "1",
    }, "/tmp").trustProxyHops).toBe(1);

    expect(() => loadConfig({
      MCP_AUTH_TOKEN: "x",
      MCP_HOST: "0.0.0.0",
      MCP_TRUST_PROXY_HOPS: "1",
    }, "/tmp")).toThrow(/requires a loopback MCP_HOST/);
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
