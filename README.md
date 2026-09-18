# 접속 — Jeopsok

**Jeopsok (접속)** is a safe-by-default remote agent runtime for MCP clients. It combines a small stateless MCP tool surface with explicit workload handles, permission profiles, external OAuth resource-server authentication, and optional persistent Python CodeAct sessions.

Jeopsok targets MCP `2026-07-28` over Streamable HTTP while retaining the SDK's stateless compatibility path for older clients.

## v0.4 highlights

- Removed `@modelcontextprotocol/server-legacy`
- Jeopsok no longer acts as an OAuth Authorization Server
- External OAuth access tokens are verified as JWTs with issuer, audience, expiry, JWKS signature, and required scopes
- RFC 9728 protected-resource metadata points clients to the external Authorization Server
- `/register`, `/authorize`, `/token`, and `/revoke` are no longer exposed by Jeopsok
- Static Bearer authentication remains available for simple/private deployments
- Safe permission profiles remain the default: `readonly`, `workspace`, `operator`, `full`
- No-auth HTTP serving fails closed unless `MCP_HOST` is loopback
- CodeAct unattended mode can be enabled only by server-owned `MCP_RUN_MODE=unattended`
- Persistent CodeAct Python sessions, request tracing, native Windows execution, and process handles remain available

The MCP TypeScript SDK v2 recommends new servers act as OAuth resource servers and use a dedicated identity provider for authorization-server duties. Jeopsok v0.4 follows that model.

```text
MCP client
   |
   | obtains token from external Authorization Server / IdP
   v
external IdP
   |
   | signed JWT access token
   v
Jeopsok
   |
   +-- verify issuer / audience / JWKS / expiry / scopes
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

Profiles change the actual MCP tool catalog. Tools outside the selected capability boundary are not registered.

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

CodeAct keeps Python variables alive across calls and exposes `host.files`, `host.process`, and `host.system`. It is intentionally restricted to `full`: unrestricted Python would bypass the narrower profiles.

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

Use this for private networks or clients that can provide a fixed Bearer token:

```dotenv
MCP_AUTH_TOKEN=<long-random-secret>
MCP_ALLOW_NO_AUTH=false
MCP_OAUTH_ENABLED=false
```

### External OAuth Resource Server

Jeopsok v0.4 does **not** issue OAuth tokens. Configure an external Authorization Server / IdP that owns login, consent, DCR if needed, PKCE, refresh tokens, revocation, and token issuance.

Jeopsok verifies JWT access tokens with a remote JWKS:

```dotenv
MCP_PUBLIC_URL=https://mcp.example.com
MCP_AUTH_TOKEN=
MCP_ALLOW_NO_AUTH=false

MCP_OAUTH_ENABLED=true
MCP_OAUTH_ISSUER=https://idp.example.com/
MCP_OAUTH_JWKS_URL=https://idp.example.com/.well-known/jwks.json
MCP_OAUTH_RESOURCE=https://mcp.example.com/mcp
MCP_OAUTH_AUDIENCE=https://mcp.example.com/mcp
MCP_OAUTH_REQUIRED_SCOPES=mcp:tools
```

Validation includes:

- JWT signature against `MCP_OAUTH_JWKS_URL`
- exact issuer match against `MCP_OAUTH_ISSUER`
- audience match against `MCP_OAUTH_AUDIENCE`
- token expiration
- client identity from `client_id`, `azp`, or `sub`
- all scopes listed in `MCP_OAUTH_REQUIRED_SCOPES`

Jeopsok serves RFC 9728 protected-resource metadata at:

- `/.well-known/oauth-protected-resource`
- `/.well-known/oauth-protected-resource/mcp` for the default endpoint

The metadata advertises the external issuer. The issuer must provide the authorization-server behavior required by your MCP client. For ChatGPT or other clients that rely on dynamic registration, configure an external IdP that supports the required flow.

### Upstream authentication

If a private tunnel or upstream gateway is the actual authentication boundary, local checks can be disabled:

```dotenv
MCP_HOST=127.0.0.1
MCP_ALLOW_NO_AUTH=true
MCP_AUTH_TOKEN=
MCP_OAUTH_ENABLED=false
```

Jeopsok rejects unauthenticated HTTP mode on non-loopback listeners.

## CodeAct

CodeAct is designed for loops, filtering, aggregation, generated code, retries, and multi-step local computation where repeated primitive MCP calls would be wasteful.

```dotenv
JEOPSOK_PROFILE=full
MCP_CODEACT_ENABLED=true
MCP_CODEACT_MAX_SESSIONS=8
MCP_CODEACT_INTERACTIVE_MAX_ACTIONS=24
MCP_CODEACT_INTERACTIVE_MAX_EXECUTION_CALLS=32
```

`runMode=auto` defaults to interactive. Client-provided labels, request metadata, and `runMode=unattended` cannot remove interactive budgets. Only server-owned `MCP_RUN_MODE=unattended` may create unattended sessions.

Session metadata is checkpointed after actions, but Python memory itself is process-local and is lost when the worker or Jeopsok restarts.

CodeAct is not a sandbox. A `full` CodeAct worker has the same host authority as the Jeopsok process.

## Transport and workload state

Jeopsok is stateless at the MCP transport layer. Requests do not depend on a long-lived MCP protocol session.

Long-running command state is addressed explicitly with process `sessionId` handles. CodeAct uses separate Python-session handles. Both are workload state, not MCP transport sessions, and in-memory state is lost on service restart.

## Observability

Every MCP response receives an `X-Request-Id`. Jeopsok logs structured request records containing the RPC method, tool name, HTTP status, outcome, and duration without logging tool arguments or credentials.

The health endpoint reports profile, authentication mode, active requests, managed processes, CodeAct availability/session count, and OAuth resource-server status without exposing configured filesystem root paths.

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
