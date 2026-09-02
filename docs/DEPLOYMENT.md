# Deployment guide

## Recommended default

Run Jeopsok on loopback as a dedicated non-root user with the `workspace` profile:

```dotenv
MCP_HOST=127.0.0.1
MCP_PORT=3000
MCP_ALLOW_NO_AUTH=true
MCP_AUTH_TOKEN=
JEOPSOK_PROFILE=workspace
MCP_DEFAULT_CWD=/srv/jeopsok-workspace
JEOPSOK_ALLOWED_ROOTS=/srv/jeopsok-workspace
```

Then point a trusted private tunnel/authentication layer at `http://127.0.0.1:3000/mcp`.

`MCP_ALLOW_NO_AUTH=true` is appropriate only when the listener itself is unreachable except through that trusted boundary.

## Choosing a permission profile

- `readonly`: reference/search hosts where mutation is unnecessary.
- `workspace`: default for coding/file workflows without shell access.
- `operator`: only when specific executable capabilities are required. Set `JEOPSOK_ALLOWED_COMMANDS` and keep the list small.
- `full`: only on a worker where remote shell-equivalent access is intentional.

For non-full profiles, multiple filesystem roots can be comma-separated:

```dotenv
JEOPSOK_ALLOWED_ROOTS=/srv/project,/srv/shared-input
```

Roots must already exist when Jeopsok starts.

## Operator example

```dotenv
JEOPSOK_PROFILE=operator
JEOPSOK_ALLOWED_ROOTS=/srv/project
JEOPSOK_ALLOWED_COMMANDS=git,node
JEOPSOK_ALLOWED_ENV=CI,NODE_ENV
```

Do not confuse an executable allowlist with a sandbox. Powerful programs can escape the intent of a narrow filesystem profile by design. Use OS/container/VM isolation for a hard host boundary.

## Direct internet access

Jeopsok Core intentionally does not implement an authorization server. Keep it on loopback behind a production HTTPS/authentication gateway, or use a client that supports the static bearer token.

```text
MCP client -> HTTPS/auth gateway -> 127.0.0.1:3000 -> Jeopsok
```

For static bearer mode:

```dotenv
MCP_AUTH_TOKEN=<long-random-secret>
MCP_ALLOW_NO_AUTH=false
```

Use HTTPS whenever a bearer token crosses an untrusted network.

## systemd example

1. Create a dedicated `jeopsok` OS user.
2. Install under `/opt/jeopsok`.
3. Create `/srv/jeopsok-workspace` owned by that user.
4. Copy `deploy/jeopsok.env.example` to `/etc/jeopsok.env` and edit values.
5. Install `deploy/jeopsok.service`.
6. Put a trusted tunnel or HTTPS/auth gateway in front if remote access is required.

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin jeopsok
sudo mkdir -p /opt/jeopsok /srv/jeopsok-workspace
sudo chown -R jeopsok:jeopsok /srv/jeopsok-workspace

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

Only set `MCP_TRUST_PROXY_HOPS=1` when exactly one trusted reverse proxy is in front of Jeopsok.

## Updating

```bash
cd /opt/jeopsok
sudo npm ci
sudo npm run build
sudo npm prune --omit=dev
sudo systemctl restart jeopsok
curl http://127.0.0.1:3000/health
```

Authentication controls who can reach Jeopsok. Permission profiles reduce the exposed capability set. OS users, containers/VMs, network policy, and the capabilities of allowed executables remain the ultimate security boundary.
