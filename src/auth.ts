import { timingSafeEqual } from "node:crypto";

import type { RequestHandler, Request } from "express";
import type { AuthInfo } from "@modelcontextprotocol/server";
import { createRemoteJWKSet, jwtVerify } from "jose";

import type { AppConfig } from "./config.js";

export interface AccessTokenVerifier {
  verifyAccessToken(token: string): Promise<AuthInfo>;
}

export function tokensEqual(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export function oauthResourceMetadataUrl(config: AppConfig): string {
  const resource = new URL(config.oauthResourceUrl!);
  const suffix = resource.pathname === "/" ? "" : resource.pathname;
  return new URL(`/.well-known/oauth-protected-resource${suffix}`, resource).href;
}

function tokenScopes(payload: Record<string, unknown>): string[] {
  const scope = payload.scope;
  if (typeof scope === "string") {
    return scope.split(/\s+/).map((value) => value.trim()).filter(Boolean);
  }
  const scp = payload.scp;
  if (Array.isArray(scp) && scp.every((value) => typeof value === "string")) {
    return [...new Set(scp as string[])];
  }
  if (typeof scp === "string") {
    return scp.split(/\s+/).map((value) => value.trim()).filter(Boolean);
  }
  return [];
}

export function createOAuthTokenVerifier(config: AppConfig): AccessTokenVerifier | undefined {
  if (!config.oauthEnabled) return undefined;
  if (
    !config.oauthIssuerUrl ||
    !config.oauthResourceUrl ||
    !config.oauthJwksUrl ||
    !config.oauthAudience
  ) {
    throw new Error("OAuth resource-server configuration is incomplete");
  }

  const issuer = config.oauthIssuerUrl;
  const resource = new URL(config.oauthResourceUrl);
  const jwks = createRemoteJWKSet(new URL(config.oauthJwksUrl));
  const audience = config.oauthAudience;

  return {
    async verifyAccessToken(token: string): Promise<AuthInfo> {
      const { payload } = await jwtVerify(token, jwks, {
        issuer,
        audience,
      });
      if (typeof payload.exp !== "number") {
        throw new Error("OAuth access token must contain exp");
      }

      const claims = payload as Record<string, unknown>;
      const clientIdCandidate = claims.client_id ?? claims.azp ?? claims.sub;
      if (typeof clientIdCandidate !== "string" || !clientIdCandidate) {
        throw new Error("OAuth access token must identify a client");
      }

      return {
        token,
        clientId: clientIdCandidate,
        scopes: tokenScopes(claims),
        expiresAt: payload.exp,
        resource,
      };
    },
  };
}

function setRequestAuth(request: Request, authInfo: AuthInfo): void {
  (request as Request & { auth?: AuthInfo }).auth = authInfo;
}

export function createBearerAuth(
  config: AppConfig,
  oauthVerifier?: AccessTokenVerifier,
): RequestHandler {
  return async (request, response, next) => {
    if (config.allowNoAuth && !config.authToken && !oauthVerifier) {
      next();
      return;
    }

    const authorization = request.header("authorization");
    const match = authorization?.match(/^Bearer\s+(.+)$/i);
    const suppliedToken = match?.[1];

    if (suppliedToken && config.authToken && tokensEqual(suppliedToken, config.authToken)) {
      next();
      return;
    }

    if (suppliedToken && oauthVerifier && config.oauthResourceUrl) {
      try {
        const authInfo = await oauthVerifier.verifyAccessToken(suppliedToken);
        const missingScopes = config.oauthRequiredScopes.filter(
          (scope) => !authInfo.scopes.includes(scope),
        );
        if (missingScopes.length > 0) {
          response
            .status(403)
            .set(
              "WWW-Authenticate",
              `Bearer realm="jeopsok", error="insufficient_scope", scope="${config.oauthRequiredScopes.join(" ")}", resource_metadata="${oauthResourceMetadataUrl(config)}"`,
            )
            .json({
              jsonrpc: "2.0",
              error: { code: -32003, message: "Insufficient OAuth scope" },
              id: null,
            });
          return;
        }
        setRequestAuth(request, authInfo);
        next();
        return;
      } catch {
        // Use one stable challenge for malformed, expired, or unverifiable tokens.
      }
    }

    const challenge = config.oauthEnabled
      ? `Bearer realm="jeopsok", error="invalid_token", scope="${config.oauthRequiredScopes.join(" ")}", resource_metadata="${oauthResourceMetadataUrl(config)}"`
      : 'Bearer realm="jeopsok"';

    response.status(401).set("WWW-Authenticate", challenge).json({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Unauthorized" },
      id: null,
    });
  };
}

export function createHostValidation(config: AppConfig): RequestHandler {
  return (request, response, next) => {
    if (!config.allowedHosts?.length) {
      next();
      return;
    }
    const rawHost = request.header("host");
    let hostname = "";
    try {
      hostname = new URL(`http://${rawHost ?? ""}`).hostname.toLowerCase();
    } catch {
      // Invalid or empty host is rejected below.
    }
    if (!config.allowedHosts.includes(hostname)) {
      response.status(403).json({
        jsonrpc: "2.0",
        error: { code: -32002, message: "Host header is not allowed" },
        id: null,
      });
      return;
    }
    next();
  };
}
