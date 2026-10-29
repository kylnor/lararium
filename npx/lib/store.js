'use strict';
// The memory folder as a store. Files stay canonical: this module reads and writes exactly the v3
// card format (memory/README.md): one fact per file with name/description/type frontmatter, plus a
// newest-first line in the MEMORY.md index. Nothing here is a database.
const fs = require('node:fs');
const path = require('node:path');
const { GuardError, resolveInside, readFileNoFollow, writeFileAtomic } = require('./guard');
const { createLock, LockBusy, LockLost } = require('./lock');

const CARD_TYPES = ['user', 'feedback', 'project', 'reference'];
const NOT_CARDS = new Set(['MEMORY.md', 'DEMOTED.md', 'README.md', 'pointer-block.md']);
const CARD_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_CARD_NAME = 80;
const MAX_DESCRIPTION = 300;
const MAX_BODY = 20000;
const INDEX_MAX_LINES = 200;
const INDEX_MAX_BYTES = 24000;
const LOCK_NAME = '.memory-index.lock';
const LOCK_STALE_MS = 10000; // a holder that is gone leaves its lock; after this long it is taken over
const LOCK_WAIT_MS = 15000; // how long remember waits for another process before giving up
const STOPWORDS = new Set((
  'a an and are as at be by do does for from has have how i in is it me my of on or our so ' +
  'that the this to was we what when where which who why with you your about remember know tell'
).split(' '));

class InputError extends Error {
  constructor(message) {
    super(message);
    this.name = 'InputError';
  }
}

function parseCard(file, text) {
  const card = { name: file.slice(0, -3), description: '', type: '', body: text };
  if (!text.startsWith('---\n')) return card;
  const end = text.indexOf('\n---', 4);
  if (end === -1) return card;
  const front = text.slice(4, end);
  const field = key => {
    const m = front.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm'));
    if (!m) return '';
    const raw = m[1].trim();
    if (raw.startsWith('"')) { // written by yamlLine below: a JSON string is a YAML double-quoted scalar
      try { return String(JSON.parse(raw)); } catch { /* fall through to the loose reader */ }
    }
    return raw.replace(/^["']|["']$/g, '');
  };
  card.description = field('description');
  card.type = field('type');
  card.body = text.slice(end + 4).replace(/^\r?\n/, '');
  return card;
}

// One frontmatter value as a YAML scalar. Most descriptions are fine as plain text, but a ": " or
// " #" inside one, a leading indicator character, or a value YAML reads as a number, date or boolean
// breaks strict parsers. Those get double quotes; a JSON string is valid double-quoted YAML.
const YAML_NON_STRING = /^(?:true|false|yes|no|on|off|null|~|y|n|[-+]?(?:\d[\d_,.:+\-eExX]*|\.\d+|\.inf|\.nan))$/i;
function yamlLine(value) {
  const risky = !/^[A-Za-z0-9(]/.test(value) || /:(?:\s|$)|\s#|\s$|[\u0000-\u001f\\]/.test(value) || YAML_NON_STRING.test(value);
  return risky ? JSON.stringify(value) : value;
}

function tokenize(query) {
  const all = [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || [])];
  const kept = all.filter(t => !STOPWORDS.has(t));
  return kept.length ? kept : all;
}

function snippetFor(body, terms) {
  const flat = body.replace(/\s+/g, ' ').trim();
  const lower = flat.toLowerCase();
  let at = -1;
  for (const term of terms) {
    const i = lower.indexOf(term);
    if (i !== -1 && (at === -1 || i < at)) at = i;
  }
  const start = Math.max(0, (at === -1 ? 0 : at) - 60);
  const piece = flat.slice(start, start + 220);
  return `${start > 0 ? '...' : ''}${piece}${start + 220 < flat.length ? '...' : ''}`;
}

// Index maintenance. The shipped header comment contains example lines that look like entries, so
// comment regions are skipped when finding where the real entries start.
function entryLineIndexes(lines) {
  const out = [];
  let inComment = false;
  lines.forEach((line, i) => {
    const opens = line.includes('<!--');
    const closes = line.includes('-->');
    const wasIn = inComment;
    if (opens && !closes) inComment = true;
    if (closes && wasIn) inComment = false;
    if (!wasIn && !opens && /^- /.test(line)) out.push(i);
  });
  return out;
}

// The card files an index text points at, in either shape of entry line.
function pointersOf(indexText) {
  const lines = indexText.split('\n');
  const set = new Set();
  for (const i of entryLineIndexes(lines)) {
    const m = lines[i].match(/^- (?:\[[^\]]*\]\(([^)]+\.md)\)|(\S+\.md))/);
    if (m) set.add(path.basename(m[1] || m[2]));
  }
  return set;
}

