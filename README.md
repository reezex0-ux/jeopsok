# 접속 — Jeopsok

**Jeopsok (접속)** is a small remote runtime for MCP clients. It gives an agent a focused set of host tools for command execution, long-running process control, and filesystem access.

The public edition is intentionally smaller than the private runtime it came from: **13 tools, no machine-specific policies, no GPU routing, no personal runbooks, and no hidden infrastructure assumptions.**

## Why this exists

MCP `2026-07-28` removes the old connection handshake and protocol session model. Jeopsok uses the MCP TypeScript SDK v2 and serves modern requests as independent HTTP exchanges while keeping only the state that actually belongs to the workload—for example, a long-running process handle.

```text
MCP client
   |
   |  MCP 2026-07-28 / Streamable HTTP
   v
Jeopsok
   |
   +-- shell commands
   +-- process handles
   `-- filesystem
```

For older clients, the same HTTP endpoint also accepts the SDK's stateless 2025-era fallback. There is no `Mcp-Session-Id` in Jeopsok's HTTP serving model.

## The important distinction

Jeopsok is **stateless at the MCP transport layer**, not stateless at the workload layer.

A command can return a `sessionId`, and a later independent MCP request can use that handle with `read_process`, `write_stdin`, or `terminate_process`. If the Jeopsok service restarts, in-memory process handles are lost.

## Public tool surface

| Area | Tools |
| --- | --- |
| Commands / processes | `exec_command`, `write_stdin`, `read_process`, `terminate_process`, `list_processes` |
| Files | `list_directory`, `stat_path`, `read_file`, `write_file`, `replace_in_file`, `upload_file`, `download_file`, `remove_path` |

The deliberately small surface avoids multiple overlapping ways to do the same job. Directory creation, copy/move, chmod, hashing, Git operations, package installs, builds, and similar tasks can be performed through `exec_command` when needed.

## Security warning

> **Jeopsok is remote shell/filesystem access. It is not a sandbox.**
>
> Every tool runs with the operating-system permissions of the Jeopsok process. Run it as a dedicated non-root user, bind to loopback by default, and expose it only through a trusted private tunnel or HTTPS with strong authentication. See [SECURITY.md](SECURITY.md).

## Requirements

- Node.js 22+
- npm
- Linux, macOS, or Windows
- A trusted MCP client

## Quick start

```bash
git clone https://github.com/reezex0-ux/jeopsok.git
cd jeopsok
npm install
npm run build

export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
export MCP_HOST=127.0.0.1
export MCP_DEFAULT_CWD="$HOME"
npm start
```

Default endpoints:

- MCP: `http://127.0.0.1:3000/mcp`
- Health: `http://127.0.0.1:3000/health`

A typical health response looks like:

```json
{
  "status": "ok",
  "service": "jeopsok",
  "version": "0.1.0",
  "transportMode": "mcp-2026-stateless",
  "protocolRevision": "2026-07-28",
  "legacyStatelessFallback": true,
  "activeMcpSessions": 0,
  "activeMcpRequests": 0,
  "managedProcesses": 0,
  "unrestrictedHostAccess": true,
}
```

## Connecting a client

### Private/local host

Keep Jeopsok on loopback and use the private-tunnel mechanism provided by your MCP client/vendor. For ChatGPT, OpenAI documents **Secure MCP Tunnel** for MCP servers on local or private networks:

- https://help.openai.com/en/articles/12584461

When a trusted tunnel is responsible for access control, a loopback-only Jeopsok instance can use:

```dotenv
MCP_HOST=127.0.0.1
MCP_ALLOW_NO_AUTH=true
MCP_AUTH_TOKEN=
```

Never use that configuration on a publicly reachable listener.

### Direct HTTPS

For direct internet access, put a real authentication gateway/reverse proxy in front of Jeopsok, or use a client that supports the static bearer token. Jeopsok Core intentionally does **not** ship an authorization server. A production deployment typically looks like:

```text
MCP client -> HTTPS + authentication gateway -> Jeopsok on 127.0.0.1:3000
```

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and the files under [`deploy/`](deploy/).

## Long-running command pattern

Start a command without holding a long MCP request open:

```text
exec_command(cmd="some-long-job", yieldTimeMs=0)
-> { sessionId: "...", running: true }
```

Then poll it from another MCP request:

```text
read_process(sessionId="...", afterSeq=0, waitMs=3000)
```

Use the returned `nextSeq` as the next `afterSeq` to fetch only newer output.

## File transfer

- `read_file` supports UTF-8 or base64.
- `upload_file` writes base64 chunks at exact byte offsets.
- `download_file` returns base64 chunks and `nextOffset`.
- `write_file` is for complete UTF-8/base64 writes or appends.

See [docs/USAGE.md](docs/USAGE.md) for examples.

## Protocol notes

Jeopsok uses `@modelcontextprotocol/server` v2. The modern path is MCP `2026-07-28`, where a client can discover the server with `server/discover` and requests carry their own protocol/client metadata instead of relying on a long-lived MCP session.

The same endpoint keeps the SDK's **stateless legacy fallback** for 2025-era clients. See [docs/PROTOCOL.md](docs/PROTOCOL.md).

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```


## Project layout

```text
src/
  http-server.ts     modern stateless HTTP entry + legacy fallback
  stdio-server.ts    optional stdio entry
  mcp-server.ts      server metadata + 13-tool registration
  exec-tools.ts      command/process tools
  process-manager.ts retained process handles/output
  file-tools.ts      public file tool schemas
  file-service.ts    filesystem implementation

deploy/              systemd + Nginx examples
docs/                usage, deployment, protocol notes
```

## Origin and license

Jeopsok began from the MIT-licensed [`kstost/cokacremote`](https://github.com/kstost/cokacremote) codebase. The original copyright notice is preserved in [LICENSE](LICENSE), with additional Jeopsok changes documented in [NOTICE.md](NOTICE.md).

MIT License.
