import { McpServer } from "@modelcontextprotocol/server";
import type { AppConfig } from "./config.js";
import { registerExecTools } from "./exec-tools.js";
import { FileService } from "./file-service.js";
import { registerFileTools } from "./file-tools.js";
import { ProcessManager } from "./process-manager.js";

export interface McpServices { processManager: ProcessManager; fileService: FileService; }

export function createServices(config: AppConfig): McpServices {
  return {
    processManager: new ProcessManager({
      maxRetainedOutputBytes: config.maxRetainedProcessOutputBytes, processRetentionMs: config.processRetentionMs,
      maxProcesses: config.maxProcesses, defaultMaxOutputBytes: config.maxOutputBytes,
    }),
    fileService: new FileService({
      defaultCwd: config.defaultCwd, maxChunkBytes: config.maxFileChunkBytes, maxEditFileBytes: config.maxEditFileBytes, maxOutputBytes: config.maxOutputBytes,
    }),
  };
}

export function createMcpServer(config: AppConfig, services: McpServices): McpServer {
  const server = new McpServer(
    { name: "jeopsok", version: "0.1.0", ...(config.publicUrl ? { websiteUrl: config.publicUrl } : {}) },
    {
      instructions: "Jeopsok provides unrestricted host command, process, and filesystem tools. Long-running commands return a process sessionId; use read_process/write_stdin/terminate_process for follow-up. Treat this server as privileged remote access and expose it only through trusted authentication or a private tunnel.",
      capabilities: { logging: {} },
    },
  );
  registerExecTools(server, config, services.processManager, services.fileService);
  registerFileTools(server, config, services.fileService);
  return server;
}
