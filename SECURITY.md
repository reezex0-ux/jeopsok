# Security model

Jeopsok v0.2 is **safe by default, not a sandbox**. The server enforces a permission profile before registering tools and before resolving filesystem paths, but the operating-system account remains the final security boundary.

## Permission profiles

| Profile | Filesystem | Commands/processes |
| --- | --- | --- |
| `readonly` | read-only inside allowed roots | disabled |
| `workspace` (default) | read/write/transfer/delete inside allowed roots | disabled |
| `operator` | workspace-restricted file tools | only executables in `JEOPSOK_ALLOWED_COMMANDS` |
| `full` | unrestricted | unrestricted |

For all profiles except `full`, `JEOPSOK_ALLOWED_ROOTS` is enforced against both lexical paths and resolved symlink targets. If omitted, it defaults to `MCP_DEFAULT_CWD`.

`operator` is a **command capability policy**, not a filesystem sandbox. An allowed program may itself access arbitrary files, start subprocesses, load plugins, or run scripts. For example, allowing `python`, `bash`, `npm`, `git`, `docker`, or a service manager can be equivalent to granting broad host access. Only allow executables whose capabilities you understand.

Operator mode additionally rejects shell control syntax (`;`, pipes, redirects, command substitution, etc.), custom shell overrides, login shells, and environment-variable overrides not named in `JEOPSOK_ALLOWED_ENV`. These checks reduce accidental privilege expansion but cannot make a powerful allowed executable safe.

## Recommended deployment

1. Keep the default `workspace` profile unless command execution is genuinely required.
2. Run Jeopsok as a dedicated non-root user.
3. Bind to `127.0.0.1` unless a trusted reverse proxy is deliberately used.
4. Use a trusted private tunnel, or HTTPS plus strong authentication.
5. Do not set `MCP_ALLOW_NO_AUTH=true` on a publicly reachable listener.
6. Use a VM/container/dedicated worker when an agent must be isolated from the host.
7. Use `full` only when you intentionally want remote shell-equivalent authority.

Authentication answers **who may call the server**. Permission profiles constrain **which Jeopsok capabilities are exposed**, but OS permissions, containers/VMs, network policy, and the capabilities of allowlisted commands remain the ultimate boundary.

Do not include secrets, tokens, private keys, or production data in public bug reports.
