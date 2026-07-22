# Clocktower MCP Tool Surface

Complete tool inventory, organized by authorization tier.
All tools are exposed over HTTP unless noted [stdio only].

Agents call tools via the MCP protocol directly, or via a small authenticated
shell wrapper you write (a curl POST to the HTTP endpoint with the bearer token
from your environment; give it a signature like `<tool_name> '<json_args>'` and
subagents without a native MCP binding can reach the index too).

---

## Read Tier

Available to all authenticated sessions (read-token or higher).

### Memory and knowledge retrieval

| Tool | Purpose |
|---|---|
| `clocktower_search` | Keyword full-text search across knowledge (FTS only, no embeddings) |
| `clocktower_recall` | The default retrieval front door: hybrid keyword + vector fan-out across every corpus |
| `clocktower_find` | Find a specific item by ID or exact title |
| `clocktower_knowledge_query` | Filtered knowledge query (by project, type, status, confidence) |
| `library_ask` | Ask a question against the document library (books, clippings, research) |
| `library_summarize` | Summarize a specific library source |
| `library_list` | List all library sources available |
| `clocktower_clippings_search` | Search saved clippings and bookmarks |
| `clocktower_attachments_search` | Search indexed email/message attachments |
| `clocktower_audio_logs_search` | Search transcribed audio/meeting logs |
| `clocktower_brain_captures_search` | Search captures ingested from quick-capture tools |

### Session and conversation retrieval

| Tool | Purpose |
|---|---|
| `clocktower_search_sessions` | Keyword/semantic search across session history |
| `clocktower_session_scroll` | Page through messages in a specific session |
| `clocktower_list_sessions` | List sessions with metadata (date, model, title, cost) |
| `clocktower_session_briefing` | Generate a structured briefing on recent sessions and open threads |

### Projects and tasks

| Tool | Purpose |
|---|---|
| `clocktower_project_list` | List projects with status, category, and open task counts |
| `clocktower_project_get` | Get a specific project's full record |
| `clocktower_project_packet` | Full context packet for a project (tasks, knowledge, goals, recent sessions) |
| `clocktower_goal_list` | List goals by quarter and sphere |
| `clocktower_task_search` | Search tasks across projects by keyword or status |
| `clocktower_task_deps` | Get the dependency graph for a specific task |

### Strategy and playbook

| Tool | Purpose |
|---|---|
| `clocktower_strategy_query` | Query historical strategy records for a domain |
| `clocktower_playbook_query` | Query distilled playbook insights for a domain/scope |

### System status and intelligence

| Tool | Purpose |
|---|---|
| `clocktower_status` | Server health, sync state, watcher freshness |
| `clocktower_watcher_status` | Per-watcher sync health and last-run timestamps |
| `clocktower_anticipate` | Generate a proactive recommendation from current context |
| `clocktower_analytics_summary` | Summary of session activity, tool use, and cost over a window |
| `clocktower_blast_radius` | Estimate impact of a proposed change across projects |

### Messaging and classification

| Tool | Purpose |
|---|---|
| `clocktower_webhook_route_list` | List configured webhook routes |
| `clocktower_telegram_thread_get` | Get a Telegram thread by ID (personal OS) |
| `clocktower_telegram_thread_history` | Get message history for a Telegram thread (personal OS) |
| `clocktower_classification_review` | Review pending classification queue items |

---

## Write Tier

Available to sessions with write token or higher.

### Knowledge capture

| Tool | Purpose |
|---|---|
| `clocktower_remember` | Write a durable knowledge item (fact, pattern, lesson, etc.) |
| `clocktower_capture` | Capture a raw item to the staging workspace for Muninn to review |
| `clocktower_knowledge_capture` | Structured knowledge capture with full metadata |
| `clocktower_knowledge_pin` | Pin a knowledge item (boost access priority, prevent decay) |

### Session management

| Tool | Purpose |
|---|---|
| `clocktower_create_session` | Open a new session record |
| `clocktower_end_session` | Close and flush a session with summary |
| `clocktower_log_exchange` | Log a user/assistant exchange to a session |
| `clocktower_log_decision` | Log a decision made in a session |

### Projects and tasks

| Tool | Purpose |
|---|---|
| `clocktower_project_upsert` | Create or update a project record |
| `clocktower_task_add` | Add a task to a project |
| `clocktower_task_update` | Update task status or details |
| `clocktower_task_dep_add` | Add a dependency edge between tasks |
| `clocktower_task_dep_remove` | Remove a dependency edge |

### Strategy

| Tool | Purpose |
|---|---|
| `clocktower_strategy_log` | Log a new strategy (domain, name, description, tags) |
| `clocktower_strategy_rate` | Rate an executed strategy (outcome score + notes) |
| `clocktower_experiment_propose` | Propose an A/B experiment between two strategies |

### Library

| Tool | Purpose |
|---|---|
| `library_mark_read` | Mark a library source as read |

---

## Admin Tier

Available to sessions with admin/full token only. Destructive or
identity-sensitive operations. Do not expose to general agent dispatches.

### Soul (identity layer)

| Tool | Purpose |
|---|---|
| `clocktower_soul_get` | Read one or all sections of the assistant's identity/voice spec |
| `clocktower_soul_update` | Overwrite a section of the soul spec (requires explicit approval) |

### Knowledge lifecycle

| Tool | Purpose |
|---|---|
| `clocktower_knowledge_forget` | Hard-delete a knowledge item |
| `clocktower_knowledge_decay` | Apply time-based decay scoring across the knowledge corpus |
| `clocktower_knowledge_lifecycle` | Run the full knowledge lifecycle pass (decay + consolidate + archive) |
| `clocktower_knowledge_consolidate` | Merge or supersede duplicate/stale knowledge items |

### Staging curation

| Tool | Purpose |
|---|---|
| `clocktower_staging_review` | Inspect, approve, reject, or modify items in the staging workspace |

### Webhooks

| Tool | Purpose |
|---|---|
| `clocktower_webhook_route_upsert` | Create or update a webhook route (event filter, target tool, secret) |

---

## Stdio-Only Tools

These tools are only available in the local stdio transport (not HTTP). They
give the local session controlled filesystem and shell access. The HTTP
transport intentionally omits them.

| Tool | Purpose |
|---|---|
| `local_file_read` | Read a file from the local filesystem |
| `local_file_write` | Write a file to the local filesystem (with confirmation) |
| `local_shell` | Run a shell command on the local machine (with confirmation) |

---

## Notes

- Tools that reference personal-OS corpora (Telegram, audio logs, attachments,
  email) are only useful if `CLOCKTOWER_PERSONAL_OS=1` and the corresponding
  watcher has run at least once. They return empty results otherwise.
- The `clocktower_capture` tool writes to the staging workspace. Items there
  are NOT in the live knowledge base until a Muninn pass promotes them.
- The staging token (`CLOCKTOWER_TOKEN_STAGING`) authorizes `clocktower_capture`
  but NOT `clocktower_staging_review` (that requires full write or admin).
- Vector (semantic) search lives in `clocktower_recall`'s fan-out and the
  per-corpus `*_search` tools. `clocktower_search` is keyword-only (FTS), no
  embeddings. Run the embedding pass after bulk ingestion so new items are
  searchable.
- If a semantic recall returns unexpectedly empty, check your embedder is
  actually running. A missing or dead embedder can make vector scopes return
  nothing; a healthy setup reports those scopes as degraded rather than
  silently returning zero and claiming it searched.
