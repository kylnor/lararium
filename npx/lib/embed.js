'use strict';
// Optional semantic search on a local EmbeddingGemma 2. Off unless asked for. One model and one
// dimensionality are pinned, the identity is stored next to the vectors, and vectors from a
// different identity are never mixed in: the same dimension from a different model is still a
// different space. A name and a size cannot tell two models apart, so the cache also keeps a
// fingerprint: the vector a fixed probe text produced when the cache was built (plus the embed
// URL and, where the server reports one, the model digest). Before the cache is used the probe is
// embedded again and must match; if not, the cache is refused until --reindex. Anything that goes
// wrong (server down, model missing, wrong size, a cache that cannot be read or written) falls
// back to full-text. Text only ever goes to a loopback address, and redirects are refused.
// The cache is read through a no-follow descriptor, the vectors a search ranks against are the very
// ones that passed the fingerprint check (held in memory, never read back from the file), and a
// write goes to a temp file in the pinned .index/ folder and is renamed into place.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { GuardError, pinAuxDir, readFileNoFollow, writeFileAtomic } = require('./guard');

const DEFAULTS = {
  ollama: { url: 'http://127.0.0.1:11434', model: 'embeddinggemma-2:270m' },
  llamacpp: { url: 'http://127.0.0.1:8080', model: 'embeddinggemma-2' },
};
const DIMS = 768;
const QUERY_PREFIX = 'task: search result | query: ';
const DOCUMENT_PREFIX = 'title: none | text: ';
const REQUEST_TIMEOUT_MS = 20000;
const BATCH = 16;
const PROBE_TEXT = `${DOCUMENT_PREFIX}Lararium identity probe. The harbor lamp stays lit until the last boat is home.`;
const PROBE_MIN_COSINE = 0.999;

class SemanticUnavailable extends Error {
  constructor(message) {
    super(message);
    this.name = 'SemanticUnavailable';
  }
}

function assertLoopback(url) {
  let host;
  try { host = new URL(url).hostname.replace(/^\[|\]$/g, ''); } catch { throw new SemanticUnavailable('embedding URL is not a valid URL'); }
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) {
    throw new SemanticUnavailable('embedding server must be on this machine (127.0.0.1, localhost or ::1); card text is never sent elsewhere');
  }
}

function normalize(vector) {
  let sum = 0;
  for (const x of vector) sum += x * x;
  const norm = Math.sqrt(sum) || 1;
  return Float32Array.from(vector, x => x / norm);
}

function encode(vector) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString('base64');
}

