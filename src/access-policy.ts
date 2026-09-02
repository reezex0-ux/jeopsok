import { existsSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { expandPath } from "./paths.js";

export type AccessProfile = "readonly" | "workspace" | "operator" | "full";
export type PathIntent = "metadata" | "read" | "write" | "delete";

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function canonicalExistingDirectory(value: string): string {
  const resolved = realpathSync.native(path.resolve(value));
  if (!statSync(resolved).isDirectory()) {
    throw new Error(`Allowed root is not a directory: ${value}`);
  }
  return resolved;
}

function nearestExisting(value: string): string {
  let current = path.resolve(value);
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return realpathSync.native(current);
}

function firstCommandToken(command: string): string {
  const value = command.trimStart();
  if (!value) throw new Error("Command must not be empty");
  const quote = value[0];
  if (quote === "'" || quote === '"') {
    const end = value.indexOf(quote, 1);
    if (end < 0) throw new Error("Unterminated quoted executable in command");
    return value.slice(1, end);
  }
  return value.split(/\s+/, 1)[0]!;
}

export function normalizeAllowedRoots(values: string[], defaultCwd: string): string[] {
  const roots = values.length > 0 ? values : [defaultCwd];
  return [...new Set(roots.map(value => canonicalExistingDirectory(
    path.isAbsolute(value) ? value : path.resolve(defaultCwd, value),
  )))];
}

export class AccessPolicy {
  readonly profile: AccessProfile;
  readonly defaultCwd: string;
  readonly allowedRoots: string[];
  readonly allowedCommands: string[];
  readonly allowedEnv: string[];

  constructor(options: {
    profile: AccessProfile;
    defaultCwd: string;
    allowedRoots: string[];
    allowedCommands: string[];
    allowedEnv: string[];
  }) {
    this.profile = options.profile;
    this.defaultCwd = options.defaultCwd;
    this.allowedRoots = options.allowedRoots;
    this.allowedCommands = options.allowedCommands;
    this.allowedEnv = options.allowedEnv;
  }

  get filesystemRestricted(): boolean { return this.profile !== "full"; }
  get commandExecutionEnabled(): boolean { return this.profile === "operator" || this.profile === "full"; }
  get fileWritesEnabled(): boolean { return this.profile !== "readonly"; }
  get unrestrictedHostAccess(): boolean { return this.profile === "full"; }

  resolvePath(inputPath: string, cwd?: string, intent: PathIntent = "read"): string {
    const base = cwd ? expandPath(cwd, this.defaultCwd) : this.defaultCwd;
    const candidate = expandPath(inputPath, base);
    if (!this.filesystemRestricted) return candidate;

    if (!this.allowedRoots.some(root => isWithin(root, candidate))) {
      throw new Error("Path is outside JEOPSOK_ALLOWED_ROOTS");
    }

    if (intent === "metadata" || intent === "delete") {
      const parentReal = nearestExisting(path.dirname(candidate));
      if (!this.allowedRoots.some(root => isWithin(root, parentReal))) {
        throw new Error("Path escapes JEOPSOK_ALLOWED_ROOTS through a symlink");
      }
      return candidate;
    }

    const checked = existsSync(candidate)
      ? realpathSync.native(candidate)
      : nearestExisting(path.dirname(candidate));
    if (!this.allowedRoots.some(root => isWithin(root, checked))) {
      throw new Error("Path escapes JEOPSOK_ALLOWED_ROOTS through a symlink");
    }
    return candidate;
  }

  assertCommand(command: string, options: {
    shell?: string;
    login: boolean;
    env?: Record<string, string>;
  }): void {
    if (this.profile === "full") return;
    if (this.profile !== "operator") {
      throw new Error(`Command execution is disabled in ${this.profile} profile`);
    }
    if (options.shell) {
      throw new Error("Custom shell override is disabled in operator profile");
    }
    if (options.login) {
      throw new Error("login=true is disabled in operator profile");
    }
    for (const key of Object.keys(options.env ?? {})) {
      if (!this.allowedEnv.includes(key)) {
        throw new Error(`Environment variable ${key} is not allowed in operator profile`);
      }
    }
    if (/[\r\n;&|<>`]/.test(command) || command.includes("$(") || command.includes("${")) {
      throw new Error("Shell control syntax is disabled in operator profile");
    }
    if (this.allowedCommands.includes("*")) return;
    const executable = firstCommandToken(command);
    const base = path.basename(executable.replace(/\\/g, "/"));
    if (!this.allowedCommands.includes(executable) && !this.allowedCommands.includes(base)) {
      throw new Error(`Command executable is not in JEOPSOK_ALLOWED_COMMANDS: ${base}`);
    }
  }
}
