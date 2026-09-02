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
  const number = /^[-+]?\d+$/.test(value.trim()) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}

function parseList(value: string | undefined): string[] {
  return value?.split(",").map(item => item.trim()).filter(Boolean) ?? [];
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

export function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  processCwd = process.cwd(),
): AppConfig {
  const allowNoAuth = parseBoolean(env.MCP_ALLOW_NO_AUTH, false);
  const authToken = env.MCP_AUTH_TOKEN?.trim() || undefined;
  if (!allowNoAuth && !authToken) {
    throw new Error(
      "MCP_AUTH_TOKEN is required. Set MCP_ALLOW_NO_AUTH=true only behind a trusted local tunnel or authentication gateway.",
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

  const allowedHosts = parseList(env.MCP_ALLOWED_HOSTS).map(value => value.toLowerCase());
  return {
    host: env.MCP_HOST?.trim() || "0.0.0.0",
    port: parseInteger(env.MCP_PORT, 3000, "MCP_PORT", 1, 65535),
    endpoint: normalizeEndpoint(env.MCP_ENDPOINT),
    publicUrl: env.MCP_PUBLIC_URL?.trim().replace(/\/+$/, "") || undefined,
    allowedHosts: allowedHosts.length > 0 ? allowedHosts : undefined,
    trustProxyHops: parseInteger(env.MCP_TRUST_PROXY_HOPS, 0, "MCP_TRUST_PROXY_HOPS", 0, 16),
    authToken,
    allowNoAuth,
    defaultCwd,
    defaultShell: defaultShellForPlatform(env),
    accessProfile,
    allowedRoots,
    allowedCommands,
    allowedEnv,
    maxRequestBody: env.MCP_MAX_REQUEST_BODY?.trim() || "8mb",
    maxOutputBytes: parseInteger(env.MCP_MAX_OUTPUT_BYTES, 1024 * 1024, "MCP_MAX_OUTPUT_BYTES", 16 * 1024),
    maxRetainedProcessOutputBytes: parseInteger(env.MCP_MAX_RETAINED_PROCESS_OUTPUT_BYTES, 4 * 1024 * 1024, "MCP_MAX_RETAINED_PROCESS_OUTPUT_BYTES", 64 * 1024),
    processRetentionMs: parseInteger(env.MCP_PROCESS_RETENTION_MS, 60 * 60 * 1000, "MCP_PROCESS_RETENTION_MS", 1000),
    maxProcesses: parseInteger(env.MCP_MAX_PROCESSES, 128, "MCP_MAX_PROCESSES", 1),
    maxFileChunkBytes: parseInteger(env.MCP_MAX_FILE_CHUNK_BYTES, 1024 * 1024, "MCP_MAX_FILE_CHUNK_BYTES", 4096),
    maxEditFileBytes: parseInteger(env.MCP_MAX_EDIT_FILE_BYTES, 64 * 1024 * 1024, "MCP_MAX_EDIT_FILE_BYTES", 4096),
  };
}
