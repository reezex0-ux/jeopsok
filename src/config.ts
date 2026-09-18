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
  oauthIssuerUrl: string | undefined;
  oauthResourceUrl: string | undefined;
  oauthJwksUrl: string | undefined;
  oauthAudience: string | undefined;
  oauthRequiredScopes: string[];
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

export function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "localhost";
}

export function assertSafeHttpConfig(
  config: Pick<AppConfig, "host" | "trustProxyHops" | "allowNoAuth" | "authToken" | "oauthEnabled">,
): void {
  if (config.allowNoAuth && !config.authToken && !config.oauthEnabled && !isLoopbackHost(config.host)) {
    throw new Error(
      "MCP_ALLOW_NO_AUTH=true is allowed only with a loopback MCP_HOST. Bind to 127.0.0.1/::1/localhost behind the trusted upstream, or enable bearer/OAuth authentication.",
    );
  }
  if (config.trustProxyHops > 0 && !isLoopbackHost(config.host)) {
    throw new Error(
      "MCP_TRUST_PROXY_HOPS>0 requires a loopback MCP_HOST so clients cannot bypass the trusted reverse proxy and spoof forwarded addresses.",
    );
  }
}

function normalizeEndpoint(value: string | undefined): string {
  const endpoint = value?.trim() || "/mcp";
  if (!endpoint.startsWith("/")) throw new Error("MCP_ENDPOINT must start with '/'");
  return endpoint.length > 1 ? endpoint.replace(/\/+$/, "") : endpoint;
}

function normalizeSecureUrl(value: string | undefined, name: string, required: boolean): string | undefined {
  if (!value) {
    if (required) throw new Error(`${name} is required when MCP_OAUTH_ENABLED=true`);
    return undefined;
  }
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
  if (url.hash) throw new Error(`${name} must not contain a fragment`);
  return url.href;
}

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  processCwd = process.cwd(),
): AppConfig {
  const host = env.MCP_HOST?.trim() || "0.0.0.0";
  const trustProxyHops = parseInteger(env.MCP_TRUST_PROXY_HOPS, 0, "MCP_TRUST_PROXY_HOPS", 0, 16);
  const allowNoAuth = parseBoolean(env.MCP_ALLOW_NO_AUTH, false);
  const authToken = env.MCP_AUTH_TOKEN?.trim() || undefined;
  const oauthEnabled = parseBoolean(env.MCP_OAUTH_ENABLED, false);

  if (!allowNoAuth && !authToken && !oauthEnabled) {
    throw new Error(
      "MCP_AUTH_TOKEN is required unless OAuth is enabled. Set MCP_ALLOW_NO_AUTH=true only behind a trusted local tunnel or authentication gateway.",
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
    ? normalizeSecureUrl(env.MCP_OAUTH_ISSUER?.trim(), "MCP_OAUTH_ISSUER", true)
    : undefined;
  const oauthResourceUrl = oauthEnabled
    ? normalizeSecureUrl(
        env.MCP_OAUTH_RESOURCE?.trim() || (publicUrl ? `${publicUrl}${endpoint}` : undefined),
        "MCP_OAUTH_RESOURCE",
        true,
      )
    : undefined;
  const oauthJwksUrl = oauthEnabled
    ? normalizeSecureUrl(env.MCP_OAUTH_JWKS_URL?.trim(), "MCP_OAUTH_JWKS_URL", true)
    : undefined;
  const oauthAudience = oauthEnabled
    ? (env.MCP_OAUTH_AUDIENCE?.trim() || oauthResourceUrl)
    : undefined;
  const oauthRequiredScopes = oauthEnabled
    ? (parseList(env.MCP_OAUTH_REQUIRED_SCOPES).length > 0
        ? parseList(env.MCP_OAUTH_REQUIRED_SCOPES)
        : ["mcp:tools"])
    : [];

  const allowedHosts = parseList(env.MCP_ALLOWED_HOSTS).map((value) => value.toLowerCase());
  return {
    host,
    port: parseInteger(env.MCP_PORT, 3000, "MCP_PORT", 1, 65_535),
    endpoint,
    publicUrl,
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
    trustProxyHops,
    authToken,
    allowNoAuth,
    oauthEnabled,
    oauthIssuerUrl,
    oauthResourceUrl,
    oauthJwksUrl,
    oauthAudience,
    oauthRequiredScopes,
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
