# lararium

The one-line door into the [lararium](https://github.com/kylnor/lararium) template. It
fetches the latest release, unpacks it into a new folder, and gets out of the way. The scaffolder
itself uses only the node standard library.

```
npx lararium [folder] [--with-examples]
```

That's the whole tool. It resolves the newest tagged release from GitHub, downloads that tarball,
unpacks it into `folder` (default `lararium`), strips out what only the template's contributors
need (this scaffolder, the repo's CI and tests, the contributor guide, the depersonalization checklist, release
history and the blog), leaves out the themed example roster unless you pass `--with-examples`,
runs `git init` with a first commit, and prints what to do next:

```
cd <folder>
claude
```

Then say: "Run the starter in `starter/README.md`". It interviews you, writes your first three
notes and proves the memory works. When you outgrow it, the full install interview is in
`INSTALL.md`. This package only gets the files onto your disk.

## `npx lararium serve`: your memory folder as an MCP server

```
npx lararium serve --stdio      # a tool launches it for you (Claude Desktop, Claude Code, Codex)
npx lararium serve              # always-on, 127.0.0.1:8787, bearer tokens required
```

A small MCP server over the memory folder (`./memory`, or `--memory <dir>`). Node 20 or newer, the
official MCP SDK, no database. The files stay the memory; the server never keeps its own copy.

| tool | does |
|---|---|
| `search` | full-text by default; also by meaning when semantic search is on |
| `read` | one card in full (`MEMORY` opens the index) |
| `list` | every card with its type and one-line description |
| `remember` | writes one card (`name`, `description`, `type`, `body`) and its index line, in the format `memory/README.md` defines; never overwrites |

`read` and `remember` refuse any name that is not a plain card file inside the memory folder
(no path separators, no `..`, no symlinks).

**Two transports.** `--stdio` speaks MCP over stdin and stdout and opens no port, so it needs no
token. The default is streamable HTTP on `127.0.0.1:8787`, and HTTP always requires a bearer token:

- a **write token** (`lrw_...`) can call all four tools;
- a **read token** (`lrr_...`) is served a server that has no `remember` at all.

No token, or a wrong one, gets a 401. Tokens are created on first start in a private file
(`~/.config/lararium/serve.json`, mode 0600; set `LARARIUM_SERVE_HOME` to move it), or come from
`LARARIUM_READ_TOKEN` and `LARARIUM_WRITE_TOKEN` (32 characters or more, and different).
`--print-tokens` shows them. `--rotate-tokens` replaces them and prints only that it worked and where
the file is; a server that is already running reads the new file on its next request, so the old tokens
and every app sign-in made with them stop working at once, with no restart. (Tokens set with
`LARARIUM_READ_TOKEN` or `LARARIUM_WRITE_TOKEN` are not in the file: change those and restart.)

**Cloud apps.** The Claude app and ChatGPT connect from the internet, so they need a public HTTPS
address: put Tailscale Funnel or a Cloudflare Tunnel in front of the local port and start with
`--public-url https://<that address>`. ChatGPT accepts only OAuth (no static bearer), and the Claude
static-bearer option is a limited beta, so the server includes a small OAuth 2.1 sign-in (dynamic
client registration, PKCE S256, authorization code and refresh). Its consent page asks for the owner's
read or write token and grants that tier. Nothing is stored: issued credentials are signed with a key
derived from the two tokens, so rotating the tokens revokes all of them. The walkthrough is in
`INSTALL.md`, Phase 5.

**Optional semantic search.** Off by default. `--semantic` also ranks by meaning with a local
EmbeddingGemma 2 (768 dimensions): Ollama `embeddinggemma-2:270m` (the default), or llama.cpp
`ggml-org/embeddinggemma-2-GGUF:BF16` with `--embed-backend llamacpp`. The embedding server must be on
this machine. Vectors live in `memory/.index/` next to a record of which model made them; a different
model is refused until `--reindex`, and so are vectors the server would no longer reproduce (a stored
fingerprint of a fixed test sentence, plus the model digest when Ollama reports one, catches a different
model behind the same name and size). `--reindex` rebuilds and exits; start the server again after it.
Redirects from the embedding server are refused. If the model is missing, down, or the cache cannot be
read or written, search falls back to full-text and says so.

Limits worth knowing: it serves `memory/` only; `remember` adds cards and never edits one (a
correction is a new card); several servers on one folder take turns on `memory/MEMORY.md` through a
lock file (`.memory-index.lock`), and a symbolic link in place of `MEMORY.md` or `.index/` is refused.
The cards are canonical and the index line is derived: every card the server writes is also recorded
in `memory/.lararium-remembered` (an append-only journal, one self-checking record per card), and the
index is brought back in line with it. Each call also stamps its card with a random `lararium-id` in the
frontmatter, which `read` shows. A journal append is `#\nL1 <name>.md <id> <sha256> <check>\n`: `<sha256>`
is the hash of the card file's exact bytes and `<check>` is a sha-256 prefix of the rest of the line.
The journal only vouches for a card whose id AND exact bytes match one valid record for its name. The id
alone proves nothing, since anyone who can `read` the card sees it; it is the hash that binds the record
to what the server wrote. Edit a card and the server stops vouching for it (repair no longer restores
its index line), which is the safe direction.

**Threat model.** The server defends against the callers of its tools: HTTP and stdio clients,
including cloud apps reaching it over a tunnel. They get a token tier, names that can only be plain
card files in the memory folder, errors with no local paths in them (the full error goes to the
server's own log), and a read tier that has no `remember` at all. A local process that can already
write into the memory folder is trusted, because it can edit the cards directly, and that includes
appending raw bytes to the journal: that is out of scope, and nothing here claims to defeat it. What
the server is exact about is what it wrote itself. Inside that model the
server avoids following symbolic links it did not create: the index, the lock file and the vector
cache are opened without following a link and read or written through the open file, and the cache
folder is checked again before anything is committed. It does not try to win a race against a hostile
local writer. The index lock keeps two servers from writing the index at once, but it is
best-effort: it is published whole (written to a temp file, then hard-linked into place, so an empty
or partial lock is never visible), a lock file it cannot parse is treated as busy and left alone, and
a lock is only taken over when its holder is gone. Removing a file by name in Node is a compare and
then an unlink, so a process paused at exactly the wrong moment can still overlap another. The server
does not claim otherwise, and does not depend on it.

**What is guaranteed.** An acknowledged `remember` is never lost: the card file is created exclusively,
then journaled, then its index line is written. If the journal record cannot be written in full (an
error, a short write, or a failed close), the call fails and removes the card it just made. That
cleanup covers journal failures only. A failure after journaling (the index write, or releasing the
lock after the index landed) reports an error but leaves the journaled card, which repair can then
index; see below. If a
concurrent writer drops the index line, the line is restored on the next `remember` by any writable
server on that folder, or when a writable server starts (a `--read-only` server never repairs), using
the card's own description. Repair is best effort: it makes up to five passes per run and it gives up
rather than guess when the index ends inside an unclosed `<!--` comment, so a startup repair that
fails is not retried until the next `remember` or start. Until a line is restored,
`node hooks/memory-check.mjs .` shows the card as orphaned. The repair only touches cards the server
itself wrote: a card you wrote by hand is never given a pointer, and a card you demoted (line removed
from `MEMORY.md` and listed in `DEMOTED.md`) is never given one back. A `remember` that names a card
already on disk finishes that card's index line only when one valid journal record for that name holds
the card's id and the hash of its exact bytes, and those bytes match what the call would write. A
hand-written card of the same name is refused and never adopted, and so is a card that kept a copied
id but has other content, a duplicate or quoted id, or a frontmatter whose closing line is not exactly
`---`. A torn or short journal append is never completed into a record by what the server appends
later: a record needs its checksum and a final newline, and every append opens with a `#`, so the
first byte of a later append, whole or cut short at any length, lands on the torn line and keeps it
invalid. Descriptions with an HTML
comment marker (`<!--`, `-->`) or a control character (C0, DEL or C1) are refused, so a caller cannot
hide or inject index lines. The index parser counts `- name.md` and `- [text](path/name.md)` lines
(anything may follow) outside `<!-- -->` blocks, and `memory-check` uses the same rules.

**What is not guaranteed.** A crash (or kill) between creating a card and appending its journal record
leaves a card that is not journaled. That call was never acknowledged, but nothing can tell the card
from a hand-written one afterwards, so repair does not adopt it: `memory-check` reports it as
orphaned, and the fix is to add its index line by hand or delete the file. If the journal cannot be
written and the server then also cannot remove the card it just created (a permissions problem, say),
the tool error says the call failed and that a residual card may remain at `<name>.md` in the memory
folder. Recover by deleting that file, after which the same `remember` works; or keep it by adding its
line to `MEMORY.md` by hand. A residual card is not adopted by repair and an identical retry is
refused, unless a valid journal record for it exists and holds the hash of its exact bytes. That
happens when the record was written in full and only the close failed. A residual card adopted that
way is byte for byte what the server wrote, so a retry or the next repair finishing its index line is
the intended outcome, not a gap. If the lock also fails to release while the call is already failing,
the tool error stays the residual-card message and the lock failure is logged to the server's stderr
(without a path); a lock failure on a call that otherwise succeeded is reported as the error. Local
disks only: appends to the journal are not atomic on network filesystems, and the lock needs hard links.
One accepted gap: rotating the tokens does not cancel a request that was already
authenticated and is still in flight; it finishes, and every request after it is refused.


Behavior change since `0.2.x`: `npx lararium serve` is now this command. To scaffold a folder that
is literally named `serve`, write `npx lararium ./serve`.

**Note on versioning:** this package's own version (`0.2.0` and up) is unrelated to the template's
`STACK_VERSION`. The scaffolder always fetches whatever the latest template release is at run time;
bumping this package is only for fixing the scaffolder itself.

## Publishing (for the template's owner)

Requires an npm login with publish rights on the `lararium` package name. From this directory:

```
npm publish
```

Bump `version` in `package.json` first if anything in `index.js` changed. The published package
version stays decoupled from `STACK_VERSION`; do not try to keep them in sync.
