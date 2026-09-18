import { McpServer } from "@modelcontextprotocol/server";

import { AccessPolicy } from "./access-policy.js";
import { CodeActManager } from "./codeact.js";
import { registerCodeActTools } from "./codeact-tools.js";
import type { AppConfig } from "./config.js";
import { registerExecTools } from "./exec-tools.js";
import { FileService } from "./file-service.js";
import { registerFileTools } from "./file-tools.js";
import { ProcessManager } from "./process-manager.js";

export interface McpServices {
  processManager: ProcessManager;
  fileService: FileService;
  accessPolicy: AccessPolicy;
  codeActManager: CodeActManager | undefined;
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
    codeActManager:
      config.codeActEnabled && config.accessProfile === "full"
        ? new CodeActManager({
            pythonExecutable: config.codeActPython,
            defaultCwd: config.defaultCwd,
            logFile: config.codeActLogFile,
            maxSessions: config.codeActMaxSessions,
            sessionRetentionMs: config.codeActSessionRetentionMs,
            runStateDir: config.codeActRunStateDir,
            interactiveMaxActions: config.codeActInteractiveMaxActions,
            interactiveMaxExecutionCalls: config.codeActInteractiveMaxExecutionCalls,
          })
        : undefined,
  };
}

function instructionsFor(config: AppConfig, codeActEnabled: boolean): string {
  switch (config.accessProfile) {
    case "readonly":
      return "Jeopsok is in readonly mode. Only file metadata/read/download tools within configured roots are available.";
    case "workspace":
      return "Jeopsok is in workspace mode. File tools are restricted to configured roots; command execution and CodeAct are not exposed.";
    case "operator":
      return "Jeopsok is in operator mode. File tools are restricted to configured roots and command execution is limited by JEOPSOK_ALLOWED_COMMANDS. CodeAct is not exposed because unrestricted Python would bypass the operator boundary.";
    case "full":
      return codeActEnabled
        ? "Jeopsok is in full mode. Command, process, filesystem, and persistent CodeAct Python tools run with the operating-system permissions of the Jeopsok process."
        : "Jeopsok is in full mode. Command, process, and filesystem tools run with the operating-system permissions of the Jeopsok process.";
  }
}

export function createMcpServer(config: AppConfig, services: McpServices): McpServer {
  const server = new McpServer(
    {
      name: "jeopsok",
      version: "0.4.0",
      ...(config.publicUrl ? { websiteUrl: config.publicUrl } : {}),
    },
    {
      instructions: instructionsFor(config, services.codeActManager !== undefined),
      capabilities: { logging: {} },
    },
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

  if (services.codeActManager) {
    registerCodeActTools(server, services.codeActManager);
  }

  return server;
}
