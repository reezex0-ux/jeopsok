import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { startHttpServer, type RunningHttpServer } from "../src/http-server.js";
import { createServices } from "../src/mcp-server.js";

const roots: string[] = [];
const servers: RunningHttpServer[] = [];
afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map(server => server.close()));
  await Promise.allSettled(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function setup(env: NodeJS.ProcessEnv): Promise<{ client: Client; root: string }> {
  const root = await mkdtemp(path.join(os.tmpdir(), "jeopsok-profile-")); roots.push(root);
  const config = loadConfig({ MCP_AUTH_TOKEN: "x", MCP_HOST: "127.0.0.1", MCP_DEFAULT_CWD: root, ...env }, root);
  config.port = 0;
  const running = await startHttpServer(config, createServices(config)); servers.push(running);
  const address = running.httpServer.address() as AddressInfo;
  const client = new Client({ name: "profile-test", version: "1" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`), { requestInit: { headers: { Authorization: "Bearer x" } } }));
  return { client, root };
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  return client.callTool({ name, arguments: args });
}

describe("access profiles", () => {
  it("readonly exposes only four non-mutating file tools", async () => {
    const { client, root } = await setup({ JEOPSOK_PROFILE: "readonly" });
    await writeFile(path.join(root, "readme.txt"), "hello");
    try {
      expect((await client.listTools()).tools.map(t => t.name).sort()).toEqual([
        "download_file", "list_directory", "read_file", "stat_path",
      ]);
      expect((await call(client, "read_file", { path: "readme.txt" })).isError).not.toBe(true);
      await expect(call(client, "write_file", { path: "no.txt", content: "x" })).rejects.toThrow(/not found/i);
    } finally { await client.close(); }
  });

  it("workspace blocks absolute and symlink escapes", async () => {
    const { client, root } = await setup({ JEOPSOK_PROFILE: "workspace" });
    const outside = await mkdtemp(path.join(os.tmpdir(), "jeopsok-profile-outside-")); roots.push(outside);
    await writeFile(path.join(outside, "secret.txt"), "secret");
    await symlink(outside, path.join(root, "escape"), "dir");
    try {
      expect((await call(client, "read_file", { path: path.join(outside, "secret.txt") })).isError).toBe(true);
      expect((await call(client, "read_file", { path: "escape/secret.txt" })).isError).toBe(true);
      expect((await call(client, "write_file", { path: "escape/new.txt", content: "blocked" })).isError).toBe(true);
      expect((await call(client, "write_file", { path: "inside.txt", content: "ok" })).isError).not.toBe(true);
    } finally { await client.close(); }
  });

  it("operator exposes process tools but enforces command and environment allowlists", async () => {
    const { client } = await setup({
      JEOPSOK_PROFILE: "operator",
      JEOPSOK_ALLOWED_COMMANDS: "printf,node",
      JEOPSOK_ALLOWED_ENV: "CI",
    });
    try {
      expect((await client.listTools()).tools).toHaveLength(13);
      const allowed = await call(client, "exec_command", { cmd: "printf operator-ok", yieldTimeMs: 3000 });
      expect(allowed.structuredContent).toMatchObject({ stdout: "operator-ok", exitCode: 0 });
      expect((await call(client, "exec_command", { cmd: "uname -a" })).isError).toBe(true);
      expect((await call(client, "exec_command", { cmd: "printf ok; uname" })).isError).toBe(true);
      expect((await call(client, "exec_command", { cmd: "printf ok", env: { PATH: "/tmp" } })).isError).toBe(true);
      expect((await call(client, "exec_command", { cmd: "printf ok", env: { CI: "1" }, yieldTimeMs: 3000 })).isError).not.toBe(true);
    } finally { await client.close(); }
  });

  it("operator wildcard still keeps shell syntax guards", async () => {
    const { client } = await setup({ JEOPSOK_PROFILE: "operator", JEOPSOK_ALLOWED_COMMANDS: "*" });
    try {
      expect((await call(client, "exec_command", { cmd: "printf safe", yieldTimeMs: 3000 })).isError).not.toBe(true);
      expect((await call(client, "exec_command", { cmd: "printf unsafe; uname" })).isError).toBe(true);
    } finally { await client.close(); }
  });

  it("full is explicit unrestricted opt-in", async () => {
    const { client } = await setup({ JEOPSOK_PROFILE: "full" });
    const outside = await mkdtemp(path.join(os.tmpdir(), "jeopsok-full-outside-")); roots.push(outside);
    await writeFile(path.join(outside, "visible.txt"), "full-ok");
    try {
      expect((await client.listTools()).tools).toHaveLength(13);
      const read = await call(client, "read_file", { path: path.join(outside, "visible.txt") });
      expect(read.structuredContent).toMatchObject({ content: "full-ok" });
      expect((await call(client, "exec_command", { cmd: "printf full-ok", yieldTimeMs: 3000 })).isError).not.toBe(true);
    } finally { await client.close(); }
  });
});
