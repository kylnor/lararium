# Setting up Microsoft Teams ingestion for Lararium

This is a step-by-step guide for wiring Microsoft Teams chats and meeting transcripts into a
Lararium stack as a new watcher, so the assistant sees Teams conversations the same way it already
sees email, calendar, or brain edits. Written for Brittany's setup; assumes Lararium is already
installed and running (brain + clocktower + an assistant session).

## 1. How Lararium ingestion already works (read this first)

Lararium's index layer ("clocktower") pulls in outside sources through **watchers**: small
scheduled jobs (cron, launchd, systemd timer — whatever your machine runs) that each own one
source. Every watcher follows the same loop:

1. Read a `sync_state` row to find the last watermark it processed (a timestamp, a page token, or
   a sequence number — whichever the source's API gives you).
2. Fetch new items from the source since that watermark.
3. Deduplicate against rows already in the target table.
4. Insert the new rows. Anything that needs semantic search gets embedded, either inline for small
   batches or queued for an embedding worker.
5. Update the `sync_state` watermark.
6. If nothing is new, write nothing — a no-op pass must never bump the watermark or re-embed
   existing rows.

Every watcher also writes a freshness heartbeat on every run, including runs that find nothing, so
a dead watcher is distinguishable from a quiet one. That's the full pattern — a Teams watcher is
just this loop pointed at Microsoft Graph instead of Gmail or iMessage.

High-volume, noisy sources (this is likely true of Teams chat) should land in a **staging**
partition first, not straight into the live knowledge base — the same Huginn/Muninn pattern
Lararium uses for email and web captures: the watcher writes candidates to staging, a separate
review pass (human or a gate agent) promotes what's worth keeping into the searchable index. Do
this for Teams unless you want every "sounds good", "on it", and meeting-join notification treated
as durable knowledge.

## 2. What Microsoft's side requires

Teams data comes through **Microsoft Graph**, Microsoft 365's API. To pull chat messages and
meeting transcripts you need an **app registration** in Microsoft Entra ID (the successor name for
Azure AD) on the Microsoft 365 tenant that owns the Teams data — this has to be done by someone
with admin rights on that tenant, or by Microsoft 365 support if it's a managed/business account.

### App registration

1. Sign in to [entra.microsoft.com](https://entra.microsoft.com) with an account that has
   Application Administrator (or Global Administrator) rights on the tenant.
2. Go to **Identity → Applications → App registrations → New registration**.
3. Name it something like `lararium-teams-watcher`. Single tenant is fine unless you need this to
   run across multiple organizations.
4. After creation, note down three values from the app's Overview page — you'll need all three:
   - **Application (client) ID**
   - **Directory (tenant) ID**
   - A **client secret**, created under **Certificates & secrets → New client secret**. Copy the
     secret value immediately; Azure only shows it once.

### API permissions

Under **API permissions → Add a permission → Microsoft Graph**, the permissions depend on whether
the watcher runs unattended (recommended) or on behalf of a signed-in user:

- **Unattended / app-only (client credentials flow), Application permissions:**
  - `Chat.Read.All` — read all chat messages in the tenant
  - `ChannelMessage.Read.All` — read channel messages in Teams
  - `OnlineMeetingTranscript.Read.All` — read meeting transcripts
  - `OnlineMeeting.Read.All` — read meeting metadata (needed to enumerate meetings before pulling
    their transcripts)
  - These are all **Application** (not Delegated) permissions, and all require **admin consent**
    granted by a tenant admin (button on the same page: **Grant admin consent for `<tenant>`**).
    Application-level access to chat and transcript content is treated by Microsoft as sensitive,
    so expect this consent step to require an actual admin, not just the app owner.

- **Delegated (a specific user signs in and the watcher acts as them):** use
  `Chat.Read`, `ChannelMessage.Read.All`, `OnlineMeetingTranscript.Read.All` as Delegated
  permissions instead. Simpler consent (the signing-in user can often consent for themselves) but
  the watcher only ever sees that one user's chats and meetings, and needs a refresh token kept
  alive rather than a static secret.

For a whole-tenant pull run by an unattended watcher, application permissions + admin consent is
the right shape. For "just pull my own Teams data," delegated is simpler and needs less from IT.

### Auth flow

- **App-only (client credentials grant):** the watcher authenticates directly with its client ID +
  client secret + tenant ID against
  `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`, requesting scope
  `https://graph.microsoft.com/.default`. No user interaction, no token refresh flow to babysit
  beyond re-requesting a token (they expire hourly, just fetch a fresh one each run). This is the
  flow that matches Lararium's cron-driven watcher model.
- **Delegated (auth code + refresh token):** requires a one-time interactive sign-in to get the
  first token, then the watcher refreshes it going forward. More moving parts, more to break
  silently when a refresh token expires or gets revoked. Only use this if the tenant admin won't
  grant application permissions.

Recommendation: app-only. It's the only flow that fits the "runs on a schedule with nobody
watching it" model the rest of Lararium's watchers use.

## 3. Building the watcher

1. Create a `teams_messages` (or similar) table plus a `sync_state` row for it, following the
   shape every other watcher uses — see `clocktower/README.md`'s watcher pattern and
   `clocktower/schema/001_core_schema.sql` for the existing table conventions.
2. Each run:
   - Get a fresh Graph token (client credentials grant, scope `.default`).
   - List chats/channels via `GET /chats` or `GET /teams/{id}/channels/{id}/messages`, and list
     recent online meetings the watermark hasn't seen yet.
   - For each meeting, pull its transcript via
     `GET /me/onlineMeetings/{meetingId}/transcripts` (delegated) or the application equivalent
     under `/users/{userId}/onlineMeetings/{meetingId}/transcripts` — transcript content comes back
     as VTT, which needs parsing into plain text/segments before it's useful as a card.
   - Dedup against what's already stored (message ID / transcript ID are stable Graph identifiers,
     use those, not timestamps).
   - Stage new items (per section 1, route through Huginn-style staging rather than straight to
     live knowledge, given Teams chat volume).
   - Update `sync_state`, write the freshness heartbeat, done.
3. Graph enforces rate limits and paginates with `@odata.nextLink` — follow the link, don't assume
   one page has everything.
4. Put the client ID, tenant ID, and client secret in the same credentials file / secrets manager
   the other watchers already use on this machine — never hardcode them in the watcher script.

## 4. What to hand to whoever sets this up

- Tenant ID, client ID, client secret (from the app registration).
- Confirmation admin consent was granted for the four Graph permissions above.
- Whether this is meant to pull one person's Teams data (delegated) or the whole tenant's
  (app-only) — that decision changes both the permission set and the auth flow, so settle it
  before registering the app.
