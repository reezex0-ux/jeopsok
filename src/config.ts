import path from "node:path";

import { normalizeAllowedRoots, type AccessProfile } from "./access-policy.js";

export interface AppConfig {
  host: string;
  port: number;
  endpoint: string;
  publicUrl: string | undefined;
  allowedHosts: string[] | undefined;
  trustProxyHops: number;
  authToken: string | undefined;
  allowNoAuth: boolean;
  oauthEnabled: boolean;
  oauthApprovalKey: string | undefined;
  oauthIssuerUrl: string | undefined;
  oauthResourceUrl: string | undefined;
  oauthStateFile: string;
  oauthAccessTokenTtlSeconds: number;
  oauthRefreshTokenTtlSeconds: number;
  oauthAuthorizationCodeTtlSeconds: number;
  defaultCwd: string;
  defaultShell: string;
  accessProfile: AccessProfile;
  allowedRoots: string[];
  allowedCommands: string[];
  allowedEnv: string[];
  maxRequestBody: string;
  maxOutputBytes: number;
  maxRetainedProcessOutputBytes: number;
  processRetentionMs: number;
  maxProcesses: number;
  maxFileChunkBytes: number;
  maxEditFileBytes: number;
  codeActEnabled: boolean;
  codeActPython: string;
  codeActLogFile: string;
  codeActMaxSessions: number;
  codeActSessionRetentionMs: number;
  codeActRunStateDir: string;
  codeActInteractiveMaxActions: number;
  codeActInteractiveMaxExecutionCalls: number;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  if (["1", "true", "yes", "on"].includes(value.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(value.toLowerCase())) return false;
  throw new Error(`Invalid boolean value: ${value}`);
}

function parseInteger(
  value: string | undefined,
  fallback: number,
  name: string,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  if (value === undefined || value === "") return fallback;
  const normalized = value.trim();
  const parsed = /^[+-]?\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    const range = maximum === Number.MAX_SAFE_INTEGER
      ? `greater than or equal to ${minimum}`
      : `between ${minimum} and ${maximum}`;
    throw new Error(`${name} must be an integer ${range}`);
  }
  return parsed;
}

function parseList(value: string | undefined): string[] {
  return value?.split(",").map((item) => item.trim()).filter(Boolean) ?? [];
}

function parseProfile(value: string | undefined): AccessProfile {
  const profile = (value?.trim().toLowerCase() || "workspace") as AccessProfile;
  if (!["readonly", "workspace", "operator", "full"].includes(profile)) {
    throw new Error("JEOPSOK_PROFILE must be readonly, workspace, operator, or full");
  }
  return profile;
}

export function defaultShellForPlatform(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const configured = env.MCP_DEFAULT_SHELL?.trim();
  if (configured) return configured;
  if (platform === "win32") return "powershell.exe";
  return env.SHELL?.trim() || "/bin/bash";
}

function normalizeEndpoint(value: string | undefined): string {
  const endpoint = value?.trim() || "/mcp";
  if (!endpoint.startsWith("/")) throw new Error("MCP_ENDPOINT must start with '/'");
  return endpoint.length > 1 ? endpoint.replace(/\/+$/, "") : endpoint;
}

