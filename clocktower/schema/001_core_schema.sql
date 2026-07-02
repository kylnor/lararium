-- Clocktower Core Schema
-- Postgres 17 + pgvector 0.8.2
--
-- This file provisions the CORE schema only: the generic MCP memory / session /
-- project / knowledge server that any Clocktower install needs.
--
-- Personal-OS tables (emails, contacts, calendar, messages, files, audio logs,
-- entity/fact intelligence, sync state, health, browsing, etc.) are opt-in and
-- live in a separate migration applied when CLOCKTOWER_PERSONAL_OS=1 is set.
--
-- Migration runner handles transactions. Idempotent via IF NOT EXISTS.
--
-- EMBEDDINGS STANDARD (read before adding any new vector column):
--   Model:      Google Gemini (gemini-embedding-2-preview or equivalent)
--   Dimensions: 768
--   Table:      os_embeddings (source_type, source_id, embedding vector(768))
--   Everything embedded into this index must use the same model or cross-corpus
--   similarity search silently degrades. Do NOT mix OpenAI or other providers
--   into os_embeddings. Add a separate table if you need a second vector space.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================
-- SCHEMA VERSION
-- ============================================================

CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER PRIMARY KEY
);

-- ============================================================
-- SESSIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  flushed_at TEXT NOT NULL,
  cwd TEXT,
  model TEXT,
  turn_count INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  compaction_count INTEGER DEFAULT 0,
  context_pct REAL DEFAULT 0,
  summary TEXT,
  is_swap INTEGER DEFAULT 0,
  title TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_flushed ON sessions(flushed_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);

