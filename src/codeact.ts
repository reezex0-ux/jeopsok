import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { RunModeResolution } from "./run-mode.js";

const WORKER_SOURCE = String.raw`import ast
import contextlib
import io
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import traceback

MAX_FILE_READ = 64 * 1024 * 1024

class Metrics:
    def __init__(self):
        self.calls = {}

    def reset(self):
        self.calls = {}

    def bump(self, name, count=1):
        self.calls[name] = self.calls.get(name, 0) + int(count)

metrics = Metrics()

class ExecutionGuard:
    def __init__(self):
        self.limit = None
        self.used = 0

    def begin(self, limit=None):
        self.limit = None if limit is None else max(0, int(limit))
        self.used = 0

    def consume(self, count=1):
        count = max(1, int(count))
        if self.limit is not None and self.used + count > self.limit:
            raise RuntimeError("CodeAct execution-call budget exceeded")
        self.used += count
        metrics.bump("execution.process", count)

execution_guard = ExecutionGuard()
_real_popen = subprocess.Popen
_real_os_system = os.system

def _guarded_popen(*args, **kwargs):
    execution_guard.consume(1)
    return _real_popen(*args, **kwargs)

def _guarded_os_system(command):
    execution_guard.consume(1)
    return _real_os_system(command)

subprocess.Popen = _guarded_popen
os.system = _guarded_os_system

def clipped(text, limit):
    text = str(text)
    if len(text) <= limit:
        return text, False
    return text[:limit] + "\n...(truncated)", True

class BoundedTextBuffer(io.TextIOBase):
    def __init__(self, limit):
        super().__init__()
        self.limit = max(1, int(limit))
        self.parts = []
        self.length = 0
        self.truncated = False

    def writable(self):
        return True

    def write(self, value):
        text = str(value)
        remaining = max(0, self.limit - self.length)
        if remaining:
            piece = text[:remaining]
            self.parts.append(piece)
            self.length += len(piece)
        if len(text) > remaining:
            self.truncated = True
        return len(text)

    def getvalue(self):
        value = "".join(self.parts)
        return value + ("\n...(truncated)" if self.truncated else "")

def file_entry(p):
    try:
        st = p.stat()
        size = st.st_size if p.is_file() else None
    except Exception:
        size = None
    kind = "directory" if p.is_dir() else "file" if p.is_file() else "symlink" if p.is_symlink() else "other"
    return {"path": str(p), "name": p.name, "type": kind, "size": size}

class HostFiles:
    def _p(self, value):
        return Path(value).expanduser().resolve()

    def exists(self, target):
        metrics.bump("files.exists")
        return self._p(target).exists()

    def stat(self, target):
        metrics.bump("files.stat")
        p = self._p(target)
        st = p.stat()
        return {
            "path": str(p),
            "name": p.name,
            "type": "directory" if p.is_dir() else "file" if p.is_file() else "symlink" if p.is_symlink() else "other",
            "size": st.st_size,
            "mtime": st.st_mtime,
            "mode": st.st_mode,
        }

    def list(self, target=".", recursive=False, pattern=None, max_entries=1000):
        metrics.bump("files.list")
        root = self._p(target)
        if not root.is_dir():
            raise NotADirectoryError(str(root))
        iterator = root.rglob(pattern or "*") if recursive else root.glob(pattern or "*")
        out = []
        for p in iterator:
            out.append(file_entry(p))
            if len(out) >= max_entries:
                break
        return out

    def find(self, target=".", pattern="*", recursive=True, max_entries=1000):
        metrics.bump("files.find")
        root = self._p(target)
        iterator = root.rglob(pattern) if recursive else root.glob(pattern)
        out = []
        for p in iterator:
            out.append(file_entry(p))
            if len(out) >= max_entries:
                break
        return out

    def read(self, target, encoding="utf-8", offset=0, max_bytes=MAX_FILE_READ):
        metrics.bump("files.read")
        p = self._p(target)
        with p.open("rb") as f:
            if offset:
                f.seek(offset)
            data = f.read(max_bytes)
        return data.decode(encoding, errors="replace")

    def write(self, target, content, append=False, encoding="utf-8", create_parents=True):
        metrics.bump("files.write")
        p = self._p(target)
        if create_parents:
            p.parent.mkdir(parents=True, exist_ok=True)
        mode = "a" if append else "w"
        with p.open(mode, encoding=encoding) as f:
            written = f.write(str(content))
        return {"path": str(p), "chars_written": written, "append": append}

    def replace(self, target, old, new, count=-1, encoding="utf-8"):
        metrics.bump("files.replace")
        p = self._p(target)
        text = p.read_text(encoding=encoding)
        occurrences = text.count(old)
        if occurrences == 0:
            raise ValueError("old text not found")
        updated = text.replace(old, new, count)
        p.write_text(updated, encoding=encoding)
        return {"path": str(p), "occurrences": occurrences}

    def remove(self, target, recursive=False):
        metrics.bump("files.remove")
        p = self._p(target)
        if p.is_dir() and not p.is_symlink():
            if not recursive:
                p.rmdir()
            else:
                shutil.rmtree(p)
        else:
            p.unlink()
        return {"path": str(p), "removed": True}

    def mkdir(self, target, parents=True, exist_ok=True):
        metrics.bump("files.mkdir")
        p = self._p(target)
        p.mkdir(parents=parents, exist_ok=exist_ok)
        return {"path": str(p)}

class HostProcess:
    def run(self, args, cwd=None, env=None, timeout=None, check=False, shell=False, input=None):
        metrics.bump("process.run")
        completed = subprocess.run(
            args,
            cwd=cwd,
            env=None if env is None else {**os.environ, **{str(k): str(v) for k, v in env.items()}},
            timeout=timeout,
            check=False,
            shell=bool(shell),
            input=input,
            text=True,
            capture_output=True,
        )
        result = {
            "args": args,
            "cwd": str(Path(cwd).resolve()) if cwd else os.getcwd(),
            "exit_code": completed.returncode,
            "stdout": completed.stdout,
            "stderr": completed.stderr,
        }
        if check and completed.returncode != 0:
            raise subprocess.CalledProcessError(
                completed.returncode, args, output=completed.stdout, stderr=completed.stderr
            )
        return result

class HostSystem:
    def info(self):
        metrics.bump("system.info")
        return {
            "hostname": platform.node(),
            "platform": platform.platform(),
            "system": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
            "python": sys.version,
            "cwd": os.getcwd(),
            "cpu_count": os.cpu_count(),
        }

    def cwd(self):
        metrics.bump("system.cwd")
        return os.getcwd()

    def chdir(self, target):
        metrics.bump("system.chdir")
        os.chdir(Path(target).expanduser().resolve())
        return os.getcwd()

    def which(self, name):
        metrics.bump("system.which")
        return shutil.which(name)

    def disk(self, target="."):
        metrics.bump("system.disk")
        total, used, free = shutil.disk_usage(Path(target).expanduser().resolve())
        return {"total": total, "used": used, "free": free}

    def getenv(self, name, default=None):
        metrics.bump("system.getenv")
        return os.environ.get(name, default)

class Host:
    def __init__(self):
        self.files = HostFiles()
        self.process = HostProcess()
        self.system = HostSystem()

host = Host()
namespace = {"host": host, "__name__": "__codeact__"}

def execute_code(code):
    tree = ast.parse(code, mode="exec")
    body = list(tree.body)
    if body and isinstance(body[-1], ast.Expr):
        last = body.pop()
        if body:
            exec(compile(ast.Module(body=body, type_ignores=[]), "<codeact>", "exec"), namespace, namespace)
        return eval(compile(ast.Expression(last.value), "<codeact>", "eval"), namespace, namespace)
    exec(compile(tree, "<codeact>", "exec"), namespace, namespace)
    return None

def variable_summary(limit):
    out = []
    for name in sorted(namespace):
        if name.startswith("__") or name == "host":
            continue
        value = namespace[name]
        preview, truncated = clipped(repr(value), min(limit, 500))
        out.append({"name": name, "type": type(value).__name__, "preview": preview, "truncated": truncated})
    return out

_SAFE_INSPECT_BUILTINS = {"len": len, "min": min, "max": max, "sum": sum, "sorted": sorted, "any": any, "all": all}
_INSPECT_ALLOWED_NODES = (
    ast.Expression, ast.Name, ast.Load, ast.Constant, ast.Subscript, ast.Slice,
    ast.Tuple, ast.List, ast.Dict, ast.Set, ast.UnaryOp, ast.UAdd, ast.USub, ast.Not,
    ast.BinOp, ast.Add, ast.Sub, ast.Mult, ast.Div, ast.FloorDiv, ast.Mod, ast.Pow,
    ast.BoolOp, ast.And, ast.Or, ast.Compare, ast.Eq, ast.NotEq, ast.Lt, ast.LtE,
    ast.Gt, ast.GtE, ast.In, ast.NotIn, ast.Is, ast.IsNot, ast.Call,
)

def inspect_value(expression):
    tree = ast.parse(expression, mode="eval")
    for node in ast.walk(tree):
        if not isinstance(node, _INSPECT_ALLOWED_NODES):
            raise ValueError("python_inspect allows read-only expressions only")
        if isinstance(node, ast.Call):
            if not isinstance(node.func, ast.Name) or node.func.id not in _SAFE_INSPECT_BUILTINS:
                raise ValueError("python_inspect function calls are limited to read-only builtins")
    safe_globals = {"__builtins__": {}, **_SAFE_INSPECT_BUILTINS}
    return eval(compile(tree, "<codeact-inspect>", "eval"), safe_globals, namespace)

def handle(req):
    op = req.get("op")
    max_chars = max(1000, min(int(req.get("max_chars") or 12000), 100000))
    metrics.reset()
    execution_guard.begin(req.get("max_execution_calls") if op == "action" else 0)
    started = __import__("time").perf_counter()
    stdout_buffer = BoundedTextBuffer(max_chars)
    stderr_buffer = BoundedTextBuffer(max_chars)
    try:
        with contextlib.redirect_stdout(stdout_buffer), contextlib.redirect_stderr(stderr_buffer):
            if op == "action":
                value = execute_code(req.get("code") or "")
            elif op == "inspect":
                expression = req.get("expression")
                value = inspect_value(expression) if expression else variable_summary(max_chars)
            elif op == "ping":
                value = {"ok": True}
            else:
                raise ValueError("unknown operation: %s" % op)
        raw_repr = repr(value)
        result_preview, result_truncated = clipped(raw_repr, max_chars)
        return {
            "ok": True,
            "result_type": type(value).__name__,
            "result": result_preview,
            "result_truncated": result_truncated,
            "stdout": stdout_buffer.getvalue(),
            "stderr": stderr_buffer.getvalue(),
            "metrics": {
                "primitive_calls": metrics.calls,
                "execution_calls": execution_guard.used,
                "raw_result_bytes": len(raw_repr.encode("utf-8", errors="replace")),
            },
            "duration_ms": round((__import__("time").perf_counter() - started) * 1000, 3),
        }
    except Exception as exc:
        tb = traceback.format_exc()
        tb_preview, tb_truncated = clipped(tb, max_chars)
        return {
            "ok": False,
            "error": str(exc),
            "error_type": type(exc).__name__,
            "traceback": tb_preview,
            "traceback_truncated": tb_truncated,
            "stdout": stdout_buffer.getvalue(),
            "stderr": stderr_buffer.getvalue(),
            "metrics": {"primitive_calls": metrics.calls, "execution_calls": execution_guard.used},
            "duration_ms": round((__import__("time").perf_counter() - started) * 1000, 3),
        }

print(json.dumps({"event": "ready", "pid": os.getpid(), "cwd": os.getcwd()}), flush=True)
for line in sys.stdin:
    try:
        req = json.loads(line)
        response = handle(req)
        response["id"] = req.get("id")
    except Exception as exc:
        response = {"id": None, "ok": False, "error": str(exc), "error_type": type(exc).__name__}
    print(json.dumps(response, ensure_ascii=False), flush=True)
`;

