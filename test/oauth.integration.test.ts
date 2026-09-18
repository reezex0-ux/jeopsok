import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { createServer as createNetServer } from "node:net";
import os from "node:os";
import path from "node:path";

import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { loadConfig, type AppConfig } from "../src/config.js";
import { startHttpServer, type RunningHttpServer } from "../src/http-server.js";
import { createServices } from "../src/mcp-server.js";

async function reservePort(): Promise<number> {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return port;
}

describe("external OAuth resource-server authorization", () => {
  let temporaryDirectory: string;
  let config: AppConfig;
  let running: RunningHttpServer;
  let jwksServer: HttpServer;
  let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
  let issuer: string;
  let resourceUrl: string;
  let baseUrl: string;

  beforeAll(async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "jeopsok-oauth-rs-test-"));

    const keyPair = await generateKeyPair("RS256");
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = "jeopsok-test-key";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";

    jwksServer = createHttpServer((request, response) => {
      if (request.url === "/jwks") {
        response
          .writeHead(200, { "content-type": "application/json", "cache-control": "no-store" })
          .end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      response.writeHead(404).end();
    });
    await new Promise<void>((resolve, reject) => {
      jwksServer.once("error", reject);
      jwksServer.listen(0, "127.0.0.1", resolve);
    });
    const jwksAddress = jwksServer.address() as AddressInfo;
    issuer = `http://127.0.0.1:${jwksAddress.port}/`;

    const port = await reservePort();
    baseUrl = `http://127.0.0.1:${port}`;
    resourceUrl = `${baseUrl}/mcp`;

    config = loadConfig(
      {
        MCP_OAUTH_ENABLED: "true",
        MCP_OAUTH_ISSUER: issuer,
        MCP_OAUTH_JWKS_URL: `${issuer}jwks`,
        MCP_OAUTH_RESOURCE: resourceUrl,
        MCP_OAUTH_AUDIENCE: resourceUrl,
        MCP_OAUTH_REQUIRED_SCOPES: "mcp:tools",
        MCP_HOST: "127.0.0.1",
        MCP_PORT: String(port),
        MCP_DEFAULT_CWD: temporaryDirectory,
      },
      temporaryDirectory,
    );

    running = await startHttpServer(config, createServices(config));
  });

  afterAll(async () => {
    await running.close();
    await new Promise<void>((resolve, reject) => {
      jwksServer.close((error) => (error ? reject(error) : resolve()));
    });
    await rm(temporaryDirectory, { recursive: true, force: true });
  });

  async function token(options: {
    scope?: string;
    audience?: string;
    issuerValue?: string;
    expiresIn?: string;
  } = {}): Promise<string> {
    return new SignJWT({
      scope: options.scope ?? "mcp:tools",
      client_id: "test-client",
    })
      .setProtectedHeader({ alg: "RS256", kid: "jeopsok-test-key" })
      .setIssuer(options.issuerValue ?? issuer)
      .setAudience(options.audience ?? resourceUrl)
      .setIssuedAt()
      .setExpirationTime(options.expiresIn ?? "5m")
      .sign(privateKey);
  }

  it("publishes protected-resource metadata that points to the external issuer", async () => {
    for (const metadataPath of [
      "/.well-known/oauth-protected-resource",
      "/.well-known/oauth-protected-resource/mcp",
    ]) {
      const response = await fetch(`${baseUrl}${metadataPath}`);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        resource: resourceUrl,
        authorization_servers: [issuer],
        scopes_supported: ["mcp:tools"],
        bearer_methods_supported: ["header"],
        resource_name: "jeopsok",
      });
    }
  });

  it("accepts a valid external JWT and exposes MCP tools", async () => {
    const accessToken = await token();
    const client = new Client(
      { name: "oauth-resource-test", version: "1" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } },
    );
    await client.connect(new StreamableHTTPClientTransport(new URL(resourceUrl), {
      requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
    }));
    try {
      expect((await client.listTools()).tools.some((tool) => tool.name === "read_file")).toBe(true);
    } finally {
      await client.close();
    }
  });

  it("rejects wrong audience or issuer and distinguishes insufficient scope", async () => {
    const wrongAudience = await fetch(resourceUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token({ audience: "https://wrong.example/api" })}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(wrongAudience.status).toBe(401);
    expect(wrongAudience.headers.get("www-authenticate")).toContain("invalid_token");

    const wrongIssuer = await fetch(resourceUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token({ issuerValue: "https://wrong.example/" })}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(wrongIssuer.status).toBe(401);

    const insufficient = await fetch(resourceUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${await token({ scope: "profile:read" })}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    expect(insufficient.status).toBe(403);
    expect(insufficient.headers.get("www-authenticate")).toContain("insufficient_scope");
  });

  it("no longer exposes built-in authorization-server endpoints", async () => {
    for (const endpoint of ["/register", "/authorize", "/token", "/revoke"]) {
      const response = await fetch(`${baseUrl}${endpoint}`, { method: "POST" });
      expect(response.status).toBe(404);
    }
  });
});
