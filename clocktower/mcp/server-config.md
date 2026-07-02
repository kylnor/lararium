# Clocktower MCP Server: Configuration Reference

This document describes how the Clocktower HTTP MCP server is structured,
what it expects at startup, and how clients connect. All credentials and
hostnames are replaced with `<PLACEHOLDER>`.

---

## Transports

Two transports are supported. Run both in one process or either independently.

### HTTP (for remote clients, cloud agents, hooks)

The HTTP MCP server listens on `CLOCKTOWER_PORT` (default: `3000`). It
exposes a single endpoint for MCP-over-SSE.

```
POST https://<your-host>/mcp
Authorization: Bearer <CLOCKTOWER_TOKEN_WRITE | CLOCKTOWER_TOKEN_READ | CLOCKTOWER_TOKEN_ADMIN>
Content-Type: application/json
```

Token tier determines which tool tier is accessible:
- `CLOCKTOWER_TOKEN_READ`: read-tier tools only
- `CLOCKTOWER_TOKEN_WRITE`: read + write tier
- `CLOCKTOWER_TOKEN` (admin/full): all three tiers including admin tools

Agents dispatched with shell access use the authenticated shell helper
(`ct.sh <tool_name> '<json_args>'`) which wraps the HTTP transport with the
appropriate token from environment. Cloud agents with no shell access connect
via an MCP client pointed at the HTTP URL.

### Stdio (for local CLI / trusted-machine only)

The stdio MCP binary is invoked directly by the host's MCP client (e.g.,
Claude Desktop or a `.mcp.json` config). It runs in-process on the local
machine and has access to the admin tier.

```json
{
  "mcpServers": {
    "clocktower": {
      "command": "node",
      "args": ["/path/to/clocktower/packages/array/dist/index.js", "--stdio"],
      "env": {
        "DATABASE_URL": "<PLACEHOLDER>",
        "CLOCKTOWER_TOKEN": "<PLACEHOLDER>",
        "GEMINI_API_KEY": "<PLACEHOLDER>"
      }
    }
  }
}
```

Stdio transport additionally exposes local filesystem tools (file read/write,
shell exec with confirmation) that the HTTP transport does not expose.

---

## Authorization Model

Tools are bucketed into three tiers. The server checks the bearer token on
each request and restricts the tool list accordingly.

```
read   < write  < admin
```

- A write-tier token can call read tools.
- An admin-tier token can call all tools.
- An unrecognized or absent token gets a 401.

The staging token (`CLOCKTOWER_TOKEN_STAGING`) is a special write-tier token
scoped so that Huginn (the gatherer agent) can write to a staging workspace
partition without being able to access or mutate live knowledge. Muninn (the
gating curator) holds a full write token and can promote from staging to live.

---

## CORS

Set `CLOCKTOWER_CORS_ORIGINS` to a comma-separated list of allowed origins if
browser clients or Cloudflare workers need cross-origin access to the HTTP
endpoint. Leave blank to disallow all non-same-origin requests.

---

## Webhook Routing

The server accepts incoming webhooks at `/webhook/:route_id`. Routes are
registered via the `clocktower_webhook_route_upsert` admin tool. Each route
specifies a target tool to invoke, a secret for HMAC verification, and an
event filter. Verification uses `CLOCKTOWER_WEBHOOK_SECRET` as the signing
key base.

---

## Health

`GET /health` returns `200 OK` with `{"status":"ok","uptime":<seconds>}`.
Use this as the liveness probe for any reverse proxy or process monitor.

---

## Deployment

The reference deployment uses a container image on a managed hosting platform
(the original uses Fly.io; adapt to your own). The server expects:

1. `DATABASE_URL` pointing at a Postgres instance with pgvector enabled.
2. All token env vars populated.
3. `GEMINI_API_KEY` for embedding generation (read the schema doc: all
   embeddings must use the same model or cross-corpus recall silently
   degrades).

If `CLOCKTOWER_PUBLIC_URL` is set, the server includes it in the MCP
capability advertisement so remote clients can self-discover the endpoint.

---

## Local `.mcp.json` pattern

```json
{
  "mcpServers": {
    "clocktower-remote": {
      "type": "http",
      "url": "https://<your-host>/mcp",
      "headers": {
        "Authorization": "Bearer <CLOCKTOWER_TOKEN>"
      }
    },
    "clocktower-local": {
      "command": "node",
      "args": ["<path-to-dist>/index.js", "--stdio"],
      "env": {
        "DATABASE_URL": "<PLACEHOLDER>",
        "CLOCKTOWER_TOKEN": "<PLACEHOLDER>",
        "GEMINI_API_KEY": "<PLACEHOLDER>"
      }
    }
  }
}
```

Keep one HTTP entry (for agents and hooks running anywhere) and one stdio
entry (for your local machine session, which gets admin tier + local tools).
Do not commit this file with real tokens. Reference `.env` from the build
step or your secrets manager.
