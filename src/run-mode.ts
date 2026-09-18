export const requestedRunModes = ["auto", "interactive", "unattended"] as const;

export type RequestedRunMode = (typeof requestedRunModes)[number];
export type RunMode = Exclude<RequestedRunMode, "auto">;

export interface RunModeResolution {
  mode: RunMode;
  source: "explicit" | "environment" | "default";
  requestMetaKeys: string[];
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
  const envMode = (options.env ?? process.env).MCP_RUN_MODE?.trim().toLowerCase();

  // Only server-owned configuration may remove interactive execution budgets.
  if (envMode === "unattended") {
    return { mode: "unattended", source: "environment", requestMetaKeys };
  }
  if (envMode === "interactive") {
    return { mode: "interactive", source: "environment", requestMetaKeys };
  }

  if (requested === "unattended") {
    throw new Error(
      "runMode=unattended requires server-owned MCP_RUN_MODE=unattended; client labels and request metadata cannot elevate execution mode",
    );
  }
  if (requested === "interactive") {
    return { mode: "interactive", source: "explicit", requestMetaKeys };
  }

  return { mode: "interactive", source: "default", requestMetaKeys };
}
