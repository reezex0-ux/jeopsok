import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";

import { createMcpHandler } from "@modelcontextprotocol/server";
import {
  createOAuthMetadata,
  mcpAuthRouter,
  type AuthRouterOptions,
} from "@modelcontextprotocol/server-legacy/auth";
import { toNodeHandler } from "@modelcontextprotocol/node";
import express, { type Request, type Response } from "express";

import { createBearerAuth, createHostValidation } from "./auth.js";
import type { AppConfig } from "./config.js";
import { errorMessage } from "./errors.js";
import { createMcpServer, type McpServices } from "./mcp-server.js";
import { JeopsokOAuthProvider, OAUTH_SCOPES } from "./oauth.js";

export interface RunningHttpServer {
  httpServer: HttpServer;
  close: () => Promise<void>;
}

function rpcMethod(request: Request): string | undefined {
  const header = request.header("mcp-method");
  if (header) return header;
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const method = (body as { method?: unknown }).method;
  return typeof method === "string" ? method : undefined;
}

function rpcToolName(request: Request): string | undefined {
  const header = request.header("mcp-name");
  if (header) return header;
  const body = request.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
  const params = (body as { params?: unknown }).params;
  if (!params || typeof params !== "object" || Array.isArray(params)) return undefined;
  const name = (params as { name?: unknown }).name;
  return typeof name === "string" ? name : undefined;
}

export async function startHttpServer(
  config: AppConfig,
  services: McpServices,
): Promise<RunningHttpServer> {
  const app = express();
  app.disable("x-powered-by");
  if (config.trustProxyHops > 0) app.set("trust proxy", config.trustProxyHops);
  app.use(createHostValidation(config));

  let activeMcpRequests = 0;
  const oauthProvider = config.oauthEnabled ? new JeopsokOAuthProvider(config) : undefined;

  if (oauthProvider) {
    app.get("/.well-known/oauth-protected-resource", (_request, response) => {
      response.set("Access-Control-Allow-Origin", "*").json({
        resource: oauthProvider.resourceUrl.href,
        authorization_servers: [oauthProvider.issuerUrl.href],
        scopes_supported: [...OAUTH_SCOPES],
        bearer_methods_supported: ["header"],
        resource_name: "jeopsok",
      });
    });

    const oauthRouterOptions = {
      provider: oauthProvider,
      issuerUrl: oauthProvider.issuerUrl,
      resourceServerUrl: oauthProvider.resourceUrl,
      scopesSupported: [...OAUTH_SCOPES],
      resourceName: "jeopsok",
    } satisfies AuthRouterOptions;

    const oauthMetadata = {
      ...createOAuthMetadata(oauthRouterOptions),
      revocation_endpoint_auth_methods_supported: ["client_secret_post", "none"],
    };

    const issuerPath = oauthProvider.issuerUrl.pathname.replace(/\/$/, "");
    const oauthMetadataPath = `/.well-known/oauth-authorization-server${issuerPath}`;
    app.use((request, response, next) => {
      if (
        (request.method === "GET" || request.method === "HEAD") &&
        request.path === oauthMetadataPath
      ) {
        response.set("Access-Control-Allow-Origin", "*").json(oauthMetadata);
        return;
      }
      next();
    });

    app.use(mcpAuthRouter(oauthRouterOptions));
  }

  const mcpHandler = createMcpHandler(
    () => createMcpServer(config, services),
    {
      legacy: "stateless",
      onerror: (error) => console.error("MCP handler error:", errorMessage(error)),
    },
  );
  const nodeMcpHandler = toNodeHandler(mcpHandler, {
    onerror: (error) => console.error("MCP Node adapter error:", errorMessage(error)),
  });

  const authenticate = createBearerAuth(config, oauthProvider);
  const parseMcpJson = express.json({ limit: config.maxRequestBody });

  app.get("/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "jeopsok",
      version: "0.3.0",
      transportMode: "mcp-2026-stateless",
      protocolRevision: "2026-07-28",
      legacyStatelessFallback: true,
      activeMcpSessions: 0,
      activeMcpRequests,
      managedProcesses: services.processManager.list().length,
      accessProfile: config.accessProfile,
      filesystemRestricted: services.accessPolicy.filesystemRestricted,
      allowedRootCount: config.allowedRoots.length,
      commandExecutionEnabled: services.accessPolicy.commandExecutionEnabled,
      commandAllowlistMode:
        config.accessProfile === "full"
          ? "unrestricted"
          : config.accessProfile === "operator"
            ? config.allowedCommands.includes("*") ? "unrestricted" : "allowlist"
            : "disabled",
      unrestrictedHostAccess: services.accessPolicy.unrestrictedHostAccess,
      codeActEnabled: services.codeActManager !== undefined,
      codeActSessions: services.codeActManager?.list().length ?? 0,
      oauthEnabled: config.oauthEnabled,
      authentication:
        config.allowNoAuth && !config.authToken && !config.oauthEnabled
          ? "upstream-or-none"
          : config.oauthEnabled
            ? config.authToken ? "bearer+oauth" : "oauth"
            : "bearer",
    });
  });

  app.all(config.endpoint, authenticate, parseMcpJson, async (request, response) => {
    const requestId = randomUUID();
    const startedAt = performance.now();
    activeMcpRequests += 1;
    response.set("X-Request-Id", requestId);

    let logged = false;
    const finish = (outcome: "completed" | "aborted") => {
      if (logged) return;
      logged = true;
      activeMcpRequests = Math.max(0, activeMcpRequests - 1);
      console.log(JSON.stringify({
        event: "mcp_request",
        requestId,
        httpMethod: request.method,
        rpcMethod: rpcMethod(request),
        toolName: rpcToolName(request),
        status: response.statusCode,
        outcome,
        durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
      }));
    };

    response.once("finish", () => finish("completed"));
    response.once("close", () => {
      if (!response.writableEnded) finish("aborted");
    });

    await nodeMcpHandler(request, response, request.body);
  });

  app.use((error: unknown, _request: Request, response: Response, _next: express.NextFunction) => {
    if (!response.headersSent) {
      response.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32000, message: `Invalid request body: ${errorMessage(error)}` },
        id: null,
      });
    }
  });

  const cleanupInterval = setInterval(() => {
    services.processManager.prune();
    services.codeActManager?.prune();
  }, Math.min(config.processRetentionMs, config.codeActSessionRetentionMs, 60_000));
  cleanupInterval.unref();

  const httpServer = await new Promise<HttpServer>((resolve, reject) => {
    const listeningServer = app.listen(config.port, config.host, () => resolve(listeningServer));
    listeningServer.once("error", reject);
  });

  const close = async (): Promise<void> => {
    clearInterval(cleanupInterval);
    await mcpHandler.close();
    await services.processManager.shutdown();
    await services.codeActManager?.shutdown();
    await new Promise<void>((resolve, reject) => {
      httpServer.close((error) => (error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
  };

  return { httpServer, close };
}
