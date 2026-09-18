import { mkdtemp, readFile, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadConfig } from "../src/config.js";
import { startHttpServer, type RunningHttpServer } from "../src/http-server.js";
import { createServices } from "../src/mcp-server.js";

const roots: string[] = [];
const servers: RunningHttpServer[] = [];

afterEach(async () => {
  await Promise.allSettled(servers.splice(0).map((server) => server.close()));
  await Promise.allSettled(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function register(baseUrl: string, clientName: string, xff?: string): Promise<Response> {
  return fetch(`${baseUrl}/register`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(xff ? { "x-forwarded-for": xff } : {}),
    },
    body: JSON.stringify({
      redirect_uris: ["https://chatgpt.com/connector/oauth/test-callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code"],
      response_types: ["code"],
      client_name: clientName,
      scope: "mcp:tools",
    }),
  });
}

describe("OAuth security regressions", () => {
  it("does not let rotating X-Forwarded-For values bypass the OAuth limiter", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jeopsok-oauth-rate-"));
    roots.push(root);
    const config = loadConfig({
      MCP_OAUTH_ENABLED: "true",
      MCP_OAUTH_APPROVAL_KEY: "approval-secret",
      MCP_PUBLIC_URL: "http://127.0.0.1:3000",
      MCP_HOST: "127.0.0.1",
      MCP_TRUST_PROXY_HOPS: "1",
      MCP_OAUTH_RATE_LIMIT_MAX_REQUESTS: "2",
      MCP_OAUTH_RATE_LIMIT_WINDOW_MS: "60000",
      MCP_OAUTH_STATE_FILE: path.join(root, "state.json"),
      MCP_DEFAULT_CWD: root,
    }, root);
    config.port = 0;
    const running = await startHttpServer(config, createServices(config));
    servers.push(running);
    const address = running.httpServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    expect((await register(baseUrl, "one", "198.51.100.1")).status).toBe(201);
    expect((await register(baseUrl, "two", "198.51.100.2")).status).toBe(201);
    const blocked = await register(baseUrl, "three", "198.51.100.3");
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toMatchObject({ error: "too_many_requests" });
  });

  it("keeps dynamically registered OAuth clients bounded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "jeopsok-oauth-cap-"));
    roots.push(root);
    const stateFile = path.join(root, "state.json");
    const config = loadConfig({
      MCP_OAUTH_ENABLED: "true",
      MCP_OAUTH_APPROVAL_KEY: "approval-secret",
      MCP_PUBLIC_URL: "http://127.0.0.1:3000",
      MCP_HOST: "127.0.0.1",
      MCP_OAUTH_MAX_CLIENTS: "2",
      MCP_OAUTH_RATE_LIMIT_MAX_REQUESTS: "10",
      MCP_OAUTH_STATE_FILE: stateFile,
      MCP_DEFAULT_CWD: root,
    }, root);
    config.port = 0;
    const running = await startHttpServer(config, createServices(config));
    servers.push(running);
    const address = running.httpServer.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    expect((await register(baseUrl, "one")).status).toBe(201);
    expect((await register(baseUrl, "two")).status).toBe(201);
    expect((await register(baseUrl, "three")).status).toBe(201);

    const persisted = JSON.parse(await readFile(stateFile, "utf8")) as {
      clients: Record<string, unknown>;
    };
    expect(Object.keys(persisted.clients)).toHaveLength(2);
  });
});
