import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import { CodeActManager } from "./codeact.js";
import { runTool } from "./tool-result.js";
import { requestedRunModes, resolveRunMode } from "./run-mode.js";

const fullAccessAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export function registerCodeActTools(
  server: McpServer,
  manager: CodeActManager,
): void {
  server.registerTool(
    "python_session_create",
    {
      title: "Create persistent Python session",
      description:
        "Create a persistent Python worker for multi-step full-profile host work. auto mode resolves scheduled/automation metadata or labels to unattended; otherwise it is interactive. Interactive sessions enforce configurable action and process-call budgets.",
      inputSchema: z.object({
        cwd: z.string().optional().describe("Initial working directory. Defaults to MCP_DEFAULT_CWD."),
        label: z.string().max(120).optional().describe("Optional human-readable session label."),
        runMode: z.enum(requestedRunModes).optional().default("auto"),
      }),
      annotations: fullAccessAnnotations,
    },
    async ({ cwd, label, runMode }, ctx) =>
      runTool(() =>
        manager.create(
          cwd,
          label,
          resolveRunMode(runMode, { label, requestMeta: ctx.mcpReq._meta }),
        ),
      ),
  );

  server.registerTool(
    "python_action",
    {
      title: "Run Python action",
      description:
        "Execute Python in a persistent full-profile session. Variables persist between calls. The host helper exposes host.files, host.process, and host.system. This is not a sandbox.",
      inputSchema: z.object({
        sessionId: z.string().uuid(),
        code: z.string().min(1),
        timeoutMs: z.number().int().min(100).max(300_000).default(30_000),
        maxChars: z.number().int().min(1000).max(100_000).default(12_000),
      }),
      annotations: fullAccessAnnotations,
    },
    async ({ sessionId, code, timeoutMs, maxChars }) =>
      runTool(() => manager.action(sessionId, code, { timeoutMs, maxChars })),
  );

  server.registerTool(
    "python_inspect",
    {
      title: "Inspect Python session",
      description:
        "Inspect persistent Python state without resending it. Expressions are restricted to read-only indexing, slicing, comparisons, arithmetic, and a small set of pure builtins.",
      inputSchema: z.object({
        sessionId: z.string().uuid(),
        expression: z.string().optional(),
        timeoutMs: z.number().int().min(100).max(120_000).default(15_000),
        maxChars: z.number().int().min(1000).max(100_000).default(12_000),
      }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sessionId, expression, timeoutMs, maxChars }) =>
      runTool(() => manager.inspect(sessionId, expression, { timeoutMs, maxChars })),
  );

  server.registerTool(
    "python_session_close",
    {
      title: "Close Python session",
      description: "Terminate a persistent CodeAct Python session and release its in-memory state.",
      inputSchema: z.object({ sessionId: z.string().uuid() }),
      annotations: fullAccessAnnotations,
    },
    async ({ sessionId }) => runTool(() => manager.close(sessionId)),
  );
}
