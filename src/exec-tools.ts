import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AppConfig } from "./config.js";
import { FileService } from "./file-service.js";
import { ProcessManager } from "./process-manager.js";
import { runTool } from "./tool-result.js";

const fullAccessAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};


export function shellCommandArgs(
  executable: string,
  command: string,
  login: boolean,
): string[] {
  const shellName = executable.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? executable.toLowerCase();

  if (["pwsh", "pwsh.exe", "powershell", "powershell.exe"].includes(shellName)) {
    return ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command];
  }
  if (["cmd", "cmd.exe"].includes(shellName)) {
    return ["/d", "/s", "/c", command];
  }
  return [login ? "-lc" : "-c", command];
}


function processResult(result: Awaited<ReturnType<ProcessManager["read"]>>): Record<string, unknown> {
  return {
    ...result,
    completed: !result.running,
  };
}

export function registerExecTools(
  server: McpServer,
  config: AppConfig,
  processManager: ProcessManager,
  fileService: FileService,
): void {
  const environmentSchema = z
    .record(z.string(), z.string())
    .optional()
    .describe("Environment variables added to or overriding the server process environment.");

  server.registerTool(
    "exec_command",
    {
      title: "Execute command",
      description:
        "Run a shell command on the host. If it is still running after yieldTimeMs, the call returns a process sessionId that can be polled with read_process.",
      inputSchema: z.object({
              cmd: z.string().min(1).describe("Shell command or script to execute."),
              workdir: z
                .string()
                .optional()
                .describe(`Working directory. Relative paths resolve from ${config.defaultCwd}.`),
              shell: z
                .string()
                .optional()
                .describe(`Shell executable. Defaults to ${config.defaultShell}.`),
              login: z
                .boolean()
                .default(true)
                .describe("Use login-shell semantics for POSIX shells. Ignored by PowerShell and cmd.exe."),
              env: environmentSchema,
              stdin: z.string().optional().describe("Initial text written to stdin after spawn."),
              timeoutMs: z
                .number()
                .int()
                .min(0)
                .default(0)
                .describe("Maximum runtime in milliseconds. Zero means no timeout."),
              yieldTimeMs: z
                .number()
                .int()
                .min(0)
                .max(5_000)
                .default(2_000)
                .describe("How long to wait for output before returning a running session; long work must be polled."),
              maxOutputBytes: z
                .number()
                .int()
                .min(16 * 1024)
                .max(config.maxOutputBytes)
                .default(config.maxOutputBytes)
                .describe("Maximum output bytes returned by this call."),
            }),
      annotations: fullAccessAnnotations,
    },
    async ({
      cmd,
      workdir,
      shell,
      login,
      env,
      stdin,
      timeoutMs,
      yieldTimeMs,
      maxOutputBytes,
    }) =>
      runTool(async () => {
        const cwd = fileService.resolve(".", workdir);
        const executable = shell || config.defaultShell;
        const sessionId = processManager.start({
          executable,
          args: shellCommandArgs(executable, cmd, login),
          commandForDisplay: cmd,
          cwd,
          env,
          timeoutMs,
          stdin,
        });
        await processManager.waitForExit(sessionId, yieldTimeMs);
        const result = await processManager.read(sessionId, {
          maxOutputBytes,
        });
        return processResult(result);
      }),
  );

  server.registerTool(
    "write_stdin",
    {
      title: "Write to process stdin",
      description:
        "Write text to an existing process session, optionally close stdin, then return new output.",
      inputSchema: z.object({
              sessionId: z.string().uuid(),
              chars: z.string().default(""),
              closeStdin: z.boolean().default(false),
              afterSeq: z.number().int().min(0).default(0),
              yieldTimeMs: z.number().int().min(0).max(300_000).default(250),
              maxOutputBytes: z
                .number()
                .int()
                .min(16 * 1024)
                .max(config.maxOutputBytes)
                .default(config.maxOutputBytes),
            }),
      annotations: fullAccessAnnotations,
    },
    async ({ sessionId, chars, closeStdin, afterSeq, yieldTimeMs, maxOutputBytes }) =>
      runTool(async () => {
        await processManager.write(sessionId, chars, closeStdin);
        if (closeStdin) {
          await processManager.waitForExit(sessionId, yieldTimeMs);
        }
        const result = await processManager.read(sessionId, {
          afterSeq,
          waitMs: closeStdin ? 0 : yieldTimeMs,
          maxOutputBytes,
        });
        return processResult(result);
      }),
  );

  server.registerTool(
    "read_process",
    {
      title: "Read process output",
      description:
        "Poll a managed process for output and terminal state. Pass the previous nextSeq as afterSeq to receive only newer output.",
      inputSchema: z.object({
              sessionId: z.string().uuid(),
              afterSeq: z.number().int().min(0).default(0),
              waitMs: z.number().int().min(0).max(300_000).default(1000),
              maxOutputBytes: z
                .number()
                .int()
                .min(16 * 1024)
                .max(config.maxOutputBytes)
                .default(config.maxOutputBytes),
            }),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ sessionId, afterSeq, waitMs, maxOutputBytes }) =>
      runTool(async () =>
        processResult(
          await processManager.read(sessionId, {
            afterSeq,
            waitMs,
            maxOutputBytes,
          }),
        ),
      ),
  );

  server.registerTool(
    "terminate_process",
    {
      title: "Terminate process",
      description:
        "Send a signal to a managed process tree. SIGTERM escalates to SIGKILL after graceMs if necessary.",
      inputSchema: z.object({
              sessionId: z.string().uuid(),
              signal: z.enum(["SIGINT", "SIGTERM", "SIGKILL"]).default("SIGTERM"),
              graceMs: z.number().int().min(0).max(60_000).default(3000),
            }),
      annotations: fullAccessAnnotations,
    },
    async ({ sessionId, signal, graceMs }) =>
      runTool(async () =>
        processResult(await processManager.terminate(sessionId, signal, graceMs)),
      ),
  );

  server.registerTool(
    "list_processes",
    {
      title: "List managed processes",
      description: "List running and recently completed process sessions.",
      inputSchema: z.object({}),
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => runTool(() => ({ processes: processManager.list() })),
  );
}
