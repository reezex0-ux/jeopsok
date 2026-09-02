import type { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";

import type { AppConfig } from "./config.js";
import { FileService } from "./file-service.js";
import { runTool } from "./tool-result.js";

const readAnnotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const writeAnnotations = { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false };
const cwdSchema = z.string().optional().describe("Base directory used to resolve relative paths. Must remain inside configured roots unless profile=full.");
const pathSchema = z.string().min(1).describe("Absolute, ~/ or relative path. Restricted to configured roots unless profile=full.");
const fileModeSchema = z.string().regex(/^(?:0o)?[0-7]{3,4}$/).optional().describe("Unix mode as octal, for example 0755.");
function parseMode(mode: string | undefined): number | undefined { return mode === undefined ? undefined : Number.parseInt(mode.replace(/^0o/, ""), 8); }

export function registerFileTools(server: McpServer, config: AppConfig, files: FileService): void {
  server.registerTool("list_directory", {
    title: "List directory",
    description: "List a permitted directory. Recursive listing does not follow directory symlinks.",
    inputSchema: z.object({
      path: pathSchema,
      cwd: cwdSchema,
      recursive: z.boolean().default(false),
      maxDepth: z.number().int().min(0).max(100).default(8),
      maxEntries: z.number().int().min(1).max(50_000).default(1000),
      includeHidden: z.boolean().default(true),
      includeMetadata: z.boolean().default(false),
    }), annotations: readAnnotations,
  }, async ({ path, cwd, recursive, maxDepth, maxEntries, includeHidden, includeMetadata }) =>
    runTool(() => files.listDirectory(path, cwd, { recursive, maxDepth, maxEntries, includeHidden, includeMetadata })));

  server.registerTool("stat_path", {
    title: "Inspect path",
    description: "Return metadata for a permitted file, directory, or symbolic link.",
    inputSchema: z.object({ path: pathSchema, cwd: cwdSchema }), annotations: readAnnotations,
  }, async ({ path, cwd }) => runTool(() => files.getInfo(path, cwd)));

  server.registerTool("read_file", {
    title: "Read file",
    description: "Read a bounded permitted file chunk as UTF-8 or base64. Continue with nextOffset until eof=true.",
    inputSchema: z.object({
      path: pathSchema, cwd: cwdSchema,
      offset: z.number().int().min(0).default(0),
      maxBytes: z.number().int().min(1).max(config.maxFileChunkBytes).default(Math.min(256 * 1024, config.maxFileChunkBytes)),
      encoding: z.enum(["utf8", "base64"]).default("utf8"),
    }), annotations: readAnnotations,
  }, async ({ path, cwd, offset, maxBytes, encoding }) => runTool(() => files.readFileChunk(path, cwd, offset, maxBytes, encoding)));

  server.registerTool("download_file", {
    title: "Download file chunk",
    description: "Read a permitted file chunk as base64. Continue with nextOffset until eof=true.",
    inputSchema: z.object({
      path: pathSchema, cwd: cwdSchema,
      offset: z.number().int().min(0).default(0),
      maxBytes: z.number().int().min(1).max(config.maxFileChunkBytes).default(config.maxFileChunkBytes),
    }), annotations: readAnnotations,
  }, async ({ path, cwd, offset, maxBytes }) => runTool(() => files.downloadChunk(path, cwd, offset, maxBytes)));

  if (config.accessProfile === "readonly") return;

  server.registerTool("write_file", {
    title: "Write file",
    description: "Create, overwrite, or append content inside permitted roots.",
    inputSchema: z.object({
      path: pathSchema, cwd: cwdSchema, content: z.string(),
      encoding: z.enum(["utf8", "base64"]).default("utf8"),
      mode: z.enum(["overwrite", "append"]).default("overwrite"),
      createParents: z.boolean().default(true), fileMode: fileModeSchema,
    }), annotations: writeAnnotations,
  }, async ({ path, cwd, content, encoding, mode, createParents, fileMode }) =>
    runTool(() => files.writeFileContent(path, cwd, content, encoding, mode, createParents, parseMode(fileMode))));

  server.registerTool("replace_in_file", {
    title: "Replace text in file",
    description: "Perform exact UTF-8 text replacement inside permitted roots. By default exactly one occurrence must exist.",
    inputSchema: z.object({
      path: pathSchema, cwd: cwdSchema, oldText: z.string().min(1), newText: z.string(),
      replaceAll: z.boolean().default(false), expectedOccurrences: z.number().int().min(0).optional(),
    }), annotations: writeAnnotations,
  }, async ({ path, cwd, oldText, newText, replaceAll, expectedOccurrences }) =>
    runTool(() => files.replaceInFile(path, cwd, oldText, newText, replaceAll, expectedOccurrences)));

  server.registerTool("upload_file", {
    title: "Upload file chunk",
    description: "Write a base64 file chunk inside permitted roots at an exact byte offset.",
    inputSchema: z.object({
      path: pathSchema, cwd: cwdSchema, dataBase64: z.string(),
      offset: z.number().int().min(0).default(0), truncate: z.boolean().default(false), createParents: z.boolean().default(true),
    }), annotations: writeAnnotations,
  }, async ({ path, cwd, dataBase64, offset, truncate, createParents }) =>
    runTool(() => files.uploadChunk(path, cwd, dataBase64, offset, truncate, createParents)));

  server.registerTool("remove_path", {
    title: "Remove path",
    description: "Permanently remove a permitted file or directory. There is no trash/recycle-bin layer.",
    inputSchema: z.object({ path: pathSchema, cwd: cwdSchema, recursive: z.boolean().default(false), force: z.boolean().default(false) }),
    annotations: writeAnnotations,
  }, async ({ path, cwd, recursive, force }) => runTool(() => files.removePath(path, cwd, recursive, force)));
}
