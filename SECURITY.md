# Security model

Jeopsok is intentionally a **privileged remote-control runtime**. It can execute shell commands and read, modify, transfer, or delete files with the operating-system permissions of the Jeopsok process. It is not a sandbox.

Recommended deployment:

1. Run Jeopsok as a dedicated non-root user.
2. Bind to `127.0.0.1` unless you deliberately expose it through a reverse proxy.
3. Use a trusted private tunnel, or HTTPS plus strong authentication.
4. Do not set `MCP_ALLOW_NO_AUTH=true` on a publicly reachable listener.
5. Prefer a VM, container, or dedicated worker host when an agent should not have access to the whole machine.
6. Treat MCP access as equivalent to interactive shell access to the Jeopsok service account.

Do not include secrets, tokens, private keys, or production data in public bug reports.
