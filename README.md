# 접속 — Jeopsok

**Jeopsok (접속)** is a safe-by-default remote agent runtime for MCP clients. It combines a small stateless MCP tool surface with explicit workload handles, permission profiles, built-in OAuth 2.1, and optional persistent Python CodeAct sessions.

Jeopsok targets MCP `2026-07-28` over Streamable HTTP while retaining the SDK's stateless compatibility path for older clients.

## v0.3 highlights

- Safe permission profiles remain the default: `readonly`, `workspace`, `operator`, `full`
- Built-in OAuth 2.1 authorization server with DCR, Authorization Code + PKCE (S256), refresh rotation, revocation, and protected-resource metadata
- Persistent CodeAct Python sessions for multi-step work without repeated MCP round trips
- Interactive vs. unattended CodeAct run modes with configurable budgets and checkpoints
- Structured MCP request logs and `X-Request-Id` tracing
- Linux and native Windows command execution

```text
MCP client
   |
   | HTTPS / Streamable HTTP
   v
Jeopsok
   |
   +-- authentication: bearer and/or OAuth 2.1
   +-- permission profile
   +-- explicit process handles
   +-- filesystem policy
   `-- CodeAct workers (full profile only)
```

## Permission profiles

| Profile | Filesystem | Commands | CodeAct |
| --- | --- | --- | --- |
| `readonly` | read/list/stat/download inside roots | disabled | disabled |
| `workspace` **default** | read/write/transfer/delete inside roots | disabled | disabled |
| `operator` | workspace-restricted | allowlisted executables | disabled |
| `full` | unrestricted | unrestricted | optional |

Profiles change the actual MCP tool catalog. Tools that are outside the selected capability boundary are not registered.

For `readonly`, `workspace`, and `operator`, `JEOPSOK_ALLOWED_ROOTS` is enforced against normalized paths and resolved symlink targets. If omitted, it defaults to `MCP_DEFAULT_CWD`.

`operator` requires `JEOPSOK_ALLOWED_COMMANDS`. This is a capability allowlist, not a sandbox: allowing an interpreter, shell, container runtime, package manager, or service manager can provide broader host access than the filesystem profile suggests.

## Tools

Filesystem tools:

- `list_directory`, `stat_path`, `read_file`, `download_file`
- `write_file`, `replace_in_file`, `upload_file`, `remove_path` outside readonly

Command/process tools in `operator` and `full`:

- `exec_command`
- `write_stdin`, `read_process`, `terminate_process`, `list_processes`

CodeAct tools in `full` when `MCP_CODEACT_ENABLED=true`:

- `python_session_create`
- `python_action`
- `python_inspect`
- `python_session_close`

CodeAct keeps Python variables alive across calls and exposes `host.files`, `host.process`, and `host.system`. It is intentionally restricted to `full`: exposing unrestricted Python in `workspace` or `operator` would bypass those profiles.

## Quick start

```bash
git clone https://github.com/reezex0-ux/jeopsok.git
cd jeopsok
npm ci
npm run build

mkdir -p "$HOME/jeopsok-workspace"
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
export MCP_HOST=127.0.0.1
export MCP_DEFAULT_CWD="$HOME/jeopsok-workspace"
export JEOPSOK_PROFILE=workspace
npm start
```

Default endpoints:

- MCP: `http://127.0.0.1:3000/mcp`
- health: `http://127.0.0.1:3000/health`

## Authentication

### Static bearer token

```dotenv
MCP_AUTH_TOKEN=<long-random-secret>
MCP_ALLOW_NO_AUTH=false
MCP_OAUTH_ENABLED=false
```

### Built-in OAuth 2.1

For direct HTTPS deployments, Jeopsok can act as its own OAuth authorization server:

```dotenv
MCP_PUBLIC_URL=https://mcp.example.com
MCP_OAUTH_ENABLED=true
MCP_OAUTH_APPROVAL_KEY=<separate-long-random-secret>
MCP_OAUTH_ISSUER=https://mcp.example.com
MCP_OAUTH_RESOURCE=https://mcp.example.com/mcp
MCP_OAUTH_STATE_FILE=/var/lib/jeopsok/oauth-state.json
MCP_AUTH_TOKEN=
```

The OAuth implementation provides:

- RFC 9728 protected-resource metadata
- RFC 8414 authorization-server metadata
- Dynamic Client Registration
- Authorization Code + PKCE (S256)
- `mcp:tools` scope and resource audience validation
- short-lived access tokens
- rotating refresh tokens with replay detection
- token revocation
- persistent client/token state stored with restrictive file permissions

For OAuth-only deployments, leave `MCP_AUTH_TOKEN` empty so there is no permanent static bearer bypass.

### Upstream authentication

If a private tunnel or upstream gateway performs authentication, local checks can be disabled:

```dotenv
MCP_HOST=127.0.0.1
MCP_ALLOW_NO_AUTH=true
MCP_AUTH_TOKEN=
MCP_OAUTH_ENABLED=false
```

Do not expose that configuration directly to an untrusted network.

## CodeAct

CodeAct is designed for loops, filtering, aggregation, generated code, retries, and multi-step local computation where repeated primitive MCP calls would be wasteful.

```dotenv
JEOPSOK_PROFILE=full
MCP_CODEACT_ENABLED=true
MCP_CODEACT_MAX_SESSIONS=8
MCP_CODEACT_INTERACTIVE_MAX_ACTIONS=24
MCP_CODEACT_INTERACTIVE_MAX_EXECUTION_CALLS=32
```

`runMode=auto` defaults to interactive and recognizes scheduled/automation/cron metadata or labels as unattended. Interactive sessions receive action/process-call budgets. Unattended sessions are exempt from those interactive limits. Session metadata is checkpointed after actions, but Python memory itself is process-local and is lost when the worker or Jeopsok restarts.

CodeAct is not a sandbox. A `full` CodeAct worker has the same host authority as the Jeopsok process.

## Transport and workload state

Jeopsok is stateless at the MCP transport layer. Requests do not depend on a long-lived MCP protocol session.

Long-running command state is addressed explicitly with process `sessionId` handles. CodeAct uses separate Python-session handles. Both are workload state, not MCP transport sessions, and in-memory state is lost on service restart.

## Observability

Every MCP response receives an `X-Request-Id`. Jeopsok logs structured request records containing the RPC method, tool name, HTTP status, outcome, and duration without logging tool arguments or credentials.

The health endpoint reports profile, authentication mode, active requests, managed processes, CodeAct availability/session count, and OAuth status without exposing configured filesystem root paths.

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

See:

- [Usage](docs/USAGE.md)
- [Deployment](docs/DEPLOYMENT.md)
- [Protocol](docs/PROTOCOL.md)
- [Security model](SECURITY.md)

## Origin and license

Jeopsok began from the MIT-licensed [`kstost/cokacremote`](https://github.com/kstost/cokacremote) codebase. The original copyright notice is preserved in [LICENSE](LICENSE), with additional Jeopsok changes documented in [NOTICE.md](NOTICE.md).

MIT License.
