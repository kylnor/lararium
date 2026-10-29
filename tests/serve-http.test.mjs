// The memory server over HTTP: auth is mandatory and tiered, the OAuth shim lets the cloud apps in
// with the same two tokens, and a fact saved over one transport is readable over another.
// Needs the server's dependencies: npm ci --prefix npx
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { createStore } = require(path.join(repo, 'npx/lib/store.js'));
const { createHttpServer } = require(path.join(repo, 'npx/lib/http.js'));
const sdk = createRequire(path.join(repo, 'npx/package.json'));
const { Client } = sdk('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = sdk('@modelcontextprotocol/sdk/client/streamableHttp.js');

const tokens = { readToken: `lrr_${'r'.repeat(43)}`, writeToken: `lrw_${'w'.repeat(43)}` };
let top;
let memory;
let server;
let base;

before(async () => {
  top = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-http-'));
  memory = path.join(top, 'memory');
  fs.mkdirSync(memory);
  for (const f of ['MEMORY.md', 'DEMOTED.md']) fs.copyFileSync(path.join(repo, 'memory', f), path.join(memory, f));
  fs.writeFileSync(path.join(memory, 'written-by-claude-code.md'),
    '---\nname: written-by-claude-code\ndescription: The launch codename is bluefin.\ntype: project\n---\n\nThe launch codename is bluefin, decided 2026-10-01.\n');
  server = createHttpServer({ store: createStore({ root: memory }), semantic: null, tokens, version: 'test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => {
  server.close();
  fs.rmSync(top, { recursive: true, force: true });
});

const rpc = (headers, body) => fetch(`${base}/mcp`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...headers },
  body: JSON.stringify(body),
});
const listTools = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} };
const callTool = (name, args) => ({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } });

