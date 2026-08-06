# Setting up Microsoft Teams ingestion for Lararium

This is a step-by-step guide for wiring Microsoft Teams chats and meeting transcripts into a
Lararium stack as a new watcher, so the assistant sees Teams conversations the same way it already
sees email, calendar, or brain edits. Assumes Lararium is already installed and running
(brain + clocktower + an assistant session).

> **Read section 2.0 before you register anything.** Teams is not email: the data is other people's
> conversations, on an employer's tenant, and the permission set that makes this "just work" is a
> tenant-wide surveillance grant. The default recommendation here is **delegated** access to your
> own data. Application-wide access is documented because sometimes it is genuinely the right call,
> but it is not the starting point and it is not yours to decide alone.

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

## 2.0 Scope this before you build it

The rest of this stack indexes *your* corpora: your email, your calendar, your notes. Teams is the
first source where the data is mostly **other people**, on infrastructure you do not own. That
changes three things, and none of them are technical problems you can solve later.

**Pick the smallest scope that does the job.** Two shapes:

| | Delegated (recommended) | Application (app-only) |
|---|---|---|
| Sees | The chats and meetings *you* are in | Every chat and channel message in the tenant |
| Consent | Often you, for yourself | A tenant admin, for everyone |
| Failure mode | A refresh token expires | You have silently built a corporate wiretap |

Almost everyone reading this wants the first one. "Pull my own Teams data into my own brain" is the
actual goal, and delegated does exactly that. The app-only flow is more convenient for a cron job —
that convenience is the only thing it buys you, and it is not worth what it costs.

**If you do need app-only, scope it at the tenant, not in your watcher.** Graph supports
[application access policies](https://learn.microsoft.com/graph/cloud-communications-online-meeting-application-access-policy)
that restrict an app's chat and online-meeting access to a named set of users, and resource-specific
consent (RSC) restricts channel access to teams that have installed your app. Use one of them. A
`.All` permission with no policy behind it means your laptop's cron job can read the CEO's DMs, and
"I only query my own messages" is a property of your code, not of your grant.

**Get consent from people, not just from Entra.** An admin clicking "Grant admin consent" is an
authorization step, not an ethical one. Before ingesting conversations other people are in:

- Tell them. A meeting transcript indexed into a searchable personal knowledge base is not what
  people assume is happening when they hit Join.
- Check your employer's policy on exporting company data to personal systems. This is often a
  fireable thing regardless of whether the API allowed it.
- If you are in the EU/UK or your employer is, this is personal data processing with a works-council
  and GDPR dimension. Lawful basis, data minimisation, and retention are not optional and not yours
  to hand-wave.

**Decide retention before the first sync, not after.** Set a TTL on ingested Teams rows and actually
enforce it with a scheduled delete. A watcher with no retention policy is an append-only archive of
your colleagues' conversations that outlives your job at that company. Staging (section 1) helps
here: promote the handful of things that are durable knowledge and let the rest expire.

**Do not ingest what you would not screenshot.** HR channels, 1:1 DMs you are not part of, anything
health or compensation related. Filter at the watcher, not at query time.

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
the watcher acts as you (recommended) or as the whole tenant:

- **Delegated (recommended: a specific user signs in and the watcher acts as them):** use
  `Chat.Read`, `ChannelMessage.Read.All`, `OnlineMeetingTranscript.Read.All` as **Delegated**
  permissions. The signing-in user can often consent for themselves, and the watcher only ever sees
  that one user's chats and meetings. You maintain a refresh token instead of a static secret, which
  is more moving parts and the correct trade: the blast radius is one person's data, which is the
  data you actually wanted.

- **Application / app-only (client credentials flow) — tenant-wide, read 2.0 first:**
  - `Chat.Read.All` — read all chat messages in the tenant
  - `ChannelMessage.Read.All` — read channel messages in Teams
  - `OnlineMeetingTranscript.Read.All` — read meeting transcripts
  - `OnlineMeeting.Read.All` — read meeting metadata (needed to enumerate meetings before pulling
    their transcripts)
  - These are all **Application** (not Delegated) permissions, and all require **admin consent**
    granted by a tenant admin (button on the same page: **Grant admin consent for `<tenant>`**).
    Microsoft gates these behind an actual admin because they are genuinely dangerous, not because
    the process is bureaucratic. Treat the friction as information, not as an obstacle: if you find
    yourself explaining to an admin why your personal note-taking setup needs to read the whole
    company's messages, that is the system working.
  - If you take this path, pair it with an application access policy or RSC (section 2.0) so the
    grant is narrowed at the tenant. An unscoped `.All` is the wiretap shape.

**Recommendation: delegated.** "Pull my own Teams data" is what almost everyone actually wants, and
delegated does exactly that with consent you can give yourself. Choose app-only only when you have a
real multi-user mandate, an admin who understands what they are approving, a scoping policy, and a
retention policy — and note that at that point you are building an organizational tool that happens
to run on Lararium, not a personal brain.

### Auth flow

- **App-only (client credentials grant):** the watcher authenticates directly with its client ID +
  client secret + tenant ID against
  `https://login.microsoftonline.com/<tenant-id>/oauth2/v2.0/token`, requesting scope
  `https://graph.microsoft.com/.default`. No user interaction, no token refresh flow to babysit
  beyond re-requesting a token (they expire hourly, just fetch a fresh one each run). This is the
  flow that matches Lararium's cron-driven watcher model.
- **Delegated (auth code + refresh token):** requires a one-time interactive sign-in to get the
  first token, then the watcher refreshes it going forward. More moving parts, and a refresh token
  that can expire or be revoked — which is a feature: revocation is how you or your employer turn
  this off, and app-only has no equivalent.

Recommendation: **delegated**, with the refresh token in your secrets manager. Yes, app-only is the
tidier fit for a cron job. Tidiness is not a good reason to hold a tenant-wide read grant on your
colleagues' conversations. Treat a refresh token that occasionally needs re-consenting as the price
of a credential that is scoped to you and can be revoked; write the watcher to fail loud on an
expired token (per the freshness heartbeat in section 1) and re-auth when it does.

## 3. Building the watcher

1. Create a `teams_messages` (or similar) table plus a `sync_state` row for it, following the
   shape every other watcher uses — see `110_clocktower/README.md`'s watcher pattern and
   `110_clocktower/schema/001_core_schema.sql` for the existing table conventions.
   Include a `retention_until` column and a scheduled job that actually deletes on it (section 2.0).
   A watcher with no retention is an append-only archive of other people's conversations that
   outlives your job at that company.
2. Each run:
   - Get a fresh Graph token (refresh-token grant for delegated; client credentials + `.default`
     if you took the app-only path).
   - Apply your exclusion filter *before* insert, not at query time (section 2.0).
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

Settle the scope question first — it changes the permission set, the auth flow, and who has to sign
off, so it is not a detail to discover halfway through:

- **Scope decision, in writing:** one person's data (delegated) or the whole tenant (app-only). If
  app-only, name the application access policy or RSC arrangement that narrows it.
- Tenant ID and client ID. A client secret only if you are on the app-only path; delegated needs an
  interactive sign-in instead, which you do yourself.
- Confirmation of consent for the specific permissions you asked for — and, for app-only, that the
  admin granting it understood it covers everyone's messages, not just yours.
- **Retention:** the TTL you are setting and the job that enforces it.
- **Exclusions:** the channels and chat types the watcher will filter out before insert.

If you cannot fill in the last three, you are not ready to register the app.