interface PendingRequest {
  resolve: (value: WorkerResponse) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

interface WorkerResponse {
  id?: string;
  event?: string;
  ok?: boolean;
  error?: string;
  error_type?: string;
  traceback?: string;
  result_type?: string;
  result?: string;
  result_truncated?: boolean;
  stdout?: string;
  stderr?: string;
  metrics?: Record<string, unknown>;
  duration_ms?: number;
  pid?: number;
  cwd?: string;
}

interface CodeActSession {
  id: string;
  label: string | undefined;
  cwd: string;
  child: ChildProcessWithoutNullStreams;
  pending: Map<string, PendingRequest>;
  stdoutBuffer: string;
  createdAt: number;
  lastUsedAt: number;
  runMode: RunModeResolution["mode"];
  runModeSource: RunModeResolution["source"];
  requestMetaKeys: string[];
  actionCount: number;
  executionCalls: number;
  reservedActions: number;
  reservedExecutionCalls: number;
  lastActionOk: boolean | undefined;
  lastErrorType: string | undefined;
  statePath: string;
  ready: Promise<WorkerResponse>;
  resolveReady: (value: WorkerResponse) => void;
  rejectReady: (error: Error) => void;
}

export interface CodeActOptions {
  pythonExecutable: string;
  defaultCwd: string;
  logFile: string;
  maxSessions: number;
  sessionRetentionMs: number;
  runStateDir: string;
  interactiveMaxActions: number;
  interactiveMaxExecutionCalls: number;
}

export interface CodeActActionOptions {
  timeoutMs?: number;
  maxChars?: number;
}

export class CodeActManager {
  readonly #options: CodeActOptions;
  readonly #sessions = new Map<string, CodeActSession>();
  #workerPathPromise: Promise<string> | undefined;
  #workerDirectory: string | undefined;
  #pendingCreates = 0;

