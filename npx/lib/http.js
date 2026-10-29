'use strict';
// Streamable HTTP transport with mandatory auth. Every /mcp request needs a bearer token: one of
// the two static tokens, or an access token issued by the small OAuth shim below (the cloud apps
// only speak OAuth, so the shim exists to let them in with the same two tokens). No token or a
// wrong one is a 401. The read tier is served a server without `remember`.
const http = require('node:http');
const crypto = require('node:crypto');
// Node 18 has no global `crypto` (it arrived in 19 and is behind a flag in 18), and the SDK's HTTP
// transport calls crypto.randomUUID() on the global. Supply it before the transport is loaded.
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const { StreamableHTTPServerTransport } = require('@modelcontextprotocol/sdk/server/streamableHttp.js');
const auth = require('./auth');
const { createMcpServer } = require('./mcp');

const MCP_PATH = '/mcp';
const MAX_MCP_BODY = 1024 * 1024;
const MAX_FORM_BODY = 64 * 1024;
const ACCESS_TTL_S = 60 * 60;
const REFRESH_TTL_S = 30 * 24 * 60 * 60;
const CODE_TTL_S = 5 * 60;

const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', '\'': '&#39;' }[c]));
const isLoopbackHost = host => ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);

function validRedirect(uri) {
  if (typeof uri !== 'string' || uri.length > 500) return false;
  let u;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  return u.protocol === 'https:' || (u.protocol === 'http:' && isLoopbackHost(u.hostname));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('body too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function send(res, status, body, headers = {}) {
  const json = typeof body === 'object' && body !== null;
  res.writeHead(status, {
    'content-type': json ? 'application/json' : 'text/plain; charset=utf-8',
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(json ? JSON.stringify(body) : body);
}

// `publicUrl` is the HTTPS address the outside world uses (a tunnel); without it the server
// describes itself by its loopback address, which is right for local tools.
function createHttpServer({ store, semantic, tokens, publicUrl, version, log = () => {} }) {
  let base = publicUrl ? publicUrl.replace(/\/+$/, '') : '';
  const allowedHosts = new Set();
  const key = auth.signingKey(tokens);
  const throttle = auth.createLimiter({ max: 60, windowMs: 60 * 1000 });
  const usedCodes = new Map();

  const unauthorized = (res, why) => send(res, 401, { error: why }, {
    'www-authenticate': `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource", error="invalid_token"`,
  });

  function tierOf(req) {
    const presented = auth.bearerFrom(req);
    if (!presented) return null;
    const staticTier = auth.tierOfStaticToken(presented, tokens);
    if (staticTier) return staticTier;
    const claims = auth.verify(key, 'at', presented);
    return claims && (claims.tier === 'read' || claims.tier === 'write') ? claims.tier : null;
  }

  async function handleMcp(req, res) {
    const tier = tierOf(req);
    if (!tier) {
      if (!throttle(`bad:${req.socket.remoteAddress}`)) return send(res, 429, { error: 'too many failed attempts' }, { 'retry-after': '60' });
      return unauthorized(res, 'missing or invalid bearer token');
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, { allow: 'POST' });
    let body;
    try { body = JSON.parse(await readBody(req, MAX_MCP_BODY)); } catch (error) {
      return send(res, error.status || 400, { error: error.status === 413 ? 'body too large' : 'body must be JSON' });
    }
    // Stateless: a fresh server per request, shaped by the caller's tier.
    const server = createMcpServer({ store, semantic, role: tier, version });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close().catch(() => {}); server.close().catch(() => {}); });
    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  // ---- OAuth 2.1 shim: DCR + authorization code + PKCE S256, stateless via signed blobs ----

  function metadata(res) {
    send(res, 200, {
      issuer: base,
      authorization_endpoint: `${base}/authorize`,
      token_endpoint: `${base}/token`,
      registration_endpoint: `${base}/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['memory'],
    });
  }

  async function register(req, res) {
    if (!throttle(`reg:${req.socket.remoteAddress}`)) return send(res, 429, { error: 'too_many_requests' });
    let input;
    try { input = JSON.parse(await readBody(req, MAX_FORM_BODY)); } catch { return send(res, 400, { error: 'invalid_client_metadata' }); }
    const uris = input && input.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 5 || !uris.every(validRedirect)) {
      return send(res, 400, { error: 'invalid_redirect_uri', error_description: 'redirect_uris must be 1 to 5 https URLs (or http on loopback)' });
    }
    const name = typeof input.client_name === 'string' ? input.client_name.slice(0, 80) : 'MCP client';
    const clientId = auth.sign(key, 'ci', { ru: uris, n: name, exp: Math.floor(Date.now() / 1000) + 365 * 24 * 3600 });
    return send(res, 201, {
      client_id: clientId,
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    });
  }

  function parseAuthorize(params) {
    const client = auth.verify(key, 'ci', params.get('client_id'));
    const redirect = params.get('redirect_uri');
    if (!client || !client.ru.includes(redirect)) return { error: 'This application is not registered with this server, or its redirect address does not match.' };
    if (params.get('response_type') !== 'code') return { error: 'Only response_type=code is supported.' };
    const challenge = params.get('code_challenge');
    if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(challenge || '')) {
      return { error: 'PKCE with S256 is required.' };
    }
    return { client, redirect, challenge, state: params.get('state') || '', clientId: params.get('client_id') };
  }

  function page(res, status, parsed, message) {
    const hidden = [['client_id', parsed.clientId], ['redirect_uri', parsed.redirect], ['response_type', 'code'], ['code_challenge', parsed.challenge], ['code_challenge_method', 'S256'], ['state', parsed.state]]
      .map(([k, v]) => `<input type="hidden" name="${k}" value="${esc(v)}">`).join('');
    const where = esc(new URL(parsed.redirect).host);
    send(res, status, `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Connect to your memory</title>
<style>body{font:16px/1.5 system-ui,sans-serif;max-width:30rem;margin:12vh auto;padding:0 1rem;color:#1a1a1a;background:#fafaf8}input[type=password]{width:100%;padding:.6rem;font:inherit;border:1px solid #888;border-radius:6px;box-sizing:border-box}button{margin-top:1rem;padding:.6rem 1.2rem;font:inherit;border:0;border-radius:6px;background:#1a1a1a;color:#fff;cursor:pointer}.err{color:#a00}code{background:#eee;padding:0 .25rem}</style></head><body>
<h1>Connect to your memory</h1>
<p><strong>${esc(parsed.client.n)}</strong> (returns to <code>${where}</code>) is asking to read the memory on this machine.</p>
<p>Paste your <strong>read token</strong> to allow search and reading only, or your <strong>write token</strong> to also allow saving. If you did not start this, close the page.</p>
${message ? `<p class="err">${esc(message)}</p>` : ''}
<form method="post" action="/authorize">${hidden}<label>Token<input type="password" name="token" autocomplete="off" autofocus required></label><button type="submit">Allow</button></form>
</body></html>`, {
      'content-type': 'text/html; charset=utf-8',
      'content-security-policy': 'default-src \'none\'; style-src \'unsafe-inline\'; frame-ancestors \'none\'; base-uri \'none\'',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
    });
  }

  async function authorize(req, res, url) {
    if (!throttle(`authz:${req.socket.remoteAddress}`)) return send(res, 429, 'Too many attempts. Wait a minute.');
    const isPost = req.method === 'POST';
    const params = isPost ? new URLSearchParams(await readBody(req, MAX_FORM_BODY)) : url.searchParams;
    const parsed = parseAuthorize(params);
    if (parsed.error) return send(res, 400, parsed.error);
    if (!isPost) return page(res, 200, parsed);
    const tier = auth.tierOfStaticToken(params.get('token') || '', tokens);
    if (!tier) return page(res, 401, parsed, 'That token was not recognized.');
    const code = auth.sign(key, 'ac', {
      cid: parsed.clientId, ru: parsed.redirect, cc: parsed.challenge, tier, jti: crypto.randomBytes(8).toString('hex'), exp: Math.floor(Date.now() / 1000) + CODE_TTL_S,
    });
    const target = new URL(parsed.redirect);
    target.searchParams.set('code', code);
    if (parsed.state) target.searchParams.set('state', parsed.state);
    target.searchParams.set('iss', base);
    return send(res, 302, '', { location: target.toString() });
  }

  function issue(tier) {
    const now = Math.floor(Date.now() / 1000);
    return {
      access_token: auth.sign(key, 'at', { tier, exp: now + ACCESS_TTL_S }),
      token_type: 'Bearer',
      expires_in: ACCESS_TTL_S,
      refresh_token: auth.sign(key, 'rt', { tier, exp: now + REFRESH_TTL_S }),
      scope: 'memory',
    };
  }

  async function token(req, res) {
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' }, { allow: 'POST' });
    if (!throttle(`tok:${req.socket.remoteAddress}`)) return send(res, 429, { error: 'too_many_requests' });
    const form = new URLSearchParams(await readBody(req, MAX_FORM_BODY));
    const grant = form.get('grant_type');
    if (grant === 'authorization_code') {
      const claims = auth.verify(key, 'ac', form.get('code'));
      const verifier = form.get('code_verifier') || '';
      const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
      const ok = claims && claims.cid === form.get('client_id') && claims.ru === form.get('redirect_uri') &&
        /^[A-Za-z0-9._~-]{43,128}$/.test(verifier) && auth.safeEqual(challenge, claims.cc);
      const now = Math.floor(Date.now() / 1000);
      for (const [id, exp] of usedCodes) if (exp < now) usedCodes.delete(id);
      if (!ok || usedCodes.has(claims.jti)) return send(res, 400, { error: 'invalid_grant' });
      usedCodes.set(claims.jti, claims.exp);
      return send(res, 200, issue(claims.tier));
    }
    if (grant === 'refresh_token') {
      const claims = auth.verify(key, 'rt', form.get('refresh_token'));
      if (!claims || (claims.tier !== 'read' && claims.tier !== 'write')) return send(res, 400, { error: 'invalid_grant' });
      return send(res, 200, issue(claims.tier));
    }
    return send(res, 400, { error: 'unsupported_grant_type' });
  }

  const server = http.createServer((req, res) => {
    const host = req.headers.host || '';
    if (!allowedHosts.has(host)) return send(res, 403, 'unrecognized Host header');
    const origin = req.headers.origin;
    if (origin) {
      let originHost = '';
      try { originHost = new URL(origin).host; } catch { /* leave empty */ }
      if (!allowedHosts.has(originHost)) return send(res, 403, 'unrecognized Origin');
    }
    const route = async () => {
      const url = new URL(req.url, base);
      if (url.pathname === MCP_PATH) return handleMcp(req, res);
      if (url.pathname.startsWith('/.well-known/oauth-protected-resource')) {
        return send(res, 200, { resource: `${base}${MCP_PATH}`, authorization_servers: [base], bearer_methods_supported: ['header'], scopes_supported: ['memory'] });
      }
      if (url.pathname.startsWith('/.well-known/oauth-authorization-server')) return metadata(res);
      if (url.pathname === '/register' && req.method === 'POST') return register(req, res);
      if (url.pathname === '/authorize' && (req.method === 'GET' || req.method === 'POST')) return authorize(req, res, url);
      if (url.pathname === '/token') return token(req, res);
      return send(res, 404, { error: 'not found' });
    };
    route().catch(error => {
      log(`request failed: ${error.stack || error}`);
      if (!res.headersSent) send(res, error.status || 500, { error: error.status === 413 ? 'body too large' : 'internal error' });
      else res.end();
    });
  });
  server.on('listening', () => {
    const { port } = server.address();
    if (!base) base = `http://127.0.0.1:${port}`;
    allowedHosts.add(new URL(base).host);
    for (const h of ['127.0.0.1', 'localhost', '[::1]']) allowedHosts.add(`${h}:${port}`);
  });
  return server;
}

module.exports = { createHttpServer, MCP_PATH, validRedirect };
