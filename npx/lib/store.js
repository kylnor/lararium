'use strict';
// The memory folder as a store. Files stay canonical: this module reads and writes exactly the v3
// card format (memory/README.md): one fact per file with name/description/type frontmatter, plus a
// newest-first line in the MEMORY.md index. Nothing here is a database.
//
// The cards are canonical; the index line is derived. Index writes from separate processes can race
// (the lock in lock.js narrows that, it cannot close it), so every card this server writes is also
// recorded in an append-only journal beside the cards, and the index converges on the journal: after
// each commit, and once at server start (a writable server only), a journaled card that exists, has no
// pointer and is not in DEMOTED.md gets its line back. A lost line is a short-lived orphan, never a
// lost card. The one gap: a crash between creating a card and journaling it leaves an unjournaled
// card, which memory-check reports as orphaned and repair does not adopt (it cannot tell it from a
// hand-written one).
//
// Provenance is bound to the card the server wrote, not to a name. Each remember call draws a random
// nonce, writes it into the card's frontmatter (`lararium-id`) and into a self-validating journal
// record. Repair and the identical-bytes retry adopt a card only when its nonce matches a valid record
// for that name, so a hand-written card of the same name is never taken for ours, and a torn, short or
// failed journal append (which the caller sees as a failed remember) cannot be completed into a record
// by whatever is appended later.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { GuardError, resolveInside, openNoFollow, readFileNoFollow, writeFileAtomic } = require('./guard');
const { createLock, LockBusy, LockLost } = require('./lock');

const CARD_TYPES = ['user', 'feedback', 'project', 'reference'];
const JOURNAL_NAME = '.lararium-remembered'; // one `\nL1 <name>.md <nonce> <check>\n` record per card this server wrote
const NOT_CARDS = new Set(['MEMORY.md', 'DEMOTED.md', 'README.md', 'pointer-block.md', JOURNAL_NAME]);
const JOURNAL_RECORD_RE = /^L1 ([a-z0-9]+(?:-[a-z0-9]+)*\.md) ([0-9a-f]{24}) ([0-9a-f]{16})$/;
const CARD_ID_KEY = 'lararium-id';
// An index entry line: `- name.md` or `- [text](path/name.md)`, followed by anything (usually ` - hook`).
// Names are kept loose so hand-written cards still show as indexed. hooks/memory-check.mjs carries the
// same parser (it ships standalone); tests/serve-store.test.mjs runs both against one fixture table.
const ENTRY_RE = /^- (?:\[[^\]]*\]\(([^)]+\.md)\)|([A-Za-z0-9][A-Za-z0-9._-]*\.md)(?![A-Za-z0-9._-]))/;
const HTML_COMMENT_MARK = /<!--|-->/;
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/; // C0, DEL and C1 (U+009B is a one-character CSI)
const HEAL_PASSES = 5; // re-reads of the index after a commit before giving up (the next remember or start retries)
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
  const card = { name: file.slice(0, -3), description: '', type: '', id: '', body: text };
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
  card.id = field(CARD_ID_KEY);
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

// Index maintenance. One parser serves pointer detection, the insertion point and repair, so they can
// never disagree about what counts as a pointer. A comment block starts with a line that begins with
// `<!--` and runs to the first line holding `-->`; lines inside it (the shipped header has example
// entries) are not pointers. A line is a pointer when it matches ENTRY_RE outside such a block.
function parseIndex(indexText) {
  const lines = indexText.split('\n');
  const entries = []; // { at, file }
  let inComment = false;
  lines.forEach((raw, at) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (inComment) {
      if (line.includes('-->')) inComment = false;
      return;
    }
    if (line.startsWith('<!--')) {
      if (!line.includes('-->', 4)) inComment = true;
      return;
    }
    const m = line.match(ENTRY_RE);
    if (m) entries.push({ at, file: path.basename(m[1] || m[2]) });
  });
  return { lines, entries, unclosed: inComment };
}

// The card files an index text points at, in either shape of entry line.
function pointersOf(indexText) {
  return new Set(parseIndex(indexText).entries.map(e => e.file));
}

