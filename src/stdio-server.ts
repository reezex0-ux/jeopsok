import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { loadConfig } from "./config.js";
import { errorMessage } from "./errors.js";
import { createMcpServer, createServices } from "./mcp-server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const services = createServices(config);
  const handle = serveStdio(() => createMcpServer(config, services), {
    legacy: "serve", onerror: (error) => console.error("Jeopsok stdio MCP error:", errorMessage(error)),
  });
  console.error(`Jeopsok stdio ready; default cwd: ${config.defaultCwd}`);
  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return; shuttingDown = true;
    console.error(`received ${signal}; shutting down`);
    try { await handle.close(); await services.processManager.shutdown(); await services.codeActManager?.shutdown(); process.exitCode = 0; }
    catch (error) { console.error("shutdown failed:", errorMessage(error)); process.exitCode = 1; }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}
main().catch((error) => { console.error("Jeopsok stdio failed to start:", errorMessage(error)); process.exitCode = 1; });
