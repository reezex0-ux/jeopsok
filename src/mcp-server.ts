import { McpServer } from "@modelcontextprotocol/server";

import { AccessPolicy } from "./access-policy.js";
import type { AppConfig } from "./config.js";
import { registerExecTools } from "./exec-tools.js";
import { FileService } from "./file-service.js";
import { registerFileTools } from "./file-tools.js";
import { ProcessManager } from "./process-manager.js";

export interface McpServices {
  processManager: ProcessManager;
  fileService: FileService;
  accessPolicy: AccessPolicy;
}

export function createServices(config: AppConfig): McpServices {
  const accessPolicy = new AccessPolicy({
    profile: config.accessProfile,
    defaultCwd: config.defaultCwd,
    allowedRoots: config.allowedRoots,
    allowedCommands: config.allowedCommands,
    allowedEnv: config.allowedEnv,
  });
  return {
    accessPolicy,
    processManager: new ProcessManager({
      maxRetainedOutputBytes: config.maxRetainedProcessOutputBytes,
      processRetentionMs: config.processRetentionMs,
      maxProcesses: config.maxProcesses,
      defaultMaxOutputBytes: config.maxOutputBytes,
    }),
    fileService: new FileService({
      defaultCwd: config.defaultCwd,
      maxChunkBytes: config.maxFileChunkBytes,
      maxEditFileBytes: config.maxEditFileBytes,
      maxOutputBytes: config.maxOutputBytes,
      accessPolicy,
    }),
  };
}

function instructionsFor(config: AppConfig): string {
  switch (config.accessProfile) {
    case "readonly":
      return "Jeopsok is in readonly mode. Only file metadata/read/download tools within configured roots are available.";
    case "workspace":
      return "Jeopsok is in workspace mode. File tools are restricted to configured roots; command execution is not exposed.";
    case "operator":
      return "Jeopsok is in operator mode. File tools are restricted to configured roots and command execution is limited by JEOPSOK_ALLOWED_COMMANDS. Command capabilities may still reach outside filesystem roots depending on the allowed executable.";
    case "full":
      return "Jeopsok is in full mode. Command, process, and filesystem tools run with the operating-system permissions of the Jeopsok process.";
  }
}

export function createMcpServer(config: AppConfig, services: McpServices): McpServer {
  const server = new McpServer(
    { name: "jeopsok", version: "0.2.0", ...(config.publicUrl ? { websiteUrl: config.publicUrl } : {}) },
    { instructions: instructionsFor(config), capabilities: { logging: {} } },
  );

  if (services.accessPolicy.commandExecutionEnabled) {
    registerExecTools(
      server,
      config,
      services.processManager,
      services.fileService,
      services.accessPolicy,
    );
  }
  registerFileTools(server, config, services.fileService);
  return server;
}