function withEntry(indexText, entry) {
  const { lines, entries } = parseIndex(indexText);
  if (entries.length) {
    lines.splice(entries[0].at, 0, entry);
    return lines.join('\n');
  }
  return `${indexText.replace(/\s+$/, '')}\n${entry}\n`;
}

// ---- journal records ----------------------------------------------------------------------------
// A record is `\nL1 <name>.md <nonce> <check>\n`: <nonce> is 24 hex characters, <check> is the first 16 hex
// characters of the sha-256 of everything before it (`L1 <name>.md <nonce>`). Two rules make a record
// self-validating, and neither depends on what is appended later:
//   1. The line must match the format and its checksum, so no torn prefix of it is a record.
//   2. The line must end in a newline and the next line must be empty (end of file, or the leading
//      newline of the next record). A record missing only its final newline, with the next record's
//      leading newline completing it, would pass rule 1; it fails here because the next record's
//      content follows directly.
function journalRecord(file, nonce) {
  const body = `L1 ${file} ${nonce}`;
  return `\n${body} ${journalCheck(body)}\n`;
}

function journalCheck(body) {
  return crypto.createHash('sha256').update(body).digest('hex').slice(0, 16);
}

function parseJournal(text) {
  const lines = text.split('\n');
  const records = [];
  for (let at = 0; at < lines.length - 1; at += 1) { // the last element has no newline after it: unterminated
    if (lines[at + 1] !== '' || lines[at].length > 200) continue;
    const m = lines[at].match(JOURNAL_RECORD_RE);
    if (!m || m[1].length > MAX_CARD_NAME + 3) continue;
    if (journalCheck(`L1 ${m[1]} ${m[2]}`) !== m[3]) continue;
    records.push({ file: m[1], nonce: m[2] });
  }
  return records;
}

