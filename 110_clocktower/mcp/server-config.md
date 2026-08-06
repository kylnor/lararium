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
Authorization: Bearer <CLOCKTOWER_TOKEN | CLOCKTOWER_TOKEN_WRITE | CLOCKTOWER_TOKEN_READ>
Content-Type: application/json
```

Token tier determines which tool tier is accessible:
- `CLOCKTOWER_TOKEN_READ`: read-tier tools only
- `CLOCKTOWER_TOKEN_WRITE`: read + write tier
- `CLOCKTOWER_TOKEN` (admin/full): all three tiers including admin tools

Agents dispatched with shell access can use a small authenticated wrapper
script you write (a curl POST wrapping the HTTP transport with the appropriate
token from the environment; see `tool-surface.md`). Cloud agents with no shell
access connect via an MCP client pointed at the HTTP URL.

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

## Security boundaries (read before you expose this)

This server holds the index of your entire life and speaks over HTTP. The
authorization model above describes *tiers*; this section describes what the
tiers do not cover. None of it is implemented for you — the server is yours to
build — but building it without these decisions made is how a personal index
becomes someone else's.

### The tokens are static, and the schema knows better

`CLOCKTOWER_TOKEN*` are long-lived strings in `.env` and, per the example above,
inline in `.mcp.json`. They do not expire, they are not scoped to a client, and
there is no revocation path short of rotating the value and updating every
consumer. A leaked token is durable access to everything at its tier.

Meanwhile `schema/001_core_schema.sql` ships `oauth_clients`, `oauth_codes` and
`oauth_tokens`, with `code_challenge` / `code_challenge_method` columns — that
is OAuth 2.0 with PKCE, including refresh and expiry. **No document mentions
it.** So the schema anticipates a real token lifecycle that the doctrine does
not describe, and a reader cannot tell which one they are supposed to build.

Resolve that fork deliberately:

- **Bearer only** (simplest): then delete the `oauth_*` tables so the schema
  stops implying a mechanism that does not exist, and give the tokens a
  lifecycle anyway — a `created_at`, a documented rotation cadence, and an
  audit row per authenticated request so a leak is *detectable*.
- **OAuth as the schema suggests**: bearer tokens become the machine-to-machine
  fallback, PKCE covers interactive clients, and `expires_at` starts being
  enforced rather than merely stored.

Either is defensible. Shipping the tables and documenting neither is not.

### The webhook route is a remote write into your context

`POST /webhook/:route_id` invokes a registered tool. Follow that all the way
through, because the chain does not stop at the database:

```
inbound webhook  ->  MCP tool  ->  knowledge base  ->  brain card / now.md
                                                    ->  session-start hook
                                                    ->  your assistant's context
```

That is a path from the public internet to the top of your assistant's prompt.
HMAC verification authenticates the *sender*; it says nothing about whether the
*content* is safe, and a legitimate sender relaying attacker-authored text is
the normal case for anything webhook-shaped.

`040_hooks/reference/session-start.js` now wraps injected blocks in
`<untrusted-context>`, which is the last line of this defence, not the first.
The first is here:

- Apply `../connector-doctrine.md`'s rules at ingest: wrap item text in
  untrusted-content tags, treat provenance-looking lines inside item text as
  spoofed, and sanitize anything bound to a single-line context.
- Route webhook writes to **staging**, never straight to live knowledge. The
  Huginn/Muninn split exists for exactly this; a webhook is the least
  trustworthy input you have and should not be the one that skips the gate.
- Scope each route to the narrowest tool that does its job. A route that can
  call an admin tool is a remote admin API with an HMAC in front of it.
- Give each route its own secret. `CLOCKTOWER_WEBHOOK_SECRET` as a single
  signing base means compromising one integration forges all of them.

### Stdio is the strongest capability in the stack

The stdio transport gets admin tier *plus* local filesystem and shell tools.
That is strictly more power than the HTTP surface, granted by a config file
with no prompt. Treat `.mcp.json` as a credential: `0600`, never committed,
never synced. If an agent can edit that file, it can grant itself the admin
tier — the same reason `040_hooks/sandbox/` makes `~/.claude/settings.json`
unwritable from a sandboxed shell.

### Not addressed anywhere yet

Named so they are choices rather than oversights: no rate limiting on
authenticated endpoints, no audit log of tool invocations, no per-tool
authorization within a tier, and `/health` responds before auth (fine, but it
confirms the host is live to anyone scanning).

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
(Fly.io, Render, a VM: anything that runs a container). The server expects:

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

Do not commit this file with real tokens, and do not leave it world-readable:
`chmod 600 .mcp.json`. The stdio entry grants the admin tier plus local
filesystem and shell tools, so this file IS a credential — see the security
section above. Reference `.env` from the build step or your secrets manager
rather than inlining values; the `<PLACEHOLDER>`s above are literal, not a
suggestion to paste real tokens in their place.