function withEntry(indexText, entry) {
  const lines = indexText.split('\n');
  const entries = entryLineIndexes(lines);
  if (entries.length) {
    lines.splice(entries[0], 0, entry);
    return lines.join('\n');
  }
  return `${indexText.replace(/\s+$/, '')}\n${entry}\n`;
}

function createStore({ root, lockStaleMs = LOCK_STALE_MS, lockWaitMs = LOCK_WAIT_MS }) {
  const folder = path.resolve(root);
  if (!fs.existsSync(folder) || !fs.statSync(folder).isDirectory()) {
    throw new InputError(`memory folder not found: ${folder}`);
  }
  // One writer at a time inside this process; across processes (several stdio servers on one
  // folder) the index update runs under a lock file, see withIndexLock.
  let writing = Promise.resolve();

  // Cross-process mutex for the read-modify-rename of MEMORY.md, see lock.js. A lock that stays
  // busy past lockWaitMs refuses the remember with a clear error (and writes nothing) rather than
  // risk a lost update. `fn` gets the held lock so it can confirm ownership right before it commits.
  async function withIndexLock(fn) {
    const lock = createLock({ file: path.join(fs.realpathSync(folder), LOCK_NAME), staleMs: lockStaleMs, waitMs: lockWaitMs });
    let held;
    try {
      held = await lock.acquire();
    } catch (error) {
      if (error instanceof LockBusy) throw new InputError(error.message);
      throw error;
    }
    try {
      return await fn(held);
    } catch (error) {
      if (error instanceof LockLost) throw new InputError('the memory index changed while saving; send the same request again');
      throw error;
    } finally {
      held.release();
    }
  }

  function cardFiles() {
    return fs.readdirSync(folder)
      .filter(f => f.endsWith('.md') && !NOT_CARDS.has(f) && /^[A-Za-z0-9]/.test(f))
      .sort();
  }

  function loadCard(file) {
    const text = readFileNoFollow(resolveInside(folder, file));
    if (text === null) throw new GuardError(`${file} is no longer there`);
    return { file, text, ...parseCard(file, text) };
  }

  function pointered() {
    const index = readFileNoFollow(path.join(fs.realpathSync(folder), 'MEMORY.md')); // a symlinked index is a GuardError, not an empty one
    return index === null ? new Set() : pointersOf(index);
  }

  function list({ type } = {}) {
    const indexed = pointered();
    const cards = [];
    for (const file of cardFiles()) {
      let card;
      try { card = loadCard(file); } catch (error) {
        if (error instanceof GuardError) continue; // a symlink or odd entry: not served
        throw error;
      }
      if (type && card.type !== type) continue;
      cards.push({ name: card.name, description: card.description, type: card.type, inIndex: indexed.has(file) });
    }
    return cards;
  }

  function read(name) {
    const full = resolveInside(folder, name);
    const text = readFileNoFollow(full);
    if (text === null) throw new InputError('no such card');
    return { name: path.basename(full, '.md'), text };
  }

  // Full-text ranking over name, description and body. Returns every scored card, best first.
  function searchText(query, { limit = 10 } = {}) {
    const terms = tokenize(query);
    if (!terms.length) return [];
    const scored = [];
    for (const file of cardFiles()) {
      let card;
      try { card = loadCard(file); } catch (error) {
        if (error instanceof GuardError) continue;
        throw error;
      }
      const name = card.name.replace(/-/g, ' ').toLowerCase();
      const description = card.description.toLowerCase();
      const body = card.body.toLowerCase();
      let score = 0;
      let matched = 0;
      for (const term of terms) {
        const inName = name.includes(term);
        const inDescription = description.includes(term);
        const count = body.split(term).length - 1;
        if (inName || inDescription || count) matched += 1;
        score += (inName ? 4 : 0) + (inDescription ? 3 : 0) + Math.min(count, 5);
      }
      if (!matched) continue;
      score += (matched / terms.length) * 6;
      scored.push({
        name: card.name,
        description: card.description,
        type: card.type,
        score: Math.round(score * 100) / 100,
        snippet: snippetFor(card.body, terms),
      });
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return scored.slice(0, limit);
  }

  function validate({ name, description, type, body }) {
    if (typeof name !== 'string' || name.length > MAX_CARD_NAME || !CARD_NAME_RE.test(name)) {
      throw new InputError(`name must be kebab-case (lowercase letters, digits, single dashes), at most ${MAX_CARD_NAME} characters`);
    }
    if (!CARD_TYPES.includes(type)) throw new InputError(`type must be one of ${CARD_TYPES.join(', ')}`);
    const oneLine = typeof description === 'string' ? description.replace(/\s+/g, ' ').trim() : '';
    if (!oneLine || oneLine.length > MAX_DESCRIPTION) {
      throw new InputError(`description must be one line of 1 to ${MAX_DESCRIPTION} characters`);
    }
    if (typeof body !== 'string' || !body.trim() || body.length > MAX_BODY || body.includes('\0')) {
      throw new InputError(`body must be non-empty text of at most ${MAX_BODY} characters`);
    }
    return { name, description: oneLine, type, body: body.replace(/\s+$/, '') };
  }

  // Writes one card and prepends its index line, both under the index lock. Never overwrites: a
  // name that exists is refused, with one exception that makes a retry safe. If the card on disk is
  // byte for byte what this call would write and the index has no line for it, an earlier call
  // wrote the card and stopped before the index; this call finishes that index line.
  // The index is read (through a no-follow descriptor) before the card is written, so a refused
  // index leaves no orphan card.
  async function rememberNow(input) {
    const card = validate(input);
    return withIndexLock(lock => {
      const indexPath = path.join(fs.realpathSync(folder), 'MEMORY.md');
      const target = resolveInside(folder, card.name);
      const text = `---\nname: ${card.name}\ndescription: ${yamlLine(card.description)}\ntype: ${card.type}\n---\n\n${card.body}\n`;
      const entry = `- ${card.name}.md - ${card.description}`;
      const current = readFileNoFollow(indexPath);
      const indexText = current === null ? '# Memory\n\n' : current;
      const alreadyIndexed = pointersOf(indexText).has(`${card.name}.md`);
      try {
        fs.writeFileSync(target, text, { flag: 'wx', mode: 0o644 });
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (alreadyIndexed || readFileNoFollow(target) !== text) {
          throw new InputError(`a card named ${card.name} already exists; choose a different name`);
        }
      }
      const updated = alreadyIndexed ? indexText : withEntry(indexText, entry);
      if (!alreadyIndexed) writeFileAtomic(indexPath, updated, { beforeCommit: () => lock.assertOwned() });
      const lineCount = updated.split('\n').length;
      const bytes = Buffer.byteLength(updated);
      return {
        name: card.name,
        file: `${card.name}.md`,
        indexLine: entry,
        indexOverBudget: lineCount > INDEX_MAX_LINES || bytes > INDEX_MAX_BYTES,
      };
    });
  }

  function remember(input) {
    const run = writing.then(() => rememberNow(input));
    writing = run.catch(() => {});
    return run;
  }

  return { folder, list, read, searchText, remember, cardFiles, loadCard };
}

module.exports = { createStore, InputError, GuardError, CARD_TYPES, tokenize };
