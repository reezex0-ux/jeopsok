import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig, type AppConfig } from "../src/config.js";
import { startHttpServer, type RunningHttpServer } from "../src/http-server.js";
import { createServices, type McpServices } from "../src/mcp-server.js";

const PUBLIC_TOOLS = [
  "exec_command", "write_stdin", "read_process", "terminate_process", "list_processes",
  "list_directory", "stat_path", "read_file", "write_file", "replace_in_file",
  "upload_file", "download_file", "remove_path",
] as const;

describe("Jeopsok MCP server", () => {
  let temporaryDirectory: string;
  let config: AppConfig;
  let services: McpServices;
  let running: RunningHttpServer;
  let endpoint: URL;

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "jeopsok-http-test-"));
    config = loadConfig({ MCP_AUTH_TOKEN: "integration-secret", MCP_HOST: "127.0.0.1", MCP_DEFAULT_CWD: temporaryDirectory }, temporaryDirectory);
    config.port = 0;
    services = createServices(config);
    running = await startHttpServer(config, services);
    const address = running.httpServer.address() as AddressInfo;
    endpoint = new URL(`http://127.0.0.1:${address.port}${config.endpoint}`);
  });

  afterAll(async () => {
    await running.close();
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  it("serves MCP 2026-07-28 with exactly 13 public tools", async () => {
    const client = new Client({ name: "modern-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: "Bearer integration-secret" } } });
    await client.connect(transport);
    try {
      expect(transport.sessionId).toBeUndefined();
      expect(client.getServerVersion()).toMatchObject({ name: "jeopsok", version: "0.1.0" });
      const list = await client.listTools();
      expect(list.tools.map(t => t.name).sort()).toEqual([...PUBLIC_TOOLS].sort());
    } finally { await client.close(); }
  });

  it("keeps process state across independent stateless requests", async () => {
    const client = new Client({ name: "state-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: "Bearer integration-secret" } } });
    await client.connect(transport);
    try {
      const started = await client.callTool({ name: "exec_command", arguments: { cmd: "node -e \"setTimeout(() => console.log('state-ok'), 120)\"", yieldTimeMs: 0 } });
      const state = (started.structuredContent ?? {}) as Record<string, unknown>;
      const sessionId = String(state.sessionId);
      expect(state).toMatchObject({ running: true, completed: false });
      let read = await client.callTool({ name: "read_process", arguments: { sessionId, waitMs: 3000 } });
      let body = (read.structuredContent ?? {}) as Record<string, unknown>;
      let output = String(body.stdout ?? "");
      if (body.running === true) {
        read = await client.callTool({ name: "read_process", arguments: { sessionId, afterSeq: body.nextSeq, waitMs: 3000 } });
        body = (read.structuredContent ?? {}) as Record<string, unknown>;
        output += String(body.stdout ?? "");
      }
      expect(output).toContain("state-ok");
      expect(body).toMatchObject({ running: false, completed: true, exitCode: 0 });
    } finally { await client.close(); }
  });

  it("keeps a stateless legacy fallback for 2025-era clients", async () => {
    const client = new Client({ name: "legacy-test", version: "1" });
    const transport = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: "Bearer integration-secret" } } });
    await client.connect(transport);
    try {
      expect(transport.sessionId).toBeUndefined();
      expect((await client.listTools()).tools.some(t => t.name === "exec_command")).toBe(true);
    } finally { await client.close(); }
  });

  it("reports modern stateless health", async () => {
    const health = await fetch(new URL("/health", endpoint));
    expect(await health.json()).toMatchObject({ service: "jeopsok", version: "0.1.0", transportMode: "mcp-2026-stateless", protocolRevision: "2026-07-28", activeMcpSessions: 0 });
  });
});
