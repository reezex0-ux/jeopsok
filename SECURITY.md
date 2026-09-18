# Security model

Jeopsok v0.3 is **safe by default, not a sandbox**. Permission profiles reduce the registered MCP capability surface, but the operating-system account remains the final host security boundary.

## Permission profiles

| Profile | Filesystem | Commands/processes | CodeAct |
| --- | --- | --- | --- |
| `readonly` | read-only inside allowed roots | disabled | disabled |
| `workspace` (default) | read/write/transfer/delete inside allowed roots | disabled | disabled |
| `operator` | workspace-restricted | allowlisted executables | disabled |
| `full` | unrestricted | unrestricted | optional, unrestricted |

For every profile except `full`, `JEOPSOK_ALLOWED_ROOTS` is enforced against normalized paths and resolved symlink targets.

`operator` is a command capability policy, not a filesystem sandbox. An allowed program may itself access arbitrary files, start subprocesses, load plugins, or execute scripts. Allowing interpreters, shells, package managers, container runtimes, or service managers may effectively grant broad host access.

CodeAct is deliberately registered only in `full`. Persistent Python has broad language and process capabilities and would otherwise bypass the guarantees of `readonly`, `workspace`, or `operator`.

## Authentication

Jeopsok supports three deployment postures:

- static bearer authentication;
- built-in OAuth 2.1 with DCR + Authorization Code/PKCE;
- no local authentication only when an upstream private tunnel or gateway is the actual authentication boundary.

For OAuth deployments, prefer a dedicated `MCP_OAUTH_APPROVAL_KEY` and leave `MCP_AUTH_TOKEN` empty unless a static bearer fallback is intentionally required. OAuth state contains registered clients and hashed token records; keep `MCP_OAUTH_STATE_FILE` on private storage with restrictive permissions.

Do not expose `MCP_ALLOW_NO_AUTH=true` directly to an untrusted network.

## Recommended deployment

1. Keep the default `workspace` profile unless commands are required.
2. Run Jeopsok as a dedicated non-root OS user.
3. Bind to `127.0.0.1` behind a trusted proxy/tunnel unless direct listening is intentional.
4. Use HTTPS for every internet-facing deployment.
5. Use `operator` with a small executable allowlist rather than `full` when possible.
6. Use `full` and CodeAct only on a host, VM, or container where remote shell-equivalent authority is intentional.
7. Keep OAuth state, CodeAct checkpoints/logs, tokens, and private keys out of public repositories and bug reports.

Authentication controls **who can call Jeopsok**. Permission profiles control **which Jeopsok capabilities are exposed**. OS permissions, containers/VMs, network policy, and the capabilities of allowed executables remain the ultimate security boundary.
