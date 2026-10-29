<!-- lararium:shared-memory:start -->
# Shared memory (read before answering from scratch)

Memory lives in files, shared by every agent CLI on this machine (Claude Code, Codex, Gemini CLI).
Files are the memory: no agent owns it and none keeps a private copy.
- `{{STACK_ROOT}}/CLAUDE.md` is the map (`{{STACK_ROOT}}/brain/CLAUDE.md` if there is no root one).
  Read it first: it says where everything lives.
- Search files first, always: `grep -ril --exclude-dir=.git "<term>" {{STACK_ROOT_SHELL}}`.
- `{{STACK_ROOT}}/memory/` holds lessons and corrections, one card per fact; `MEMORY.md` there is the
  index. Grep it before repeating a known mistake.
- A search miss is not proof a fact is absent. Say "not found in <where you looked>", never "it does
  not exist". If this stack has a search index, it holds raw evidence the files do not.
- When you are corrected or learn a durable fact, write a card in `{{STACK_ROOT}}/memory/` (one fact per file,
  frontmatter, a one-line pointer prepended to `MEMORY.md`), then read it back. Do not rely on
  remembering.
<!-- lararium:shared-memory:end -->