function normalizeOAuthUrl(value: string | undefined, name: string): string {
  if (!value) throw new Error(`${name} is required when MCP_OAUTH_ENABLED=true`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL`);
  }
  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new Error(`${name} must use HTTPS (HTTP is allowed only for loopback tests)`);
  }
  if (url.username || url.password) throw new Error(`${name} must not contain user credentials`);
  if (url.search || url.hash) throw new Error(`${name} must not contain a query string or fragment`);
  return url.href;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  processCwd = process.cwd(),
): AppConfig {
  const allowNoAuth = parseBoolean(env.MCP_ALLOW_NO_AUTH, false);
  const authToken = env.MCP_AUTH_TOKEN?.trim() || undefined;
  const oauthEnabled = parseBoolean(env.MCP_OAUTH_ENABLED, false);
  const oauthApprovalKey = oauthEnabled
    ? env.MCP_OAUTH_APPROVAL_KEY?.trim() || authToken
    : undefined;

  if (!allowNoAuth && !authToken && !oauthEnabled) {
    throw new Error(
      "MCP_AUTH_TOKEN is required unless OAuth is enabled. Set MCP_ALLOW_NO_AUTH=true only behind a trusted local tunnel or authentication gateway.",
    );
  }
  if (oauthEnabled && !oauthApprovalKey) {
    throw new Error(
      "MCP_OAUTH_APPROVAL_KEY (or MCP_AUTH_TOKEN for backward compatibility) is required when OAuth is enabled",
    );
  }

  const rawDefaultCwd = path.resolve(env.MCP_DEFAULT_CWD?.trim() || processCwd);
  const defaultCwd = normalizeAllowedRoots([rawDefaultCwd], rawDefaultCwd)[0]!;
  const accessProfile = parseProfile(env.JEOPSOK_PROFILE);
  const allowedRoots = accessProfile === "full"
    ? []
    : normalizeAllowedRoots(parseList(env.JEOPSOK_ALLOWED_ROOTS), defaultCwd);
  const allowedCommands = parseList(env.JEOPSOK_ALLOWED_COMMANDS);
  const allowedEnv = parseList(env.JEOPSOK_ALLOWED_ENV);
  if (accessProfile === "operator" && allowedCommands.length === 0) {
    throw new Error("JEOPSOK_ALLOWED_COMMANDS is required in operator profile");
  }

  const endpoint = normalizeEndpoint(env.MCP_ENDPOINT);
  const publicUrl = env.MCP_PUBLIC_URL?.trim().replace(/\/+$/, "") || undefined;
  const oauthIssuerUrl = oauthEnabled
    ? normalizeOAuthUrl(env.MCP_OAUTH_ISSUER?.trim() || publicUrl, "MCP_OAUTH_ISSUER")
    : undefined;
  const oauthResourceUrl = oauthEnabled
    ? normalizeOAuthUrl(
        env.MCP_OAUTH_RESOURCE?.trim() || (publicUrl ? `${publicUrl}${endpoint}` : undefined),
        "MCP_OAUTH_RESOURCE",
      )
    : undefined;

  const allowedHosts = parseList(env.MCP_ALLOWED_HOSTS).map((value) => value.toLowerCase());
  return {
    host: env.MCP_HOST?.trim() || "0.0.0.0",
    port: parseInteger(env.MCP_PORT, 3000, "MCP_PORT", 1, 65_535),
    endpoint,
    publicUrl,
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
    trustProxyHops: parseInteger(env.MCP_TRUST_PROXY_HOPS, 0, "MCP_TRUST_PROXY_HOPS", 0, 16),
    authToken,
    allowNoAuth,
    oauthEnabled,
    oauthApprovalKey,
    oauthIssuerUrl,
    oauthResourceUrl,
    oauthStateFile: path.resolve(
      env.MCP_OAUTH_STATE_FILE?.trim() || path.join(processCwd, ".jeopsok-oauth-state.json"),
    ),
    oauthAccessTokenTtlSeconds: parseInteger(
      env.MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS, 60 * 60, "MCP_OAUTH_ACCESS_TOKEN_TTL_SECONDS", 300,
    ),
    oauthRefreshTokenTtlSeconds: parseInteger(
      env.MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS, 30 * 24 * 60 * 60, "MCP_OAUTH_REFRESH_TOKEN_TTL_SECONDS", 3600,
    ),
    oauthAuthorizationCodeTtlSeconds: parseInteger(
      env.MCP_OAUTH_AUTHORIZATION_CODE_TTL_SECONDS, 5 * 60, "MCP_OAUTH_AUTHORIZATION_CODE_TTL_SECONDS", 60,
    ),
    defaultCwd,
    defaultShell: defaultShellForPlatform(env),
    accessProfile,
    allowedRoots,
    allowedCommands,
    allowedEnv,
    maxRequestBody: env.MCP_MAX_REQUEST_BODY?.trim() || "8mb",
    maxOutputBytes: parseInteger(env.MCP_MAX_OUTPUT_BYTES, 1024 * 1024, "MCP_MAX_OUTPUT_BYTES", 16 * 1024),
    maxRetainedProcessOutputBytes: parseInteger(
      env.MCP_MAX_RETAINED_PROCESS_OUTPUT_BYTES, 4 * 1024 * 1024, "MCP_MAX_RETAINED_PROCESS_OUTPUT_BYTES", 64 * 1024,
    ),
    processRetentionMs: parseInteger(env.MCP_PROCESS_RETENTION_MS, 60 * 60 * 1000, "MCP_PROCESS_RETENTION_MS", 1000),
    maxProcesses: parseInteger(env.MCP_MAX_PROCESSES, 128, "MCP_MAX_PROCESSES", 1),
    maxFileChunkBytes: parseInteger(env.MCP_MAX_FILE_CHUNK_BYTES, 1024 * 1024, "MCP_MAX_FILE_CHUNK_BYTES", 4096),
    maxEditFileBytes: parseInteger(env.MCP_MAX_EDIT_FILE_BYTES, 64 * 1024 * 1024, "MCP_MAX_EDIT_FILE_BYTES", 4096),
    codeActEnabled: parseBoolean(env.MCP_CODEACT_ENABLED, true),
    codeActPython: env.MCP_CODEACT_PYTHON?.trim() || (process.platform === "win32" ? "python" : "python3"),
    codeActLogFile: path.resolve(
      env.MCP_CODEACT_LOG_FILE?.trim() || path.join(defaultCwd, ".jeopsok", "codeact-actions.jsonl"),
    ),
    codeActMaxSessions: parseInteger(env.MCP_CODEACT_MAX_SESSIONS, 8, "MCP_CODEACT_MAX_SESSIONS", 1, 64),
    codeActSessionRetentionMs: parseInteger(
      env.MCP_CODEACT_SESSION_RETENTION_MS, 60 * 60 * 1000, "MCP_CODEACT_SESSION_RETENTION_MS", 60_000,
    ),
    codeActRunStateDir: path.resolve(
      env.MCP_CODEACT_RUN_STATE_DIR?.trim() || path.join(defaultCwd, ".jeopsok", "runs"),
    ),
    codeActInteractiveMaxActions: parseInteger(
      env.MCP_CODEACT_INTERACTIVE_MAX_ACTIONS, 24, "MCP_CODEACT_INTERACTIVE_MAX_ACTIONS", 1, 1000,
    ),
    codeActInteractiveMaxExecutionCalls: parseInteger(
      env.MCP_CODEACT_INTERACTIVE_MAX_EXECUTION_CALLS, 32, "MCP_CODEACT_INTERACTIVE_MAX_EXECUTION_CALLS", 1, 1000,
    ),
  };
}