  constructor(options: CodeActOptions) {
    this.#options = options;
  }

  list(): Array<Record<string, unknown>> {
    return [...this.#sessions.values()].map((session) => ({
      sessionId: session.id,
      label: session.label,
      cwd: session.cwd,
      pid: session.child.pid,
      createdAt: new Date(session.createdAt).toISOString(),
      lastUsedAt: new Date(session.lastUsedAt).toISOString(),
      runMode: session.runMode,
      runModeSource: session.runModeSource,
      actionCount: session.actionCount,
      executionCalls: session.executionCalls,
      checkpointPath: session.statePath,
      running: session.child.exitCode === null,
    }));
  }

  async create(
    cwd?: string,
    label?: string,
    resolution: RunModeResolution = { mode: "interactive", source: "default", requestMetaKeys: [] },
  ): Promise<Record<string, unknown>> {
    this.prune();
    if (this.#sessions.size + this.#pendingCreates >= this.#options.maxSessions) {
      throw new Error(`Maximum CodeAct sessions reached (${this.#options.maxSessions})`);
    }

    this.#pendingCreates += 1;
    let workerPath: string;
    try {
      workerPath = await this.#ensureWorker();
    } finally {
      this.#pendingCreates -= 1;
    }

    const resolvedCwd = path.resolve(cwd?.trim() || this.#options.defaultCwd);
    const id = randomUUID();
    const statePath = path.join(this.#options.runStateDir, `${id}.json`);
    const child = spawn(this.#options.pythonExecutable, ["-u", workerPath], {
      cwd: resolvedCwd,
      env: { ...process.env, MCP_RUN_MODE: resolution.mode, MCP_RUN_ID: id },
      stdio: "pipe",
      detached: process.platform !== "win32",
      windowsHide: true,
    }) as ChildProcessWithoutNullStreams;

    let resolveReady!: (value: WorkerResponse) => void;
    let rejectReady!: (error: Error) => void;
    const ready = new Promise<WorkerResponse>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });

    const now = Date.now();
    const session: CodeActSession = {
      id,
      label: label?.trim() || undefined,
      cwd: resolvedCwd,
      child,
      pending: new Map(),
      stdoutBuffer: "",
      createdAt: now,
      lastUsedAt: now,
      runMode: resolution.mode,
      runModeSource: resolution.source,
      requestMetaKeys: resolution.requestMetaKeys,
      actionCount: 0,
      executionCalls: 0,
      reservedActions: 0,
      reservedExecutionCalls: 0,
      lastActionOk: undefined,
      lastErrorType: undefined,
      statePath,
      ready,
      resolveReady,
      rejectReady,
    };

    this.#sessions.set(id, session);
    this.#wireSession(session);

    let readyResponse: WorkerResponse;
    try {
      readyResponse = await Promise.race([
        ready,
        new Promise<never>((_resolve, reject) =>
          setTimeout(() => reject(new Error("CodeAct worker did not become ready")), 5000),
        ),
      ]);
    } catch (error) {
      await this.#terminateSession(session, "startup failure");
      throw error;
    }

    await this.#appendLog({
      time: new Date().toISOString(),
      event: "session_create",
      sessionId: id,
      label: session.label,
      cwd: resolvedCwd,
      pid: readyResponse.pid,
      runMode: session.runMode,
      runModeSource: session.runModeSource,
      requestMetaKeys: session.requestMetaKeys,
    });
    await this.#writeCheckpoint(session);

    return {
      sessionId: id,
      label: session.label,
      cwd: resolvedCwd,
      pid: readyResponse.pid,
      python: this.#options.pythonExecutable,
      persistent: true,
      runMode: session.runMode,
      runModeSource: session.runModeSource,
      requestMetaKeys: session.requestMetaKeys,
      checkpointPath: session.statePath,
      interactiveBudget: session.runMode === "interactive" ? this.#interactiveBudget(session) : null,
    };
  }

  async action(
    sessionId: string,
    code: string,
    options: CodeActActionOptions = {},
  ): Promise<Record<string, unknown>> {
    const session = this.#requireSession(sessionId);
    const executionAllowance = this.#reserveAction(session);
    const startedAt = performance.now();

    let response: WorkerResponse;
    try {
      response = await this.#request(
        sessionId,
        {
          op: "action",
          code,
          max_chars: options.maxChars ?? 12_000,
          max_execution_calls: executionAllowance,
        },
        options.timeoutMs ?? 30_000,
      );
    } catch (error) {
      this.#releaseActionReservation(session, executionAllowance);
      session.actionCount += 1;
      session.lastActionOk = false;
      session.lastErrorType = error instanceof Error ? error.name : "Error";
      await this.#writeCheckpoint(session).catch(() => undefined);
      throw error;
    }

    const actualExecutionCalls = this.#responseExecutionCalls(response);
    this.#releaseActionReservation(session, executionAllowance);
    session.actionCount += 1;
    session.executionCalls += actualExecutionCalls;
    session.lastActionOk = response.ok === true;
    session.lastErrorType = response.error_type;
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;

    await this.#appendLog({
      time: new Date().toISOString(),
      event: "action",
      sessionId,
      codeBytes: Buffer.byteLength(code, "utf8"),
      codeSha256: createHash("sha256").update(code).digest("hex"),
      durationMs,
      workerDurationMs: response.duration_ms,
      ok: response.ok === true,
      resultType: response.result_type,
      resultTruncated: response.result_truncated,
      metrics: response.metrics,
      errorType: response.error_type,
      runMode: session.runMode,
      actionCount: session.actionCount,
      executionCalls: session.executionCalls,
    });
    await this.#writeCheckpoint(session);

    return this.#publicResponse(sessionId, response, durationMs);
  }

  async inspect(
    sessionId: string,
    expression?: string,
    options: CodeActActionOptions = {},
  ): Promise<Record<string, unknown>> {
    const startedAt = performance.now();
    const response = await this.#request(
      sessionId,
      {
        op: "inspect",
        expression: expression?.trim() || undefined,
        max_chars: options.maxChars ?? 12_000,
      },
      options.timeoutMs ?? 15_000,
    );
    const durationMs = Math.round((performance.now() - startedAt) * 10) / 10;
    await this.#appendLog({
      time: new Date().toISOString(),
      event: "inspect",
      sessionId,
      expressionBytes: expression ? Buffer.byteLength(expression, "utf8") : 0,
      durationMs,
      ok: response.ok === true,
      resultType: response.result_type,
      errorType: response.error_type,
    });
    return this.#publicResponse(sessionId, response, durationMs);
  }

  async close(sessionId: string): Promise<Record<string, unknown>> {
    const session = this.#requireSession(sessionId);
    await this.#writeCheckpoint(session, { closedAt: new Date().toISOString() });
    await this.#terminateSession(session, "closed");
    await this.#appendLog({
      time: new Date().toISOString(),
      event: "session_close",
      sessionId,
      runMode: session.runMode,
    });
    return { sessionId, closed: true, runMode: session.runMode, checkpointPath: session.statePath };
  }

  prune(now = Date.now()): void {
    for (const session of [...this.#sessions.values()]) {
      if (now - session.lastUsedAt > this.#options.sessionRetentionMs) {
        void (async () => {
          await this.#writeCheckpoint(session, { expiredAt: new Date(now).toISOString() }).catch(() => undefined);
          await this.#terminateSession(session, "expired");
          await this.#appendLog({
            time: new Date().toISOString(),
            event: "session_expire",
            sessionId: session.id,
          });
        })();
      }
    }
  }

  async shutdown(): Promise<void> {
    await Promise.all(
      [...this.#sessions.values()].map((session) => this.#terminateSession(session, "shutdown")),
    );
    if (this.#workerDirectory) {
      await rm(this.#workerDirectory, { recursive: true, force: true }).catch(() => undefined);
      this.#workerDirectory = undefined;
      this.#workerPathPromise = undefined;
    }
  }

  async #request(
    sessionId: string,
    payload: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<WorkerResponse> {
    const session = this.#requireSession(sessionId);
    session.lastUsedAt = Date.now();
    const requestId = randomUUID();

    return new Promise<WorkerResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        session.pending.delete(requestId);
        void (async () => {
          await this.#terminateSession(session, "timeout");
          await this.#writeCheckpoint(session, { timedOutAt: new Date().toISOString() }).catch(() => undefined);
          reject(new Error(`CodeAct request timed out after ${timeoutMs} ms; session terminated`));
        })();
      }, timeoutMs);

      session.pending.set(requestId, { resolve, reject, timer });
      session.child.stdin.write(`${JSON.stringify({ id: requestId, ...payload })}\n`, (error) => {
        if (error) {
          clearTimeout(timer);
          session.pending.delete(requestId);
          reject(error);
        }
      });
    });
  }

  #wireSession(session: CodeActSession): void {
    session.child.stdout.setEncoding("utf8");
    session.child.stdout.on("data", (chunk: string) => {
      session.stdoutBuffer += chunk;
      while (true) {
        const newline = session.stdoutBuffer.indexOf("\n");
        if (newline < 0) break;
        const line = session.stdoutBuffer.slice(0, newline).trim();
        session.stdoutBuffer = session.stdoutBuffer.slice(newline + 1);
        if (!line) continue;

        let message: WorkerResponse;
        try {
          message = JSON.parse(line) as WorkerResponse;
        } catch {
          continue;
        }

        if (message.event === "ready") {
          session.resolveReady(message);
          continue;
        }

        const requestId = typeof message.id === "string" ? message.id : undefined;
        if (!requestId) continue;
        const pending = session.pending.get(requestId);
        if (!pending) continue;
        clearTimeout(pending.timer);
        session.pending.delete(requestId);
        pending.resolve(message);
      }
    });

    let stderr = "";
    session.child.stderr.setEncoding("utf8");
    session.child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-16_384);
    });

    session.child.once("error", (error) => {
      session.rejectReady(error);
      this.#rejectPending(session, error);
      this.#sessions.delete(session.id);
    });

    session.child.once("close", (code, signal) => {
      const error = new Error(
        `CodeAct worker exited (code=${code ?? "null"}, signal=${signal ?? "null"})${stderr ? `: ${stderr}` : ""}`,
      );
      session.rejectReady(error);
      this.#rejectPending(session, error);
      this.#sessions.delete(session.id);
    });
  }

  #publicResponse(
    sessionId: string,
    response: WorkerResponse,
    durationMs: number,
  ): Record<string, unknown> {
    const session = this.#sessions.get(sessionId);
    return {
      sessionId,
      ...(session ? {
        runMode: session.runMode,
        runModeSource: session.runModeSource,
        actionCount: session.actionCount,
        executionCalls: session.executionCalls,
        checkpointPath: session.statePath,
        interactiveBudget: session.runMode === "interactive" ? this.#interactiveBudget(session) : null,
      } : {}),
      ok: response.ok === true,
      resultType: response.result_type,
      result: response.result,
      resultTruncated: response.result_truncated ?? false,
      stdout: response.stdout ?? "",
      stderr: response.stderr ?? "",
      metrics: response.metrics ?? {},
      durationMs,
      ...(response.ok === true ? {} : {
        error: response.error ?? "CodeAct execution failed",
        errorType: response.error_type,
        traceback: response.traceback,
      }),
    };
  }

  #interactiveBudget(session: CodeActSession): {
    maxActions: number;
    actionsUsed: number;
    actionsRemaining: number;
    maxExecutionCalls: number;
    executionCallsUsed: number;
    executionCallsRemaining: number;
  } {
    return {
      maxActions: this.#options.interactiveMaxActions,
      actionsUsed: session.actionCount,
      actionsRemaining: Math.max(0, this.#options.interactiveMaxActions - session.actionCount),
      maxExecutionCalls: this.#options.interactiveMaxExecutionCalls,
      executionCallsUsed: session.executionCalls,
      executionCallsRemaining: Math.max(
        0,
        this.#options.interactiveMaxExecutionCalls - session.executionCalls,
      ),
    };
  }

  #reserveAction(session: CodeActSession): number | null {
    if (session.runMode !== "interactive") {
      session.reservedActions += 1;
      return null;
    }

    if (session.actionCount + session.reservedActions >= this.#options.interactiveMaxActions) {
      throw new Error(
        `Interactive CodeAct action budget exhausted (${this.#options.interactiveMaxActions}). Continue in a new session or use unattended mode for scheduled work.`,
      );
    }

    const remainingExecutionCalls = Math.max(
      0,
      this.#options.interactiveMaxExecutionCalls -
        session.executionCalls -
        session.reservedExecutionCalls,
    );
    const allowance = Math.min(3, remainingExecutionCalls);
    session.reservedActions += 1;
    session.reservedExecutionCalls += allowance;
    return allowance;
  }

  #releaseActionReservation(session: CodeActSession, allowance: number | null): void {
    session.reservedActions = Math.max(0, session.reservedActions - 1);
    if (allowance !== null) {
      session.reservedExecutionCalls = Math.max(0, session.reservedExecutionCalls - allowance);
    }
  }

  #responseExecutionCalls(response: WorkerResponse): number {
    const value = (response.metrics as Record<string, unknown> | undefined)?.execution_calls;
    return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  }

  async #writeCheckpoint(
    session: CodeActSession,
    extra: Record<string, unknown> = {},
  ): Promise<void> {
    await mkdir(path.dirname(session.statePath), { recursive: true });
    const state = {
      schemaVersion: "1",
      sessionId: session.id,
      label: session.label,
      cwd: session.cwd,
      runMode: session.runMode,
      runModeSource: session.runModeSource,
      requestMetaKeys: session.requestMetaKeys,
      createdAt: new Date(session.createdAt).toISOString(),
      updatedAt: new Date().toISOString(),
      actionCount: session.actionCount,
      executionCalls: session.executionCalls,
      lastActionOk: session.lastActionOk ?? null,
      lastErrorType: session.lastErrorType ?? null,
      ...extra,
    };
    await writeFile(session.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }

  #requireSession(sessionId: string): CodeActSession {
    const session = this.#sessions.get(sessionId);
    if (!session) throw new Error(`Unknown CodeAct session: ${sessionId}`);
    if (session.child.exitCode !== null) {
      this.#sessions.delete(sessionId);
      throw new Error(`CodeAct session is no longer running: ${sessionId}`);
    }
    return session;
  }

  async #terminateSession(session: CodeActSession, reason: string): Promise<void> {
    this.#sessions.delete(session.id);
    this.#rejectPending(session, new Error(`CodeAct session ${reason}`));
    if (session.child.exitCode !== null) return;

    const pid = session.child.pid;
    if (pid === undefined) return;
    try {
      if (process.platform === "win32") process.kill(pid, "SIGTERM");
      else process.kill(-pid, "SIGTERM");
    } catch {}

    await new Promise((resolve) => setTimeout(resolve, 250));
    if (session.child.exitCode === null) {
      try {
        if (process.platform === "win32") process.kill(pid, "SIGKILL");
        else process.kill(-pid, "SIGKILL");
      } catch {}
    }
  }

  #rejectPending(session: CodeActSession, error: Error): void {
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    session.pending.clear();
  }

  async #ensureWorker(): Promise<string> {
    if (!this.#workerPathPromise) {
      this.#workerPathPromise = (async () => {
        const directory = await mkdtemp(path.join(os.tmpdir(), "jeopsok-codeact-"));
        this.#workerDirectory = directory;
        const workerPath = path.join(directory, "worker.py");
        await writeFile(workerPath, WORKER_SOURCE, "utf8");
        return workerPath;
      })();
    }
    return this.#workerPathPromise;
  }

  async #appendLog(entry: Record<string, unknown>): Promise<void> {
    try {
      await mkdir(path.dirname(this.#options.logFile), { recursive: true });
      await appendFile(this.#options.logFile, `${JSON.stringify(entry)}\n`, "utf8");
    } catch {
      // Telemetry must never break execution.
    }
  }
}