CREATE TABLE IF NOT EXISTS file_ops (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  file_path TEXT NOT NULL,
  operation TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_ops_session ON file_ops(session_id);
CREATE INDEX IF NOT EXISTS idx_file_ops_path ON file_ops(file_path);

CREATE TABLE IF NOT EXISTS tool_failures (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  tool TEXT NOT NULL,
  error TEXT NOT NULL,
  input TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tool_failures_session ON tool_failures(session_id);

CREATE TABLE IF NOT EXISTS decisions (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_decisions_session ON decisions(session_id);
CREATE INDEX IF NOT EXISTS idx_decisions_category ON decisions(category);

CREATE TABLE IF NOT EXISTS router_stats (
  id SERIAL PRIMARY KEY,
  recorded_at TEXT NOT NULL,
  task TEXT NOT NULL,
  provider TEXT NOT NULL,
  success INTEGER NOT NULL,
  latency_ms INTEGER,
  error TEXT,
  model TEXT,
  input_tokens INTEGER,
  output_tokens INTEGER,
  cost_estimate REAL,
  fallback_from TEXT,
  caller TEXT
);
CREATE INDEX IF NOT EXISTS idx_router_stats_task ON router_stats(task);
CREATE INDEX IF NOT EXISTS idx_router_stats_provider ON router_stats(provider);

CREATE TABLE IF NOT EXISTS exchanges (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project TEXT NOT NULL,
  cwd TEXT,
  timestamp TEXT NOT NULL,
  user_message TEXT NOT NULL,
  assistant_message TEXT NOT NULL,
  parent_uuid TEXT,
  is_sidechain INTEGER DEFAULT 0,
  git_branch TEXT,
  claude_version TEXT,
  source TEXT DEFAULT 'clocktower'
);
CREATE INDEX IF NOT EXISTS idx_exchanges_session ON exchanges(session_id);
CREATE INDEX IF NOT EXISTS idx_exchanges_project ON exchanges(project);
CREATE INDEX IF NOT EXISTS idx_exchanges_cwd ON exchanges(cwd);
CREATE INDEX IF NOT EXISTS idx_exchanges_timestamp ON exchanges(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_exchanges_project_timestamp ON exchanges(project, timestamp);
CREATE INDEX IF NOT EXISTS idx_exchanges_parent_uuid ON exchanges(parent_uuid);
CREATE INDEX IF NOT EXISTS idx_exchanges_claude_version ON exchanges(claude_version);

CREATE TABLE IF NOT EXISTS exchange_tool_calls (
  id TEXT PRIMARY KEY,
  exchange_id TEXT NOT NULL REFERENCES exchanges(id),
  tool_name TEXT NOT NULL,
  key_info TEXT,
  timestamp TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exchange_tool_calls_exchange ON exchange_tool_calls(exchange_id);
CREATE INDEX IF NOT EXISTS idx_exchange_tool_calls_tool ON exchange_tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_timestamp ON exchange_tool_calls(tool_name, timestamp);

CREATE TABLE IF NOT EXISTS projects (
  slug TEXT PRIMARY KEY,
  cwd TEXT,
  display_name TEXT,
  exchange_count INTEGER DEFAULT 0,
  first_seen TEXT,
  last_seen TEXT
);

CREATE TABLE IF NOT EXISTS session_messages (
  id SERIAL PRIMARY KEY,
  from_session TEXT,
  from_title TEXT,
  to_session TEXT,
  message TEXT NOT NULL,
  read_by TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (NOW()::TEXT),
  expires_at TEXT DEFAULT ((NOW() + INTERVAL '24 hours')::TEXT)
);
CREATE INDEX IF NOT EXISTS idx_session_messages_to ON session_messages(to_session);
CREATE INDEX IF NOT EXISTS idx_session_messages_created ON session_messages(created_at);

-- ============================================================
-- SOUL / STRATEGIES / PLAYBOOK
-- ============================================================

CREATE TABLE IF NOT EXISTS soul (
  key TEXT PRIMARY KEY,
  content TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS soul_history (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER NOT NULL,
  changed_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  changed_by TEXT DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS strategies (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  tags TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (NOW()::TEXT),
  UNIQUE(domain, name)
);

CREATE TABLE IF NOT EXISTS strategy_uses (
  id SERIAL PRIMARY KEY,
  strategy_id INTEGER NOT NULL REFERENCES strategies(id),
  session_id TEXT,
  domain TEXT NOT NULL,
  context TEXT DEFAULT '{}',
  outcome_score INTEGER,
  outcome_notes TEXT,
  signals TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (NOW()::TEXT),
  rated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_strategy_uses_strategy ON strategy_uses(strategy_id);
CREATE INDEX IF NOT EXISTS idx_strategy_uses_session ON strategy_uses(session_id);
CREATE INDEX IF NOT EXISTS idx_strategy_uses_domain ON strategy_uses(domain);

CREATE TABLE IF NOT EXISTS playbook (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  scope TEXT NOT NULL,
  insight TEXT NOT NULL,
  confidence REAL,
  based_on INTEGER DEFAULT 0,
  strategy_id INTEGER REFERENCES strategies(id),
  created_at TEXT DEFAULT (NOW()::TEXT),
  updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_playbook_domain ON playbook(domain);
CREATE INDEX IF NOT EXISTS idx_playbook_scope ON playbook(scope);

CREATE TABLE IF NOT EXISTS strategy_experiments (
  id SERIAL PRIMARY KEY,
  domain TEXT NOT NULL,
  hypothesis TEXT NOT NULL,
  control_id INTEGER REFERENCES strategies(id),
  variant_id INTEGER REFERENCES strategies(id),
  status TEXT DEFAULT 'proposed',
  min_samples INTEGER DEFAULT 10,
  conclusion TEXT,
  created_at TEXT DEFAULT (NOW()::TEXT),
  concluded_at TEXT
);

-- ============================================================
-- OAUTH
-- ============================================================

CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_secret TEXT,
  client_name TEXT,
  redirect_uris TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS oauth_codes (
  code TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT,
  code_challenge_method TEXT,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS oauth_tokens (
  access_token TEXT PRIMARY KEY,
  refresh_token TEXT UNIQUE,
  client_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);

-- ============================================================
-- KNOWLEDGE LAYER
-- ============================================================

CREATE TABLE IF NOT EXISTS os_knowledge (
  id SERIAL PRIMARY KEY,
  knowledge_id TEXT UNIQUE NOT NULL DEFAULT (lower(encode(gen_random_bytes(16), 'hex'))),
  finding_type TEXT NOT NULL DEFAULT 'fact'
    CHECK (finding_type IN ('fact', 'pattern', 'technique', 'decision', 'code_snippet', 'reference')),
  source TEXT NOT NULL DEFAULT 'agent'
    CHECK (source IN ('agent', 'conversation', 'capture', 'meeting', 'research', 'manual')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  evidence TEXT,
  source_url TEXT,
  project TEXT,
  topic TEXT,
  tags TEXT,
  sphere TEXT,
  confidence TEXT NOT NULL DEFAULT 'medium'
    CHECK (confidence IN ('low', 'medium', 'high', 'verified')),
  status TEXT NOT NULL DEFAULT 'raw'
    CHECK (status IN ('raw', 'reviewed', 'applied', 'archived')),
  session_id TEXT,
  exchange_id TEXT,
  agent_task_id TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  reviewed_at TEXT,
  applied_at TEXT,
  archived_at TEXT,
  expires_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at TEXT,
  abstract TEXT,
  superseded_by TEXT,
  is_latest INTEGER NOT NULL DEFAULT 1,
  last_referenced TEXT DEFAULT NULL
);
CREATE INDEX IF NOT EXISTS idx_ok_project ON os_knowledge(project);
CREATE INDEX IF NOT EXISTS idx_ok_finding_type ON os_knowledge(finding_type);
CREATE INDEX IF NOT EXISTS idx_ok_source ON os_knowledge(source);
CREATE INDEX IF NOT EXISTS idx_ok_confidence ON os_knowledge(confidence);
CREATE INDEX IF NOT EXISTS idx_ok_status ON os_knowledge(status);
CREATE INDEX IF NOT EXISTS idx_ok_topic ON os_knowledge(topic);
CREATE INDEX IF NOT EXISTS idx_ok_created ON os_knowledge(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ok_session ON os_knowledge(session_id);
CREATE INDEX IF NOT EXISTS idx_ok_project_status_type ON os_knowledge(project, status, finding_type);
CREATE INDEX IF NOT EXISTS idx_ok_access ON os_knowledge(access_count DESC, last_accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_ok_is_latest ON os_knowledge(is_latest);
CREATE INDEX IF NOT EXISTS idx_ok_superseded_by ON os_knowledge(superseded_by);

-- ============================================================
-- AGENTS / AGENT TASKS
-- ============================================================

CREATE TABLE IF NOT EXISTS os_agents (
  id SERIAL PRIMARY KEY,
  agent_id TEXT UNIQUE NOT NULL DEFAULT (lower(encode(gen_random_bytes(16), 'hex'))),
  name TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  persona TEXT,
  category TEXT NOT NULL DEFAULT 'general'
    CHECK (category IN ('engineering', 'content', 'marketing', 'sales', 'design', 'research', 'operations', 'general')),
  sphere TEXT
    CHECK (sphere IS NULL OR sphere IN ('Work', 'Ventures', 'Personal', 'Infrastructure')),
  tools TEXT,
  projects TEXT,
  model TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive', 'archived')),
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);
CREATE INDEX IF NOT EXISTS idx_oa_name ON os_agents(name);
CREATE INDEX IF NOT EXISTS idx_oa_category ON os_agents(category);
CREATE INDEX IF NOT EXISTS idx_oa_status ON os_agents(status);

CREATE TABLE IF NOT EXISTS os_agent_tasks (
  id SERIAL PRIMARY KEY,
  task_id TEXT UNIQUE NOT NULL DEFAULT (lower(encode(gen_random_bytes(16), 'hex'))),
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  task_type TEXT NOT NULL DEFAULT 'execute'
    CHECK (task_type IN ('execute', 'research', 'review', 'handoff', 'qa')),
  instruction TEXT NOT NULL,
  context TEXT,
  project TEXT,
  session_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed', 'cancelled')),
  output TEXT,
  error TEXT,
  parent_task_id TEXT,
  handoff_to TEXT,
  handoff_context TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER
);
CREATE INDEX IF NOT EXISTS idx_oat_agent ON os_agent_tasks(agent_id);
CREATE INDEX IF NOT EXISTS idx_oat_agent_name ON os_agent_tasks(agent_name);
CREATE INDEX IF NOT EXISTS idx_oat_project ON os_agent_tasks(project);
CREATE INDEX IF NOT EXISTS idx_oat_status ON os_agent_tasks(status);
CREATE INDEX IF NOT EXISTS idx_oat_session ON os_agent_tasks(session_id);
CREATE INDEX IF NOT EXISTS idx_oat_parent ON os_agent_tasks(parent_task_id);
CREATE INDEX IF NOT EXISTS idx_oat_handoff ON os_agent_tasks(handoff_to);
CREATE INDEX IF NOT EXISTS idx_oat_created ON os_agent_tasks(created_at DESC);

-- ============================================================
-- PROJECTS / TASKS / GOALS
-- ============================================================

CREATE TABLE IF NOT EXISTS project_categories (
  slug TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

INSERT INTO project_categories (slug, name, sort_order) VALUES
  ('work', 'Work', 10),
  ('personal', 'Personal', 20),
  ('learning', 'Learning', 30),
  ('side-project', 'Side Project', 40),
  ('general', 'General', 50)
ON CONFLICT (slug) DO NOTHING;

CREATE TABLE IF NOT EXISTS os_projects (
  id SERIAL PRIMARY KEY,
  project_id TEXT UNIQUE NOT NULL DEFAULT (lower(encode(gen_random_bytes(16), 'hex'))),
  name TEXT UNIQUE NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  description TEXT,
  category TEXT DEFAULT 'general' REFERENCES project_categories(slug),
  sphere TEXT
    CHECK (sphere IS NULL OR sphere IN ('Work', 'Ventures', 'Personal', 'Infrastructure')),
  repo_path TEXT,
  github_url TEXT,
  production_url TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'maintenance', 'archived')),
  last_touched TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);
CREATE INDEX IF NOT EXISTS idx_op_slug ON os_projects(slug);
CREATE INDEX IF NOT EXISTS idx_op_status ON os_projects(status);
CREATE INDEX IF NOT EXISTS idx_op_category ON os_projects(category);

CREATE TABLE IF NOT EXISTS os_project_tasks (
  id SERIAL PRIMARY KEY,
  task_id TEXT UNIQUE NOT NULL DEFAULT (lower(encode(gen_random_bytes(16), 'hex'))),
  project_id TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo'
    CHECK (status IN ('done', 'todo', 'in_progress', 'blocked')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  assigned_to TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);
CREATE INDEX IF NOT EXISTS idx_opt_project ON os_project_tasks(project_id);
CREATE INDEX IF NOT EXISTS idx_opt_status ON os_project_tasks(status);
CREATE INDEX IF NOT EXISTS idx_opt_sort ON os_project_tasks(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_opt_assigned_to ON os_project_tasks(assigned_to) WHERE assigned_to IS NOT NULL;

CREATE TABLE IF NOT EXISTS os_goals (
  id SERIAL PRIMARY KEY,
  goal_id TEXT UNIQUE NOT NULL DEFAULT (lower(encode(gen_random_bytes(16), 'hex'))),
  title TEXT NOT NULL,
  description TEXT,
  quarter TEXT NOT NULL,
  sphere TEXT CHECK (sphere IS NULL OR sphere IN ('Work', 'Ventures', 'Personal', 'Infrastructure')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'deferred', 'abandoned')),
  review_notes TEXT,
  created_at TEXT NOT NULL DEFAULT (NOW()::TEXT),
  updated_at TEXT NOT NULL DEFAULT (NOW()::TEXT)
);
CREATE INDEX IF NOT EXISTS idx_og_quarter ON os_goals(quarter);
CREATE INDEX IF NOT EXISTS idx_og_status ON os_goals(status);

CREATE TABLE IF NOT EXISTS os_project_goals (
  project_id TEXT NOT NULL,
  goal_id TEXT NOT NULL,
  PRIMARY KEY (project_id, goal_id)
);

-- ============================================================
-- CAPTURES
-- ============================================================

CREATE TABLE IF NOT EXISTS os_brain_captures (
  id SERIAL PRIMARY KEY,
  capture_id TEXT UNIQUE NOT NULL,
  source TEXT NOT NULL DEFAULT 'drafts',
  content TEXT NOT NULL,
  title TEXT,
  captured_at TEXT NOT NULL,
  processed_at TEXT DEFAULT (NOW()::TEXT),
  capture_type TEXT,
  sphere TEXT,
  entities TEXT,
  topics TEXT,
  tags TEXT,
  action_items TEXT,
  sentiment TEXT,
  source_device TEXT,
  source_tags TEXT,
  location_lat REAL,
  location_lon REAL,
  vault_path TEXT,
  filed_at TEXT,
  reduced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_brain_captures_source ON os_brain_captures(source);
CREATE INDEX IF NOT EXISTS idx_brain_captures_type ON os_brain_captures(capture_type);
CREATE INDEX IF NOT EXISTS idx_brain_captures_sphere ON os_brain_captures(sphere);
CREATE INDEX IF NOT EXISTS idx_brain_captures_captured_at ON os_brain_captures(captured_at);
CREATE INDEX IF NOT EXISTS idx_brain_captures_tags ON os_brain_captures(tags);

-- ============================================================
-- INTERNAL / SYNC / MISC
-- ============================================================

CREATE TABLE IF NOT EXISTS sync_state (
  id TEXT PRIMARY KEY,
  watcher TEXT NOT NULL,
  account TEXT NOT NULL DEFAULT 'default',
  watermark TEXT,
  last_sync_at TEXT,
  items_synced INTEGER DEFAULT 0,
  extra_json TEXT,
  UNIQUE(watcher, account)
);

CREATE TABLE IF NOT EXISTS tool_audit (
  id SERIAL PRIMARY KEY,
  tool_name TEXT NOT NULL,
  duration_ms INTEGER,
  status TEXT DEFAULT 'ok',
  input_summary TEXT,
  response_bytes INTEGER,
  error_message TEXT,
  created_at TEXT DEFAULT (NOW()::TEXT)
);
CREATE INDEX IF NOT EXISTS idx_tool_audit_tool ON tool_audit(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_audit_created ON tool_audit(created_at);

CREATE TABLE IF NOT EXISTS activity_log (
  id SERIAL PRIMARY KEY,
  action TEXT NOT NULL,
  details_json TEXT,
  created_at TEXT DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS migrations (
  name TEXT PRIMARY KEY,
  applied_at TEXT DEFAULT (NOW()::TEXT)
);

CREATE TABLE IF NOT EXISTS _meta (key TEXT PRIMARY KEY, value TEXT);

-- ============================================================
-- EMBEDDINGS (pgvector)
-- STANDARD: Google Gemini, 768 dimensions, cosine similarity
-- ============================================================

CREATE TABLE IF NOT EXISTS os_embedding_meta (
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'gemini-embedding-2-preview',
  embedded_at TEXT NOT NULL,
  text_hash TEXT,
  PRIMARY KEY (source_type, source_id)
);

-- Primary embedding table. All sources use this table and must use the same
-- model (Gemini 768d) or cross-corpus semantic recall breaks silently.
CREATE TABLE IF NOT EXISTS os_embeddings (
  id SERIAL PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  embedding vector(768),
  model TEXT DEFAULT 'gemini-embedding-2-preview',
  embedded_at TEXT DEFAULT (NOW()::TEXT),
  UNIQUE(source_type, source_id)
);
CREATE INDEX IF NOT EXISTS idx_embeddings_source ON os_embeddings(source_type, source_id);

-- HNSW index for efficient cosine-similarity search.
-- Build this AFTER initial data load (needs rows to tune well).
-- m=16, ef_construction=64 are reasonable defaults; bump ef_construction
-- to 128 if recall quality is judged low post-migration.
--
-- SET LOCAL statement_timeout = 0;  -- uncomment if your host has a short default
-- CREATE INDEX IF NOT EXISTS idx_os_embeddings_embedding
--   ON os_embeddings
--   USING hnsw (embedding vector_cosine_ops)
--   WITH (m = 16, ef_construction = 64);

-- ============================================================
-- FULL-TEXT SEARCH (GIN indexes on core tables)
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_fts_knowledge ON os_knowledge
  USING GIN (to_tsvector('english', title || ' ' || summary || ' ' || COALESCE(evidence, '') || ' ' || COALESCE(topic, '')));

CREATE INDEX IF NOT EXISTS idx_fts_projects ON os_projects
  USING GIN (to_tsvector('english', name || ' ' || COALESCE(description, '')));

CREATE INDEX IF NOT EXISTS idx_fts_project_tasks ON os_project_tasks
  USING GIN (to_tsvector('english', description));

CREATE INDEX IF NOT EXISTS idx_fts_goals ON os_goals
  USING GIN (to_tsvector('english', title || ' ' || COALESCE(description, '')));

CREATE INDEX IF NOT EXISTS idx_fts_agent_tasks ON os_agent_tasks
  USING GIN (to_tsvector('english', instruction || ' ' || COALESCE(output, '') || ' ' || COALESCE(handoff_context, '')));

-- end of core baseline migration
