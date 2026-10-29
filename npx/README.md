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

A small MCP server over the memory folder (`./memory`, or `--memory <dir>`). Node 18 or newer, the
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
`--print-tokens` shows them; `--rotate-tokens` replaces them and signs every connected app out.

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
model is refused until `--reindex`. If the model is missing or down, search falls back to full-text
and says so.

Limits worth knowing: it serves `memory/` only; `remember` adds cards and never edits one (a
correction is a new card); two processes editing `memory/MEMORY.md` in the same instant can race.

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
