# Deployment guide

## Recommended default

For a private deployment, run Jeopsok on loopback as a dedicated non-root user with the `workspace` profile:

```dotenv
MCP_HOST=127.0.0.1
MCP_PORT=3000
MCP_ALLOW_NO_AUTH=true
MCP_AUTH_TOKEN=
MCP_OAUTH_ENABLED=false
JEOPSOK_PROFILE=workspace
MCP_DEFAULT_CWD=/srv/jeopsok-workspace
JEOPSOK_ALLOWED_ROOTS=/srv/jeopsok-workspace
```

Point a trusted private tunnel or authentication gateway at `http://127.0.0.1:3000/mcp`.

## Direct HTTPS + external OAuth

Jeopsok v0.4 acts only as an OAuth Resource Server. Use a dedicated Authorization Server / IdP for login, DCR if required, PKCE, token issuance, refresh, and revocation.

```dotenv
MCP_HOST=127.0.0.1
MCP_PUBLIC_URL=https://mcp.example.com
MCP_ALLOWED_HOSTS=mcp.example.com,127.0.0.1,localhost
MCP_TRUST_PROXY_HOPS=1

MCP_AUTH_TOKEN=
MCP_ALLOW_NO_AUTH=false

MCP_OAUTH_ENABLED=true
MCP_OAUTH_ISSUER=https://idp.example.com/
MCP_OAUTH_JWKS_URL=https://idp.example.com/.well-known/jwks.json
MCP_OAUTH_RESOURCE=https://mcp.example.com/mcp
MCP_OAUTH_AUDIENCE=https://mcp.example.com/mcp
MCP_OAUTH_REQUIRED_SCOPES=mcp:tools

JEOPSOK_PROFILE=workspace
MCP_DEFAULT_CWD=/srv/jeopsok-workspace
JEOPSOK_ALLOWED_ROOTS=/srv/jeopsok-workspace
```

Jeopsok publishes protected-resource metadata pointing clients to `MCP_OAUTH_ISSUER`. The external issuer must provide the authorization-server flow your client expects.

For clients that use Dynamic Client Registration, choose/configure an IdP that supports the required DCR behavior. Jeopsok no longer has `/register`, `/authorize`, `/token`, or `/revoke` endpoints.

Set `MCP_TRUST_PROXY_HOPS=1` only when exactly one trusted reverse proxy is in front of a loopback-bound Jeopsok listener.

## Choosing a permission profile

- `readonly`: reference/search hosts where mutation is unnecessary.
- `workspace`: default for file workflows without shell access.
- `operator`: specific command capabilities through a small executable allowlist.
- `full`: remote shell-equivalent access; optionally includes CodeAct.

For non-full profiles, multiple filesystem roots can be comma-separated:

```dotenv
JEOPSOK_ALLOWED_ROOTS=/srv/project,/srv/shared-input
```

## Full + CodeAct

CodeAct is intentionally unavailable outside `full`.

```dotenv
JEOPSOK_PROFILE=full
MCP_CODEACT_ENABLED=true
MCP_CODEACT_MAX_SESSIONS=8
MCP_CODEACT_INTERACTIVE_MAX_ACTIONS=24
MCP_CODEACT_INTERACTIVE_MAX_EXECUTION_CALLS=32
MCP_CODEACT_LOG_FILE=/var/lib/jeopsok/codeact-actions.jsonl
MCP_CODEACT_RUN_STATE_DIR=/var/lib/jeopsok/runs
# Only set on an unattended worker:
# MCP_RUN_MODE=unattended
```

Use a dedicated worker, VM, or container when granting this level of access.

## systemd example

1. Create a dedicated `jeopsok` OS user.
2. Install under `/opt/jeopsok`.
3. Create the workspace and state directories.
4. Copy `deploy/jeopsok.env.example` to `/etc/jeopsok.env`.
5. Install `deploy/jeopsok.service`.
6. Put HTTPS or a trusted private tunnel in front.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin jeopsok
sudo mkdir -p /opt/jeopsok /srv/jeopsok-workspace /var/lib/jeopsok
sudo chown -R jeopsok:jeopsok /srv/jeopsok-workspace /var/lib/jeopsok

sudo cp -a package.json package-lock.json tsconfig.json src /opt/jeopsok/
cd /opt/jeopsok
sudo npm ci
sudo npm run build
sudo npm prune --omit=dev

sudo cp deploy/jeopsok.env.example /etc/jeopsok.env
sudo chmod 600 /etc/jeopsok.env
sudo editor /etc/jeopsok.env
sudo cp deploy/jeopsok.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jeopsok
```

## Updating

```bash
cd /opt/jeopsok
sudo npm ci
sudo npm run build
sudo npm prune --omit=dev
sudo systemctl restart jeopsok
curl http://127.0.0.1:3000/health
```

Authentication controls who can reach Jeopsok. Permission profiles reduce the exposed capability set. OS users, containers/VMs, network policy, and the capabilities of allowed executables remain the final security boundary.