function decode(text) {
  const buf = Buffer.from(text, 'base64');
  return new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

function dot(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += a[i] * b[i];
  return sum;
}

function createSemantic({ store, backend = 'ollama', url, model, fetchImpl = globalThis.fetch }) {
  if (!DEFAULTS[backend]) throw new SemanticUnavailable(`unknown embedding backend "${backend}" (use ollama or llamacpp)`);
  const endpoint = (url || DEFAULTS[backend].url).replace(/\/+$/, '');
  const modelName = model || DEFAULTS[backend].model;
  const identity = { backend, model: modelName, dims: DIMS };
  const vectorDir = path.join(store.folder, '.index');
  const vectorFile = path.join(vectorDir, 'embeddings.json');
  assertLoopback(endpoint);

  async function embed(texts) {
    const isOllama = backend === 'ollama';
    let response;
    try {
      response = await fetchImpl(`${endpoint}${isOllama ? '/api/embed' : '/v1/embeddings'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: modelName, input: texts }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: 'error', // a redirect could carry card text off this machine
      });
    } catch (error) {
      if (/redirect/i.test(`${error.message} ${error.cause && error.cause.message}`)) {
        throw new SemanticUnavailable('the embedding server answered with a redirect; redirects are refused so card text stays on this machine');
      }
      throw new SemanticUnavailable(`embedding server not reachable at ${endpoint} (${error.name})`);
    }
    if (!response.ok) {
      throw new SemanticUnavailable(`embedding server answered ${response.status}; is ${modelName} pulled?`);
    }
    const data = await response.json().catch(() => null);
    const rows = isOllama ? data && data.embeddings : data && Array.isArray(data.data) && data.data.map(d => d.embedding);
    if (!Array.isArray(rows) || rows.length !== texts.length) throw new SemanticUnavailable('embedding server returned an unexpected shape');
    return rows.map(row => {
      if (!Array.isArray(row) || row.length !== DIMS || !row.every(Number.isFinite)) {
        throw new SemanticUnavailable(`embedding size is not ${DIMS}; refusing to mix vector spaces`);
      }
      return normalize(row);
    });
  }

  // The model digest the server reports for this model name (Ollama's /api/tags), or null when
  // it does not say. Best effort: the probe is the check that always runs.
  async function fetchDigest() {
    if (backend !== 'ollama') return null;
    try {
      const response = await fetchImpl(`${endpoint}/api/tags`, { redirect: 'error', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!response.ok) return null;
      const data = await response.json();
      const names = [modelName, `${modelName}:latest`];
      const found = Array.isArray(data && data.models) && data.models.find(m => m && (names.includes(m.name) || names.includes(m.model)));
      return found && typeof found.digest === 'string' ? found.digest : null;
    } catch { return null; }
  }

  const reindexHint = why => new SemanticUnavailable(`${why}; run serve --reindex to rebuild`);

  // Refuses a cache whose vectors this server would no longer reproduce.
  async function checkFingerprint(saved) {
    if (!saved.probe || typeof saved.probe.v !== 'string') throw reindexHint('the stored vectors carry no identity probe');
    const [now] = await embed([PROBE_TEXT]);
    const similarity = dot(now, decode(saved.probe.v));
    if (!(similarity >= PROBE_MIN_COSINE)) {
      throw reindexHint(`the identity probe no longer matches (similarity ${Number.isFinite(similarity) ? similarity.toFixed(3) : 'n/a'}, need ${PROBE_MIN_COSINE}): a different model is answering as ${modelName} at ${endpoint}`);
    }
    if (saved.digest) {
      const digest = await fetchDigest();
      if (digest && digest !== saved.digest) {
        throw reindexHint(`${modelName} now reports digest ${digest.slice(0, 19)}, the stored vectors were built with ${String(saved.digest).slice(0, 19)}`);
      }
    }
  }

  // The stored cache, or null when there is none (or it is unreadable JSON, which is rebuilt).
  // Refuses a cache built under a different identity, and any path that would leave the folder.
  function readCache() {
    const dir = pinAuxDir(store.folder, '.index');
    if (!dir) return null;
    const text = readFileNoFollow(path.join(dir.path, 'embeddings.json'));
    dir.check(); // the folder is still the one that was validated
    if (text === null) return null;
    let saved;
    try { saved = JSON.parse(text); } catch { return null; }
    const same = saved && saved.identity &&
      saved.identity.backend === identity.backend && saved.identity.model === identity.model && saved.identity.dims === identity.dims;
    if (!same) {
      throw new SemanticUnavailable(
        `stored vectors were built with ${JSON.stringify(saved && saved.identity)}, not ${JSON.stringify(identity)}; run serve --reindex to rebuild`,
      );
    }
    return saved;
  }

  function saveCache({ vectors, probe, digest }) {
    const dir = pinAuxDir(store.folder, '.index', { create: true });
    writeFileAtomic(
      path.join(dir.path, 'embeddings.json'),
      JSON.stringify({ identity, embedUrl: endpoint, digest, probe, vectors }),
      { beforeCommit: dir.check },
    );
  }

  function reset() {
    const dir = pinAuxDir(store.folder, '.index');
    if (dir) fs.rmSync(path.join(dir.path, 'embeddings.json'), { force: true });
  }

  // A refused path is "semantic unavailable" like any other reason the cache cannot be used.
  const unavailable = error => (error instanceof GuardError ? new SemanticUnavailable(error.message) : error);

  // Embeds every card that is new or changed since its vector was stored. Returns the counts and
  // `vectors`: the verified snapshot (cache entries that passed the fingerprint plus the ones just
  // embedded), which is what ranking must use.
  async function syncNow() {
    const saved = readCache();
    const known = saved ? saved.vectors : {};
    const next = {};
    const pending = [];
    for (const file of store.cardFiles()) {
      let card;
      try { card = store.loadCard(file); } catch { continue; }
      const hash = crypto.createHash('sha256').update(card.text).digest('hex');
      if (known[file] && known[file].hash === hash) next[file] = known[file];
      else pending.push({ file, hash, text: `${DOCUMENT_PREFIX}${card.name.replace(/-/g, ' ')}. ${card.description}\n${card.body}`.slice(0, 6000) });
    }
    let probe = saved && saved.probe;
    let digest = saved ? saved.digest || null : null;
    if (saved) await checkFingerprint(saved);
    else if (pending.length) {
      const [vector] = await embed([PROBE_TEXT]);
      probe = { text: PROBE_TEXT, v: encode(vector) };
      digest = await fetchDigest();
    }
    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH);
      const vectors = await embed(slice.map(p => p.text));
      slice.forEach((p, j) => { next[p.file] = { hash: p.hash, v: encode(vectors[j]) }; });
    }
    if (pending.length || Object.keys(next).length !== Object.keys(known).length) saveCache({ vectors: next, probe, digest });
    return { embedded: pending.length, total: Object.keys(next).length, vectors: next };
  }

  async function sync() {
    try {
      const { embedded, total } = await syncNow();
      return { embedded, total };
    } catch (error) { throw unavailable(error); }
  }

  // Best-first [{name, score}] by cosine similarity, or throws SemanticUnavailable.
  async function rank(query, limit = 10) {
    try {
      const { vectors } = await syncNow(); // the snapshot that was verified; the file is not read again
      const [q] = await embed([`${QUERY_PREFIX}${query}`]);
      return Object.entries(vectors)
        .map(([file, entry]) => ({ name: file.slice(0, -3), score: dot(q, decode(entry.v)) }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
    } catch (error) {
      throw unavailable(error);
    }
  }

  return { identity, rank, sync, reset };
}

module.exports = { createSemantic, SemanticUnavailable, DEFAULTS, DIMS, QUERY_PREFIX, DOCUMENT_PREFIX };
