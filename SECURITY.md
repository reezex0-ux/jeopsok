# Security model

Jeopsok v0.4 is **safe by default, not a sandbox**. Permission profiles reduce the registered MCP capability surface, but the operating-system account remains the final host security boundary.

## Permission profiles

| Profile | Filesystem | Commands/processes | CodeAct |
| --- | --- | --- | --- |
| `readonly` | read-only inside allowed roots | disabled | disabled |
| `workspace` (default) | read/write/transfer/delete inside allowed roots | disabled | disabled |
| `operator` | workspace-restricted | allowlisted executables | disabled |
| `full` | unrestricted | unrestricted | optional, unrestricted |

For every profile except `full`, `JEOPSOK_ALLOWED_ROOTS` is enforced against normalized paths and resolved symlink targets.

`operator` is a command capability policy, not a filesystem sandbox. An allowed program may itself access arbitrary files, start subprocesses, load plugins, or execute scripts. Allowing interpreters, shells, package managers, container runtimes, or service managers may effectively grant broad host access.

CodeAct is deliberately registered only in `full`. Persistent Python has broad language and process capabilities and would otherwise bypass the narrower profiles.

## Authentication

Jeopsok supports three HTTP deployment postures:

- static bearer authentication;
- external OAuth resource-server authentication;
- no local authentication only when a trusted upstream private tunnel or gateway is the actual authentication boundary.

Jeopsok v0.4 is **not** an OAuth Authorization Server. It does not expose DCR, authorization, token, refresh, or revocation endpoints. Those duties belong to a dedicated external Authorization Server / IdP.

When OAuth is enabled, Jeopsok accepts JWT access tokens only after validating:

- signature against `MCP_OAUTH_JWKS_URL`;
- exact issuer against `MCP_OAUTH_ISSUER`;
- audience against `MCP_OAUTH_AUDIENCE`;
- expiration;
- required scopes from `MCP_OAUTH_REQUIRED_SCOPES`.

The IdP must secure its own login, DCR/PKCE, token issuance, refresh, revocation, and registration lifecycle.

`MCP_ALLOW_NO_AUTH=true` is rejected for non-loopback HTTP listeners. `MCP_TRUST_PROXY_HOPS>0` is also rejected unless the Jeopsok listener is loopback, preventing direct clients from bypassing the intended proxy boundary.

CodeAct unattended mode is server-owned. Client labels, request metadata, and explicit tool arguments cannot enable it; only `MCP_RUN_MODE=unattended` in the server environment can remove interactive budgets.

## Recommended deployment

1. Keep the default `workspace` profile unless commands are required.
2. Run Jeopsok as a dedicated non-root OS user.
3. Bind to `127.0.0.1` behind a trusted proxy/tunnel unless direct listening is intentional.
4. Use HTTPS for every internet-facing deployment.
5. Use a mature external IdP for public OAuth rather than embedding an authorization server in Jeopsok.
6. Keep issuer, audience, JWKS, and required-scope values explicit and environment-specific.
7. Use `operator` with a small executable allowlist rather than `full` when possible.
8. Use `full` and CodeAct only on a host, VM, or container where remote shell-equivalent authority is intentional.
9. Keep CodeAct checkpoints/logs, tokens, private keys, and production data out of public repositories and bug reports.

Authentication controls **who can call Jeopsok**. Permission profiles control **which Jeopsok capabilities are exposed**. OS permissions, containers/VMs, network policy, and the capabilities of allowed executables remain the ultimate security boundary.
