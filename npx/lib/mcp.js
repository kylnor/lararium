'use strict';
// The four tools, built per caller. A read-tier caller gets a server that does not have `remember`
// at all, so the refusal does not depend on a check inside a handler.
const { McpServer } = require('@modelcontextprotocol/sdk/server/mcp.js');
const { z } = require('zod');
const { InputError, GuardError, CARD_TYPES } = require('./store');
const { SemanticUnavailable } = require('./embed');

const INSTRUCTIONS = [
  'This is the owner\'s own memory: small cards, one fact per file, kept in a folder their coding agents also read.',
  'Use `search` before answering questions about the owner, their work, or their preferences. Use `read` to open a card in full.',
  'Use `remember` (if offered) to save one durable fact the moment you learn it. One fact per card; say why it is true and when it applies.',
  'Never save secrets, credentials or raw transcripts.',
].join(' ');

const text = value => ({ content: [{ type: 'text', text: value }] });
const failure = message => ({ isError: true, content: [{ type: 'text', text: message }] });

// Turns store errors the caller can act on into tool errors; anything else is a real failure.
async function guarded(fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof InputError || error instanceof GuardError) return failure(error.message);
    throw error;
  }
}

// Reciprocal-rank fusion: merges the full-text ranking and the semantic ranking without having to
// compare their scores, which live on different scales.
function fuse(lists, limit) {
  const score = new Map();
  for (const list of lists) {
    list.forEach((item, i) => score.set(item.name, (score.get(item.name) || 0) + 1 / (60 + i)));
  }
  return [...score.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name]) => name);
}

function createMcpServer({ store, semantic = null, role, version }) {
  const server = new McpServer({ name: 'lararium-memory', version }, { instructions: INSTRUCTIONS });

  server.registerTool('search', {
    title: 'Search memory',
    description: 'Search the owner\'s memory cards. Pass the topic in plain words ("pricing preferences", "Jane Doe"). Returns the best matches with a snippet; use `read` for the full card.',
    inputSchema: { query: z.string().min(1).max(500), limit: z.number().int().min(1).max(50).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ query, limit = 10 }) => guarded(async () => {
    const byText = store.searchText(query, { limit: 50 });
    let mode = 'full-text';
    let names = byText.slice(0, limit).map(r => r.name);
    if (semantic) {
      try {
        const bySemantic = await semantic.rank(query, 50);
        names = fuse([byText, bySemantic], limit);
        mode = 'hybrid (full-text + EmbeddingGemma 2)';
      } catch (error) {
        if (!(error instanceof SemanticUnavailable)) throw error;
        mode = `full-text (semantic search unavailable: ${error.message})`;
      }
    }
    const known = new Map(byText.map(r => [r.name, r]));
    const rows = names.map(name => {
      if (known.has(name)) return known.get(name);
      const card = store.loadCard(`${name}.md`);
      return { name, description: card.description, type: card.type, score: 0, snippet: card.body.replace(/\s+/g, ' ').slice(0, 200) };
    });
    if (!rows.length) return text(`No cards matched "${query}". Search mode: ${mode}.`);
    const lines = rows.map(r => `- ${r.name} [${r.type}] ${r.description}\n  ${r.snippet}`);
    return text(`${rows.length} match(es). Search mode: ${mode}.\n${lines.join('\n')}`);
  }));

  server.registerTool('read', {
    title: 'Read a memory card',
    description: 'Open one card in full by name (for example "prefers-short-replies"). `MEMORY` opens the index.',
    inputSchema: { name: z.string().min(1).max(120) },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ name }) => guarded(() => text(store.read(name).text)));

  server.registerTool('list', {
    title: 'List memory cards',
    description: 'List every card with its type and one-line description, optionally only one type.',
    inputSchema: { type: z.enum(CARD_TYPES).optional() },
    annotations: { readOnlyHint: true, openWorldHint: false },
  }, ({ type }) => guarded(() => {
    const cards = store.list({ type });
    if (!cards.length) return text('No cards yet.');
    return text(`${cards.length} card(s).\n${cards.map(c => `- ${c.name} [${c.type}]${c.inIndex ? '' : ' (not in index)'} ${c.description}`).join('\n')}`);
  }));

  if (role === 'write') {
    server.registerTool('remember', {
      title: 'Remember a fact',
      description: 'Save one durable fact as its own card and add it to the index. One fact per call. Refuses a name that already exists.',
      inputSchema: {
        name: z.string().min(1).max(80).describe('kebab-case, a short sentence that states the claim'),
        description: z.string().min(1).max(300).describe('one line, specific enough to decide relevance without opening the card'),
        type: z.enum(CARD_TYPES).describe('user: who they are; feedback: a correction or confirmed way of working; project: true about a piece of work, dated; reference: where a thing lives'),
        body: z.string().min(1).max(20000).describe('the fact, then Why and How to apply for feedback and project cards'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    }, input => guarded(async () => {
      const saved = await store.remember(input);
      const warn = saved.indexOverBudget ? ' The index is now past 200 lines or 24 KB: tell the owner to demote older cards.' : '';
      return text(`Saved ${saved.file} and added to the index: ${saved.indexLine}${warn}`);
    }));
  }

  return server;
}

module.exports = { createMcpServer, INSTRUCTIONS };
