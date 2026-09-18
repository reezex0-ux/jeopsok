import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../src/config.js";
import { startHttpServer, type RunningHttpServer } from "../src/http-server.js";
import { createServices, type McpServices } from "../src/mcp-server.js";

const WORKSPACE_TOOLS = [
  "list_directory", "stat_path", "read_file", "write_file",
  "replace_in_file", "upload_file", "download_file", "remove_path",
] as const;

describe("Jeopsok MCP server", () => {
  let temporaryDirectory: string;
  let outsideDirectory: string;
  let config: AppConfig;
  let services: McpServices;
  let running: RunningHttpServer;
  let endpoint: URL;

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "jeopsok-http-test-"));
    outsideDirectory = await mkdtemp(path.join(os.tmpdir(), "jeopsok-outside-test-"));
    config = loadConfig({ MCP_AUTH_TOKEN: "integration-secret", MCP_HOST: "127.0.0.1", MCP_DEFAULT_CWD: temporaryDirectory }, temporaryDirectory);
    config.port = 0;
    services = createServices(config);
    running = await startHttpServer(config, services);
    const address = running.httpServer.address() as AddressInfo;
    endpoint = new URL(`http://127.0.0.1:${address.port}${config.endpoint}`);
  });

  afterAll(async () => {
    await running.close();
    await Promise.all([temporaryDirectory, outsideDirectory].map(root => rm(root, { recursive: true, force: true })));
  });

  async function connect(version: "modern" | "legacy" = "modern"): Promise<Client> {
    const client = new Client(
      { name: `${version}-test`, version: "1" },
      version === "modern" ? { versionNegotiation: { mode: { pin: "2026-07-28" } } } : undefined,
    );
    await client.connect(new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: "Bearer integration-secret" } },
    }));
    return client;
  }

  it("serves MCP 2026-07-28 with safe workspace tools by default", async () => {
    const client = await connect();
    try {
      expect(client.getServerVersion()).toMatchObject({ name: "jeopsok", version: "0.4.0" });
      expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([...WORKSPACE_TOOLS].sort());
      const write = await client.callTool({ name: "write_file", arguments: { path: "inside.txt", content: "ok" } });
      expect(write.isError).not.toBe(true);
      const outside = await client.callTool({ name: "read_file", arguments: { path: path.join(outsideDirectory, "secret.txt") } });
      expect(outside.isError).toBe(true);
    } finally { await client.close(); }
  });

  it("keeps the same restricted surface for the 2025-era stateless fallback", async () => {
    const client = await connect("legacy");
    try {
      expect((await client.listTools()).tools.map(tool => tool.name).sort()).toEqual([...WORKSPACE_TOOLS].sort());
    } finally { await client.close(); }
  });

  it("reports the active permission profile without exposing root paths", async () => {
    const health = await fetch(new URL("/health", endpoint));
    const body = await health.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      service: "jeopsok", version: "0.4.0", transportMode: "mcp-2026-stateless",
      protocolRevision: "2026-07-28", activeMcpSessions: 0,
      accessProfile: "workspace", filesystemRestricted: true,
      allowedRootCount: 1, commandExecutionEnabled: false, unrestrictedHostAccess: false, codeActEnabled: false, oauthEnabled: false,
    });
    expect(JSON.stringify(body)).not.toContain(temporaryDirectory);
  });
});
