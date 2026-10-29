'use strict';
// `npx lararium serve`: the memory folder as an MCP server. Loaded only for the serve subcommand,
// so the scaffolder (index.js) keeps working without the MCP SDK installed.
const fs = require('node:fs');
const path = require('node:path');

const USAGE = `lararium serve: your memory folder as an MCP server

  npx lararium serve --stdio                 local tools that launch the server themselves (Claude Desktop)
  npx lararium serve                         always-on HTTP on 127.0.0.1:8787, bearer tokens required

Options
  --memory <dir>        the memory folder (default: ./memory, or $LARARIUM_MEMORY)
  --stdio               speak MCP over stdin/stdout; no network, no tokens
  --read-only           with --stdio: do not offer the remember tool
  --port <n>            HTTP port (default 8787)
  --host <addr>         HTTP bind address (default 127.0.0.1; leave it unless you know why)
  --public-url <https>  the HTTPS address a tunnel gives you, for the cloud apps (optional last step)
  --print-tokens        show the read and write tokens, then exit
  --rotate-tokens       make new tokens (this signs every connected app out), then exit
  --semantic            also rank by meaning with a local EmbeddingGemma 2 (off by default)
  --embed-backend <b>   ollama (default) or llamacpp
  --embed-url <url>     where that server listens (must be on this machine)
  --embed-model <name>  default embeddinggemma-2:270m (ollama)
  --reindex             throw away stored vectors and rebuild them, then exit
  --help
`;

function parseArgs(argv) {
  const flags = new Set(['stdio', 'read-only', 'print-tokens', 'rotate-tokens', 'semantic', 'reindex', 'help']);
  const valued = new Set(['memory', 'port', 'host', 'public-url', 'embed-backend', 'embed-url', 'embed-model']);
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const name = arg.startsWith('--') ? arg.slice(2) : '';
    if (flags.has(name)) out[name] = true;
    else if (valued.has(name)) {
      if (i + 1 >= argv.length || argv[i + 1].startsWith('--')) throw new Error(`--${name} needs a value`);
      out[name] = argv[(i += 1)];
    } else throw new Error(`unknown argument: ${arg}`);
  }
  return out;
}

function packageVersion() {
  return JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version;
}

async function main(argv, env = process.env) {
  const opts = parseArgs(argv);
  if (opts.help) { process.stdout.write(USAGE); return; }
  const log = line => process.stderr.write(`${line}\n`);
  const auth = require('./lib/auth');

  if (opts['print-tokens'] || opts['rotate-tokens']) {
    const tokens = auth.loadTokens({ env, rotate: Boolean(opts['rotate-tokens']) });
    process.stdout.write(`read:  ${tokens.readToken}\nwrite: ${tokens.writeToken}\nfile:  ${tokens.file}\n`);
    return;
  }

  const { createStore } = require('./lib/store');
  const memory = path.resolve(opts.memory || env.LARARIUM_MEMORY || 'memory');
  const store = createStore({ root: memory });
  const version = packageVersion();

  let semantic = null;
  if (opts.semantic || opts.reindex || env.LARARIUM_SEMANTIC === '1') {
    const { createSemantic } = require('./lib/embed');
    semantic = createSemantic({
      store, backend: opts['embed-backend'] || 'ollama', url: opts['embed-url'], model: opts['embed-model'],
    });
    if (opts.reindex) {
      semantic.reset();
      const result = await semantic.sync();
      log(`reindexed ${result.total} card(s) with ${JSON.stringify(semantic.identity)}`);
      return;
    }
    log(`semantic search on: ${JSON.stringify(semantic.identity)}; falls back to full-text if the model is unavailable`);
  }

  if (opts.stdio) {
    const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
    const { createMcpServer } = require('./lib/mcp');
    const server = createMcpServer({ store, semantic, role: opts['read-only'] ? 'read' : 'write', version });
    await server.connect(new StdioServerTransport());
    log(`lararium memory (stdio) serving ${store.folder}`);
    return;
  }

  const { createHttpServer } = require('./lib/http');
  const tokens = auth.loadTokens({ env });
  const port = opts.port === undefined ? 8787 : Number(opts.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('--port must be 0 to 65535');
  const host = opts.host || '127.0.0.1';
  let publicUrl = opts['public-url'];
  if (publicUrl) {
    const u = new URL(publicUrl);
    if (u.protocol !== 'https:') throw new Error('--public-url must be an https:// address');
    publicUrl = u.origin;
  }
  const server = createHttpServer({ store, semantic, tokens, publicUrl, version, log });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  const address = server.address();
  log(`lararium memory (http) serving ${store.folder}`);
  log(`listening on http://${host}:${address.port}/mcp`);
  if (publicUrl) log(`public address: ${publicUrl}/mcp (your tunnel must forward to this port)`);
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) log(`WARNING: bound to ${host}, not loopback. Anyone who can reach it still needs a token, but prefer a tunnel to 127.0.0.1.`);
  log(`tokens are in ${tokens.file}${tokens.created ? ' (just created)' : ''}; show them with: npx lararium serve --print-tokens`);
}

module.exports = { main, parseArgs, USAGE };
