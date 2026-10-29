'use strict';
// Optional semantic search on a local EmbeddingGemma 2. Off unless asked for. One model and one
// dimensionality are pinned, the identity is stored next to the vectors, and vectors from a
// different identity are never mixed in: the same dimension from a different model is still a
// different space. Anything that goes wrong (server down, model missing, wrong size) raises
// SemanticUnavailable and the caller falls back to full-text. Text only ever goes to a loopback
// address.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const DEFAULTS = {
  ollama: { url: 'http://127.0.0.1:11434', model: 'embeddinggemma-2:270m' },
  llamacpp: { url: 'http://127.0.0.1:8080', model: 'embeddinggemma-2' },
};
const DIMS = 768;
const QUERY_PREFIX = 'task: search result | query: ';
const DOCUMENT_PREFIX = 'title: none | text: ';
const REQUEST_TIMEOUT_MS = 20000;
const BATCH = 16;

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
      });
    } catch (error) {
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

  function loadVectors() {
    let saved;
    try { saved = JSON.parse(fs.readFileSync(vectorFile, 'utf8')); } catch { return { vectors: {} }; }
    const same = saved && saved.identity &&
      saved.identity.backend === identity.backend && saved.identity.model === identity.model && saved.identity.dims === identity.dims;
    if (!same) {
      throw new SemanticUnavailable(
        `stored vectors were built with ${JSON.stringify(saved && saved.identity)}, not ${JSON.stringify(identity)}; run serve --reindex to rebuild`,
      );
    }
    return saved;
  }

  function saveVectors(vectors) {
    fs.mkdirSync(vectorDir, { recursive: true });
    const temp = `${vectorFile}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(temp, JSON.stringify({ identity, vectors }));
    fs.renameSync(temp, vectorFile);
  }

  function reset() {
    fs.rmSync(vectorFile, { force: true });
  }

  // Embeds every card that is new or changed since its vector was stored.
  async function sync() {
    const saved = loadVectors().vectors;
    const next = {};
    const pending = [];
    for (const file of store.cardFiles()) {
      let card;
      try { card = store.loadCard(file); } catch { continue; }
      const hash = crypto.createHash('sha256').update(card.text).digest('hex');
      if (saved[file] && saved[file].hash === hash) next[file] = saved[file];
      else pending.push({ file, hash, text: `${DOCUMENT_PREFIX}${card.name.replace(/-/g, ' ')}. ${card.description}\n${card.body}`.slice(0, 6000) });
    }
    for (let i = 0; i < pending.length; i += BATCH) {
      const slice = pending.slice(i, i + BATCH);
      const vectors = await embed(slice.map(p => p.text));
      slice.forEach((p, j) => { next[p.file] = { hash: p.hash, v: encode(vectors[j]) }; });
    }
    if (pending.length || Object.keys(next).length !== Object.keys(saved).length) saveVectors(next);
    return { embedded: pending.length, total: Object.keys(next).length };
  }

  // Best-first [{name, score}] by cosine similarity, or throws SemanticUnavailable.
  async function rank(query, limit = 10) {
    await sync();
    const [q] = await embed([`${QUERY_PREFIX}${query}`]);
    const { vectors } = loadVectors();
    return Object.entries(vectors)
      .map(([file, entry]) => ({ name: file.slice(0, -3), score: dot(q, decode(entry.v)) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  return { identity, rank, sync, reset };
}

module.exports = { createSemantic, SemanticUnavailable, DEFAULTS, DIMS, QUERY_PREFIX, DOCUMENT_PREFIX };
