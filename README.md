# 접속 — Jeopsok

**Jeopsok (접속)** is a small, stateless MCP remote runtime for command/process control and filesystem access. The public edition uses the MCP TypeScript SDK v2 and targets MCP `2026-07-28` while keeping the SDK's stateless 2025-era fallback.

**v0.2 is safe by default:** the default `workspace` profile exposes file tools only inside configured roots. Remote command execution is not available unless the operator explicitly selects `operator` or `full`.

```text
MCP client
   |
   | MCP 2026-07-28 / Streamable HTTP
   v
Jeopsok
   |
   +-- permission profile
   +-- process handles (when enabled)
   `-- filesystem roots
```

## Permission profiles

| Profile | Public tools | Filesystem | Commands |
| --- | ---: | --- | --- |
| `readonly` | 4 | read/list/stat/download inside roots | disabled |
| `workspace` **default** | 8 | read/write/transfer/delete inside roots | disabled |
| `operator` | 13 | workspace-restricted file tools | allowlisted executables only |
| `full` | 13 | unrestricted | unrestricted |

Profiles change the **actual MCP tool catalog**. A readonly client does not merely receive permission errors for write/exec tools—the tools are absent from `tools/list`.

For `readonly`, `workspace`, and `operator`, `JEOPSOK_ALLOWED_ROOTS` is enforced against absolute paths, `..` traversal, and resolved symlink targets. If omitted, the root defaults to `MCP_DEFAULT_CWD`.

`operator` requires `JEOPSOK_ALLOWED_COMMANDS`. Jeopsok rejects shell control syntax, login shells, custom shell overrides, and unapproved environment overrides. This is a capability allowlist, not a sandbox: an allowed executable such as `python`, `bash`, `npm`, `docker`, or a service manager may itself provide broad host access. See [SECURITY.md](SECURITY.md).

## Why stateless MCP matters

Jeopsok is stateless at the **MCP transport layer**, not necessarily at the workload layer. Modern requests are independent HTTP exchanges and do not rely on a long-lived MCP protocol session or `Mcp-Session-Id`.

When command tools are enabled, a long-running command can return a Jeopsok `sessionId`. Later independent MCP requests can use that explicit workload handle with `read_process`, `write_stdin`, or `terminate_process`.

```text
exec_command(..., yieldTimeMs=0)
-> { sessionId: "...", running: true }

read_process(sessionId="...")
-> { stdout: "...", running: false }
```

The process handle is Jeopsok runtime state, not MCP transport state. It is lost if the Jeopsok service process restarts.

## Tools

Filesystem tools:

- read: `list_directory`, `stat_path`, `read_file`, `download_file`
- mutate: `write_file`, `replace_in_file`, `upload_file`, `remove_path`

Command/process tools (only `operator` / `full`):

- `exec_command`, `write_stdin`, `read_process`, `terminate_process`, `list_processes`

The deliberately small surface avoids dedicated MCP tools for every host operation. In `full`, and within the explicit capabilities of `operator`, ordinary host operations can be performed through `exec_command`.

## Quick start: safe workspace mode

```bash
git clone https://github.com/reezex0-ux/jeopsok.git
cd jeopsok
npm install
npm run build

mkdir -p "$HOME/jeopsok-workspace"
export MCP_AUTH_TOKEN="$(openssl rand -hex 32)"
export MCP_HOST=127.0.0.1
export MCP_DEFAULT_CWD="$HOME/jeopsok-workspace"
export JEOPSOK_PROFILE=workspace
npm start
```

With no `JEOPSOK_ALLOWED_ROOTS`, workspace mode automatically uses `MCP_DEFAULT_CWD` as its only root.

Default endpoints:

- MCP: `http://127.0.0.1:3000/mcp`
- health: `http://127.0.0.1:3000/health`

Example health fields:

```json
{
  "status": "ok",
  "service": "jeopsok",
  "version": "0.2.0",
  "transportMode": "mcp-2026-stateless",
  "protocolRevision": "2026-07-28",
  "accessProfile": "workspace",
  "filesystemRestricted": true,
  "allowedRootCount": 1,
  "commandExecutionEnabled": false,
  "unrestrictedHostAccess": false
}
```

Health reports the profile and root **count**, not the configured root paths.

## Readonly

```dotenv
JEOPSOK_PROFILE=readonly
MCP_DEFAULT_CWD=/srv/reference
JEOPSOK_ALLOWED_ROOTS=/srv/reference
```

Only `list_directory`, `stat_path`, `read_file`, and `download_file` are exposed.

## Operator

Use operator only when the agent needs specific command capabilities:

```dotenv
JEOPSOK_PROFILE=operator
MCP_DEFAULT_CWD=/srv/project
JEOPSOK_ALLOWED_ROOTS=/srv/project
JEOPSOK_ALLOWED_COMMANDS=git,node
JEOPSOK_ALLOWED_ENV=CI,NODE_ENV
```

A command such as `git status` is permitted; an executable not on the list is rejected. Shell chaining/redirects/substitution are rejected before process creation.

An allowlisted executable can still be powerful. For example, allowing an interpreter effectively gives the agent whatever OS access that interpreter has.

## Full

```dotenv
JEOPSOK_PROFILE=full
```

`full` restores unrestricted command and filesystem behavior. It is an explicit opt-in and should be treated as remote shell-equivalent authority to the Jeopsok OS account.

## Authentication and deployment

Jeopsok supports a static bearer token, or no local auth when it is safely behind a trusted private tunnel/authentication gateway.

For a private/local deployment:

```dotenv
MCP_HOST=127.0.0.1
MCP_ALLOW_NO_AUTH=true
MCP_AUTH_TOKEN=
JEOPSOK_PROFILE=workspace
```

Never expose a no-auth listener directly to an untrusted network. For direct remote access, use HTTPS plus a trusted authentication layer or a client that supports the static bearer token.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) and [SECURITY.md](SECURITY.md).

## Configuration

Key permission settings:

```dotenv
JEOPSOK_PROFILE=workspace
JEOPSOK_ALLOWED_ROOTS=/srv/project,/tmp/agent-share
# operator only:
# JEOPSOK_ALLOWED_COMMANDS=git,node
# JEOPSOK_ALLOWED_ENV=CI,NODE_ENV
```

See [`.env.example`](.env.example) for transport/auth/limit settings.

## Protocol

Jeopsok uses `@modelcontextprotocol/server` v2. Modern HTTP uses MCP `2026-07-28`, including `server/discover` negotiation and per-request protocol/client metadata. The same endpoint retains the SDK's stateless legacy fallback for 2025-era clients.

See [docs/PROTOCOL.md](docs/PROTOCOL.md).

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
  access-policy.ts   permission profiles, root/symlink checks, operator allowlist
  http-server.ts     stateless HTTP entry + legacy fallback
  stdio-server.ts    optional stdio entry
  mcp-server.ts      profile-aware tool registration
  exec-tools.ts      command/process tools
  process-manager.ts retained process handles/output
  file-tools.ts      profile-aware filesystem tools
  file-service.ts    filesystem implementation + root enforcement
docs/                usage, deployment, protocol notes
deploy/              systemd + Nginx examples
```

## Origin and license

Jeopsok began from the MIT-licensed [`kstost/cokacremote`](https://github.com/kstost/cokacremote) codebase. The original copyright notice is preserved in [LICENSE](LICENSE), with additional Jeopsok changes documented in [NOTICE.md](NOTICE.md).

MIT License.