function cardText(card, nonce) {
  return `---\nname: ${card.name}\ndescription: ${yamlLine(card.description)}\ntype: ${card.type}\n${CARD_ID_KEY}: ${nonce}\n---\n\n${card.body}\n`;
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

  // ---- the journal and the convergent index -------------------------------------------------
  const realFolder = () => fs.realpathSync(folder);

  // Records a card this server just wrote. One write(2) on an O_APPEND descriptor, no lock: appends from
  // separate processes land one after another on a local disk. Not atomic on network disks. A short
  // write or a failed close throws: the record may be torn or half-trusted, so the caller must treat the
  // card as not remembered (journalRecord and parseJournal say why that is safe).
  function journalAppend(file, nonce) {
    const record = Buffer.from(journalRecord(file, nonce));
    const fd = openNoFollow(path.join(realFolder(), JOURNAL_NAME), fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT, 0o644);
    let failure = null;
    try {
      if (!fs.fstatSync(fd).isFile()) throw new GuardError(`${JOURNAL_NAME} is not a regular file`);
      const written = fs.writeSync(fd, record);
      if (written !== record.length) throw Object.assign(new Error(`the memory journal write was short (${written} of ${record.length} bytes)`), { code: 'SHORT_WRITE' });
    } catch (error) {
      failure = error;
    }
    try {
      fs.closeSync(fd);
    } catch (error) {
      failure = failure || error; // a close error after a whole write still fails the call
    }
    if (failure) throw failure;
  }

  // The valid journal records, oldest first, as a Map of card file to the nonces recorded for it (a name
  // can be remembered, deleted and remembered again). See parseJournal for what counts as valid.
  function journaled() {
    const text = readFileNoFollow(path.join(realFolder(), JOURNAL_NAME));
    const out = new Map();
    for (const { file, nonce } of text === null ? [] : parseJournal(text)) {
      if (!out.has(file)) out.set(file, new Set());
      out.get(file).add(nonce);
    }
    return out;
  }

  // Cards listed in DEMOTED.md: pull-tier on purpose, never given a pointer back.
  function demotedFiles() {
    const text = readFileNoFollow(path.join(realFolder(), 'DEMOTED.md'));
    const out = new Set();
    if (text === null) return out;
    for (const line of text.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
      const m = line.match(/^- (\S+\.md)/);
      if (m) out.add(m[1]);
    }
    return out;
  }

  // The index hook for a card: its own description folded to one line, unless the card file (which a
  // local writer can edit) holds something an index line must not carry; then the name stands in.
  function hookFor(card) {
    const one = card.description.replace(/\s+/g, ' ').trim();
    const plain = one && !HTML_COMMENT_MARK.test(one) && !CONTROL_CHARS.test(one);
    return (plain ? one : card.name.replace(/-/g, ' ')).slice(0, MAX_DESCRIPTION);
  }

  // Index lines for the journaled cards that exist, have no pointer in `indexText` and were not
  // demoted. A card counts only if it carries a nonce the journal recorded for its name: cards written
  // by hand, and hand-written cards that reuse a journaled name, are never touched.
  function missingLines(indexText) {
    const pointers = pointersOf(indexText);
    const demoted = demotedFiles();
    const lines = [];
    for (const [file, nonces] of journaled()) {
      if (pointers.has(file) || demoted.has(file)) continue;
      let card;
      try { card = loadCard(file); } catch (error) {
        if (error instanceof GuardError) continue; // gone, or a link: nothing to point at
        throw error;
      }
      if (!card.id || !nonces.has(card.id)) continue;
      lines.push(`- ${file} - ${hookFor(card)}`);
    }
    return lines;
  }

  // Re-reads the index and puts back what a concurrent writer dropped, up to HEAL_PASSES times.
  // Runs under the lock. Best effort: a lock lost mid-way or an unreadable aux file ends the repair,
  // the next remember or server start picks it up. Returns how many lines were restored.
  // It only adds a line that the parser will then see as a pointer (checked on the text it is about
  // to write), tries each card once per call, and stops when a pass adds nothing: an index it cannot
  // fix (an unclosed comment) is left alone instead of growing on every run.
  function converge(lock, indexPath) {
    let restored = 0;
    const tried = new Set();
    for (let pass = 0; pass < HEAL_PASSES; pass += 1) {
      const current = readFileNoFollow(indexPath);
      const text = current === null ? '# Memory\n\n' : current;
      if (parseIndex(text).unclosed) return restored;
      let missing;
      try { missing = missingLines(text); } catch (error) {
        if (error instanceof GuardError) return restored;
        throw error;
      }
      let next = text;
      let added = 0;
      for (const line of missing) { // oldest first, so the newest ends on top
        const file = line.slice(2).split(' ')[0];
        if (tried.has(file)) continue;
        tried.add(file);
        const candidate = withEntry(next, line);
        if (!pointersOf(candidate).has(file)) continue;
        next = candidate;
        added += 1;
      }
      if (!added) return restored;
      try {
        writeFileAtomic(indexPath, next, { beforeCommit: () => lock.assertOwned() });
      } catch (error) {
        if (error instanceof LockLost) return restored;
        throw error;
      }
      restored += added;
    }
    return restored;
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
    // The description becomes an index line: a comment marker would hide or open a region of the index,
    // and a control character has no place in a one-line hook.
    if (HTML_COMMENT_MARK.test(oneLine)) throw new InputError('description must not contain an HTML comment marker (<!-- or -->)');
    if (CONTROL_CHARS.test(oneLine)) throw new InputError('description must be plain text without control characters');
    if (typeof body !== 'string' || !body.trim() || body.length > MAX_BODY || body.includes('\0')) {
      throw new InputError(`body must be non-empty text of at most ${MAX_BODY} characters`);
    }
    return { name, description: oneLine, type, body: body.replace(/\s+$/, '') };
  }

  // Writes one card, journals it, and prepends its index line, under the index lock. Never
  // overwrites: a name that exists is refused, with one exception that makes a retry safe. If the
  // card on disk carries a nonce the journal recorded for that name (so this server made it; a
  // hand-written card cannot), is otherwise byte for byte what this call would write, has no index
  // line and was not demoted, an earlier call wrote the card and stopped before the index; this call
  // finishes that line and writes no second record.
  // The index and the journal are read (through no-follow descriptors) before the card is written,
  // so a refused aux file leaves no orphan card. The card is created first, then journaled; if the
  // journal append fails (an error, a short write, a failed close) the call fails and the card this
  // call created is removed. If that removal fails too, the error says so and names the card, because
  // it may remain. After the index commit the index is re-read and any journaled card whose line a
  // concurrent writer dropped is restored (see converge).
  async function rememberNow(input) {
    const card = validate(input);
    return withIndexLock(lock => {
      const indexPath = path.join(realFolder(), 'MEMORY.md');
      const target = resolveInside(folder, card.name);
      const file = `${card.name}.md`;
      const nonce = crypto.randomBytes(12).toString('hex');
      const text = cardText(card, nonce);
      const entry = `- ${file} - ${card.description}`;
      const current = readFileNoFollow(indexPath);
      const indexText = current === null ? '# Memory\n\n' : current;
      if (parseIndex(indexText).unclosed) throw new InputError('MEMORY.md ends inside an unclosed <!-- comment, so a new line would be hidden; close the comment first');
      const alreadyIndexed = pointersOf(indexText).has(file);
      const known = journaled(); // a journal that is a link or not a file refuses here, before any card exists
      let created = false;
      try {
        fs.writeFileSync(target, text, { flag: 'wx', mode: 0o644 });
        created = true;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const onDisk = readFileNoFollow(target);
        const id = onDisk === null ? '' : parseCard(file, onDisk).id;
        const serverMade = Boolean(id) && Boolean(known.get(file) && known.get(file).has(id));
        if (!serverMade || alreadyIndexed || onDisk !== cardText(card, id) || demotedFiles().has(file)) {
          throw new InputError(`a card named ${card.name} already exists; choose a different name`);
        }
      }
      if (created) {
        try {
          journalAppend(file, nonce);
        } catch (error) {
          const why = error && error.code ? error.code : 'write error';
          let removed = true;
          try { fs.unlinkSync(target); } catch (unlinkError) { removed = Boolean(unlinkError) && unlinkError.code === 'ENOENT'; }
          if (!removed) throw new InputError(`the memory journal could not be written (${why}), so this call failed, and ${file} could not be removed afterwards: a residual card may remain at ${file} in the memory folder. Delete it, or add its index line by hand to keep it`);
          if (error instanceof GuardError) throw error;
          throw new InputError(`the memory journal could not be written (${why}); nothing was saved, send the request again`);
        }
      }
      const updated = alreadyIndexed ? indexText : withEntry(indexText, entry);
      if (!alreadyIndexed) writeFileAtomic(indexPath, updated, { beforeCommit: () => lock.assertOwned() });
      converge(lock, indexPath);
      const finalText = readFileNoFollow(indexPath) || updated;
      const lineCount = finalText.split('\n').length;
      const bytes = Buffer.byteLength(finalText);
      return {
        name: card.name,
        file,
        indexLine: entry,
        indexOverBudget: lineCount > INDEX_MAX_LINES || bytes > INDEX_MAX_BYTES,
      };
    });
  }

  // The same repair, on its own: for server start, so a line dropped before a restart does not wait
  // for the next remember. Looks first without the lock and takes it only when there is work.
  // Returns how many index lines it restored.
  async function healNow() {
    const indexPath = path.join(realFolder(), 'MEMORY.md');
    const current = readFileNoFollow(indexPath);
    const text = current === null ? '# Memory\n\n' : current;
    if (parseIndex(text).unclosed || !missingLines(text).length) return 0;
    return withIndexLock(lock => converge(lock, indexPath));
  }

  function remember(input) {
    const run = writing.then(() => rememberNow(input));
    writing = run.catch(() => {});
    return run;
  }

  function heal() {
    const run = writing.then(healNow);
    writing = run.catch(() => {});
    return run;
  }

  return { folder, list, read, searchText, remember, heal, cardFiles, loadCard };
}

module.exports = { createStore, InputError, GuardError, CARD_TYPES, tokenize, journalRecord, parseJournal };