async function connect(token) {
  const client = new Client({ name: 'test', version: '0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
  return client;
}

test('no token and a wrong token are 401, on every method, and say where to sign in', async () => {
  for (const headers of [{}, { authorization: 'Bearer wrong' }, { authorization: `Bearer ${tokens.readToken}x` }, { authorization: 'Basic abc' }, { authorization: tokens.writeToken }]) {
    const res = await rpc(headers, listTools);
    assert.equal(res.status, 401, JSON.stringify(headers));
    assert.match(res.headers.get('www-authenticate'), /resource_metadata=".*oauth-protected-resource"/);
  }
  assert.equal((await fetch(`${base}/mcp`)).status, 401);
  assert.equal((await fetch(`${base}/mcp?token=${tokens.writeToken}`, { method: 'POST' })).status, 401, 'a token in the query string is not accepted');
});

test('the read token lists three tools and cannot call remember; the write token gets four and can', async () => {
  const read = await connect(tokens.readToken);
  assert.deepEqual((await read.listTools()).tools.map(t => t.name).sort(), ['list', 'read', 'search']);
  const refused = await rpc({ authorization: `Bearer ${tokens.readToken}` }, callTool('remember', { name: 'sneaky', description: 'd', type: 'user', body: 'x' }));
  const outcome = (await refused.json()).result;
  assert.equal(outcome.isError, true);
  assert.match(outcome.content[0].text, /Tool remember not found/);
  assert.equal(fs.existsSync(path.join(memory, 'sneaky.md')), false, 'nothing was written');
  await read.close();

  const write = await connect(tokens.writeToken);
  assert.deepEqual((await write.listTools()).tools.map(t => t.name).sort(), ['list', 'read', 'remember', 'search']);
  await write.close();
});

test('round trip: a fact an agent wrote to the files is found over HTTP, and a fact saved over HTTP is on disk for the CLIs', async () => {
  const write = await connect(tokens.writeToken);
  const found = await write.callTool({ name: 'search', arguments: { query: 'what do you remember about bluefin?' } });
  assert.match(found.content[0].text, /written-by-claude-code/);
  const saved = await write.callTool({ name: 'remember', arguments: { name: 'saved-from-the-app', description: 'Saved over HTTP.', type: 'user', body: 'The owner prefers tea.' } });
  assert.notEqual(saved.isError, true, saved.content[0].text);
  await write.close();

  assert.match(fs.readFileSync(path.join(memory, 'saved-from-the-app.md'), 'utf8'), /^---\nname: saved-from-the-app\n/);
  assert.match(fs.readFileSync(path.join(memory, 'MEMORY.md'), 'utf8'), /- saved-from-the-app\.md - Saved over HTTP\./);

  const read = await connect(tokens.readToken);
  const again = await read.callTool({ name: 'read', arguments: { name: 'saved-from-the-app' } });
  assert.match(again.content[0].text, /prefers tea/);
  const traversal = await read.callTool({ name: 'read', arguments: { name: '../../etc/passwd' } });
  assert.equal(traversal.isError, true);
  await read.close();
});

test('a foreign Host or Origin header is refused (DNS rebinding and browser cross-site calls)', async () => {
  const res = await fetch(`${base}/mcp`, { method: 'POST', headers: { origin: 'https://evil.example', authorization: `Bearer ${tokens.writeToken}`, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(res.status, 403);
  const { request } = await import('node:http');
  const status = await new Promise(resolve => {
    const req = request({ host: '127.0.0.1', port: server.address().port, path: '/mcp', method: 'POST', headers: { host: 'evil.example', authorization: `Bearer ${tokens.writeToken}` } }, r => { r.resume(); resolve(r.statusCode); });
    req.end('{}');
  });
  assert.equal(status, 403);
});

// ---- OAuth shim: what ChatGPT and the Claude app speak ----

const b64 = buf => Buffer.from(buf).toString('base64url');
const pkce = () => {
  const verifier = b64(crypto.randomBytes(32));
  return { verifier, challenge: b64(crypto.createHash('sha256').update(verifier).digest()) };
};
const CALLBACK = 'https://app.example/callback';

async function registerClient(redirect = CALLBACK) {
  const res = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_name: 'Test App', redirect_uris: [redirect] }) });
  assert.equal(res.status, 201);
  return (await res.json()).client_id;
}
function authorizeForm(clientId, challenge, token, redirect = CALLBACK) {
  return new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code', code_challenge: challenge, code_challenge_method: 'S256', state: 'xyz', token });
}
async function getCode(clientId, challenge, token) {
  const res = await fetch(`${base}/authorize`, { method: 'POST', body: authorizeForm(clientId, challenge, token), redirect: 'manual' });
  return res;
}
const exchange = (body) => fetch(`${base}/token`, { method: 'POST', body: new URLSearchParams(body) });

test('discovery documents point at the public address and demand PKCE S256', async () => {
  const resource = await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json();
  assert.equal(resource.resource, `${base}/mcp`);
  const meta = await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json();
  assert.deepEqual(meta.code_challenge_methods_supported, ['S256']);
  assert.equal(meta.registration_endpoint, `${base}/register`);
});

test('OAuth: sign in with the read token, get a read-only access token, refresh it; nothing replays', async () => {
  const clientId = await registerClient();
  const { verifier, challenge } = pkce();

  const form = await fetch(`${base}/authorize?${authorizeForm(clientId, challenge, '').toString().replace('&token=', '')}`);
  assert.equal(form.status, 200);
  assert.match(await form.text(), /app\.example/);

  const wrong = await getCode(clientId, challenge, 'not-a-token');
  assert.equal(wrong.status, 401);

  const ok = await getCode(clientId, challenge, tokens.readToken);
  assert.equal(ok.status, 302);
  const back = new URL(ok.headers.get('location'));
  assert.equal(`${back.origin}${back.pathname}`, CALLBACK);
  assert.equal(back.searchParams.get('state'), 'xyz');
  const code = back.searchParams.get('code');

  const badVerifier = await exchange({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: pkce().verifier });
  assert.equal(badVerifier.status, 400, 'PKCE: the wrong verifier is refused');
  const wrongRedirect = await exchange({ grant_type: 'authorization_code', code, redirect_uri: 'https://other.example/cb', client_id: clientId, code_verifier: verifier });
  assert.equal(wrongRedirect.status, 400);

  const issued = await exchange({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier });
  assert.equal(issued.status, 200);
  const grant = await issued.json();
  assert.equal(grant.token_type, 'Bearer');
  const replay = await exchange({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier });
  assert.equal(replay.status, 400, 'a code works once');

  const client = await connect(grant.access_token);
  assert.deepEqual((await client.listTools()).tools.map(t => t.name).sort(), ['list', 'read', 'search']);
  await client.close();

  const refreshed = await exchange({ grant_type: 'refresh_token', refresh_token: grant.refresh_token });
  assert.equal(refreshed.status, 200);
  const next = await refreshed.json();
  const again = await connect(next.access_token);
  assert.equal((await again.listTools()).tools.length, 3, 'a refresh keeps the tier');
  await again.close();

  assert.equal((await exchange({ grant_type: 'refresh_token', refresh_token: grant.access_token })).status, 400, 'an access token is not a refresh token');
  assert.equal((await rpc({ authorization: `Bearer ${grant.refresh_token}` }, listTools)).status, 401, 'a refresh token is not an access token');
});

test('OAuth: the write token yields a write-capable access token', async () => {
  const clientId = await registerClient();
  const { verifier, challenge } = pkce();
  const ok = await getCode(clientId, challenge, tokens.writeToken);
  const code = new URL(ok.headers.get('location')).searchParams.get('code');
  const grant = await (await exchange({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier })).json();
  const client = await connect(grant.access_token);
  assert.equal((await client.listTools()).tools.length, 4);
  await client.close();
});

test('OAuth: unregistered clients, foreign redirects and a missing S256 challenge are refused', async () => {
  const clientId = await registerClient();
  const { challenge } = pkce();
  const forged = await fetch(`${base}/authorize?${authorizeForm('ci.eyJ9.zzz', challenge, '').toString()}`);
  assert.equal(forged.status, 400);
  const foreign = await fetch(`${base}/authorize?${authorizeForm(clientId, challenge, '', 'https://evil.example/cb').toString()}`);
  assert.equal(foreign.status, 400);
  const plain = authorizeForm(clientId, challenge, '');
  plain.set('code_challenge_method', 'plain');
  assert.equal((await fetch(`${base}/authorize?${plain}`)).status, 400);
  for (const redirect of ['http://app.example/cb', 'javascript:alert(1)', 'https://app.example/cb#frag']) {
    const res = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [redirect] }) });
    assert.equal(res.status, 400, redirect);
  }
  const loopback = await fetch(`${base}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: ['http://127.0.0.1:9999/cb'] }) });
  assert.equal(loopback.status, 201);
});

test('OAuth: credentials die when the tokens are rotated', async () => {
  const clientId = await registerClient();
  const { verifier, challenge } = pkce();
  const code = new URL((await getCode(clientId, challenge, tokens.writeToken)).headers.get('location')).searchParams.get('code');
  const grant = await (await exchange({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: clientId, code_verifier: verifier })).json();

  const rotated = createHttpServer({ store: createStore({ root: memory }), semantic: null, tokens: { readToken: `lrr_${'a'.repeat(43)}`, writeToken: `lrw_${'b'.repeat(43)}` }, version: 'test' });
  await new Promise(resolve => rotated.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${rotated.address().port}/mcp`, {
      method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${grant.access_token}` }, body: JSON.stringify(listTools),
    });
    assert.equal(res.status, 401);
  } finally { rotated.close(); }
});

// Rotation has to take effect on a server that is already running, or a leaked token stays good
// until someone restarts it. This drives the real CLI: a running listener, then a separate
// `--rotate-tokens` process, then the same listener again.
test('rotation revokes on the running server: old static and OAuth credentials 401 at once, new tokens work, no restart', async () => {
  const entry = path.join(repo, 'npx/index.js');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'serve-rotate-'));
  const env = { ...process.env, LARARIUM_SERVE_HOME: home, LARARIUM_READ_TOKEN: '', LARARIUM_WRITE_TOKEN: '' };
  const run = flag => spawnSync(process.execPath, [entry, 'serve', flag], { encoding: 'utf8', env });
  const parse = out => Object.fromEntries(out.trim().split('\n').map(l => l.split(/:\s+/)));
  const before = parse(run('--print-tokens').stdout);
  const child = spawn(process.execPath, [entry, 'serve', '--memory', memory, '--port', '0'], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let seen = '';
      child.stderr.on('data', c => {
        seen += c;
        const m = seen.match(/listening on (http:\/\/127\.0\.0\.1:\d+)\/mcp/);
        if (m) resolve(m[1]);
      });
      child.on('close', () => reject(new Error(`server exited early: ${seen}`)));
    });
    const call = token => fetch(`${url}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: `Bearer ${token}` },
      body: JSON.stringify(listTools),
    }).then(r => r.status);

    // an OAuth credential minted from the old tokens, through the live server
    const { verifier, challenge } = pkce();
    const reg = await (await fetch(`${url}/register`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ redirect_uris: [CALLBACK] }) })).json();
    const authz = await fetch(`${url}/authorize`, { method: 'POST', body: authorizeForm(reg.client_id, challenge, before.write), redirect: 'manual' });
    const code = new URL(authz.headers.get('location')).searchParams.get('code');
    const grant = await (await fetch(`${url}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: CALLBACK, client_id: reg.client_id, code_verifier: verifier }),
    })).json();

    assert.equal(await call(before.write), 200);
    assert.equal(await call(before.read), 200);
    assert.equal(await call(grant.access_token), 200);

    assert.equal(run('--rotate-tokens').status, 0);
    const after = parse(run('--print-tokens').stdout);
    assert.notEqual(after.write, before.write);

    assert.equal(await call(before.write), 401, 'old write token');
    assert.equal(await call(before.read), 401, 'old read token');
    assert.equal(await call(grant.access_token), 401, 'OAuth access token issued before the rotation');
    assert.equal(await call(after.write), 200, 'new write token');
    assert.equal(await call(after.read), 200, 'new read token');
  } finally {
    child.kill();
    fs.rmSync(home, { recursive: true, force: true });
  }
});
