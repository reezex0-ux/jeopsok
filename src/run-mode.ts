export const requestedRunModes = ["auto", "interactive", "unattended"] as const;

export type RequestedRunMode = (typeof requestedRunModes)[number];
export type RunMode = Exclude<RequestedRunMode, "auto">;

export interface RunModeResolution {
  mode: RunMode;
  source: "explicit" | "request_meta" | "environment" | "label" | "default";
  requestMetaKeys: string[];
}

const unattendedPattern = /(?:^|[\s_./:-])(automation|automated|scheduled|schedule|scheduler|cron|unattended|nightly|예약|자동화|무인)(?:$|[\s_./:-])/i;

function flattenMeta(value: unknown, out: string[], depth = 0): void {
  if (depth > 3 || out.join(" ").length > 4000) return;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    out.push(String(value));
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value.slice(0, 20)) flattenMeta(item, out, depth + 1);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 40)) {
      out.push(key);
      flattenMeta(item, out, depth + 1);
    }
  }
}

export function safeRequestMetaKeys(meta: unknown): string[] {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return [];
  return Object.keys(meta as Record<string, unknown>).slice(0, 40).sort();
}

export function resolveRunMode(
  requested: RequestedRunMode,
  options: {
    label?: string | undefined;
    requestMeta?: unknown;
    env?: NodeJS.ProcessEnv;
  } = {},
): RunModeResolution {
  const requestMetaKeys = safeRequestMetaKeys(options.requestMeta);

  // Runtime-owned unattended signals win over a caller-provided interactive
  // hint so scheduled work cannot accidentally inherit the live-turn budget.
  const metaParts: string[] = [];
  flattenMeta(options.requestMeta, metaParts);
  if (unattendedPattern.test(` ${metaParts.join(" ")} `)) {
    return { mode: "unattended", source: "request_meta", requestMetaKeys };
  }

  const envMode = (options.env ?? process.env).MCP_RUN_MODE?.trim().toLowerCase();
  if (envMode === "unattended") {
    return { mode: "unattended", source: "environment", requestMetaKeys };
  }

  if (options.label && unattendedPattern.test(` ${options.label} `)) {
    return { mode: "unattended", source: "label", requestMetaKeys };
  }

  if (requested === "interactive" || requested === "unattended") {
    return { mode: requested, source: "explicit", requestMetaKeys };
  }

  if (envMode === "interactive") {
    return { mode: "interactive", source: "environment", requestMetaKeys };
  }

  return { mode: "interactive", source: "default", requestMetaKeys };
}
