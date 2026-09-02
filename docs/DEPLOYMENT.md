# Deployment guide

## Recommended default: loopback + private tunnel

For a workstation, home server, or private-network host, bind Jeopsok to loopback:

```dotenv
MCP_HOST=127.0.0.1
MCP_PORT=3000
MCP_ALLOW_NO_AUTH=true
MCP_AUTH_TOKEN=
```

Then point a trusted tunnel/runtime at:

```text
http://127.0.0.1:3000/mcp
```

`MCP_ALLOW_NO_AUTH=true` is appropriate only when the listener is unreachable except through a trusted access-control layer.

OpenAI documents Secure MCP Tunnel for ChatGPT connections to local/private MCP servers:

- https://help.openai.com/en/articles/12584461

Product UI and plan availability can change; follow current vendor documentation rather than old screenshots.

## Direct internet access

Jeopsok Core intentionally does not implement an authorization server. Keep Jeopsok on loopback and put a production HTTPS/authentication gateway in front of it, or use a client that supports Jeopsok's static bearer token.

```text
MCP client -> HTTPS/auth gateway -> 127.0.0.1:3000 -> Jeopsok
```

If the gateway is the authentication boundary, configure Jeopsok as:

```dotenv
MCP_HOST=127.0.0.1
MCP_ALLOW_NO_AUTH=true
MCP_AUTH_TOKEN=
```

Never expose that listener directly to the public network.

## Static bearer mode

For MCP clients that support a static bearer token:

```dotenv
MCP_HOST=127.0.0.1
MCP_AUTH_TOKEN=<long-random-secret>
MCP_ALLOW_NO_AUTH=false
```

Send:

```text
Authorization: Bearer <token>
```

Use HTTPS whenever the bearer token crosses a network you do not fully control.

## systemd example

1. Create a dedicated `jeopsok` OS user.
2. Install the project under `/opt/jeopsok`.
3. Create a workspace owned by that user, for example `/srv/jeopsok-workspace`.
4. Copy `deploy/jeopsok.env.example` to `/etc/jeopsok.env` and set real values.
5. Install `deploy/jeopsok.service`.
6. Put Nginx/Caddy/another gateway in front of `127.0.0.1:3000` if remote access is required.

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

## Service updates

```bash
cd /opt/jeopsok
sudo npm ci
sudo npm run build
sudo npm prune --omit=dev
sudo systemctl restart jeopsok
curl http://127.0.0.1:3000/health
```

## Threat model reminder

Jeopsok authentication controls **who may call tools**. It does not restrict **what those tools may do** after authorization. OS users, filesystem permissions, VM/container boundaries, and network policy are the real execution sandbox.
