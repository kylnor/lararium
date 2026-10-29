#!/usr/bin/env node
// Read-only file diagnostic. Does not inspect or configure assistant hooks.
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === '--help') {
  console.log('Usage: node hooks/memory-check.mjs <installed-stack-folder>');
  console.log('Checks local files only. Does not prove saving, hook wiring, or model recall.');
  process.exit(args[0] === '--help' ? 0 : 2);
}
const root = path.resolve(args[0]);
const checks = [
  ['brain/CLAUDE.md', true, 'Restore the brain instructions or point this check at your installed folder.'],
  ['brain/now.md', true, 'Run Phase 1 of INSTALL.md to write your current priorities.'],
  ['soul/core.md', false, 'Optional: run Phase 2 if you want a persona.'],
  ['soul/heartbeat.md', false, 'No readable heartbeat here. End a completed test session with the capture hook enabled, then check again.'],
];
let missing = false;
console.log('Memory file check');
const configured = process.env.LARARIUM_ROOT;
if (!configured) {
  // The shipped .claude/settings.json registers both memory hooks by path relative
  // to the project, and the hooks find this folder from their own location.
  let registered = [];
  try {
    const settings = JSON.parse(fs.readFileSync(path.join(root, '.claude/settings.json'), 'utf8'));
    registered = Object.values(settings.hooks || {}).flat().flatMap(g => (g && g.hooks) || []).map(h => String(h.command || ''));
  } catch {}
  const wired = ['session-start.js', 'session-end-heartbeat.js'].filter(name => registered.some(c => c.includes(name)));
  if (wired.length === 2) {
    console.log('Hook registration: .claude/settings.json registers both memory hooks for this folder. Whether they fire is still unverified.');
  } else {
    console.log(`NEEDS ATTENTION: .claude/settings.json registers ${wired.length} of 2 memory hooks. Restore it from the template.`);
    missing = true;
  }
} else if (!path.isAbsolute(configured) || path.resolve(configured) !== root) {
  console.log('NEEDS ATTENTION: LARARIUM_ROOT differs from the absolute folder being checked.');
  missing = true;
} else {
  console.log('Hook root matches the checked folder. Hook registration is still unverified.');
}
for (const [relative, required, remedy] of checks) {
  try {
    const file = path.join(root, relative);
    const stat = fs.statSync(file);
    if (!stat.isFile()) throw new Error('not a file');
    const text = fs.readFileSync(file, 'utf8');
    if (!text.trim()) throw new Error('empty');
    console.log(`READABLE ${relative} (modified ${stat.mtime.toISOString()})`);
  } catch (error) {
    console.log(`${required ? 'NEEDS ATTENTION' : 'OPTIONAL'} ${relative}: ${error.code || error.message}`);
    console.log(`  ${remedy}`);
    if (required) missing = true;
  }
}
// Memory cards (optional folder, v3). Read-only: reports pointered / demoted / orphaned cards,
// dangling pointers and broken frontmatter, and never adds a pointer (re-adding one would silently
// undo a considered demotion).
const CARD_TYPES = new Set(['user', 'feedback', 'project', 'reference']);
const NOT_CARDS = new Set(['MEMORY.md', 'DEMOTED.md', 'README.md', 'pointer-block.md']);
const INDEX_MAX_LINES = 200;
const INDEX_MAX_BYTES = 24000;
function cardFindings(memoryDir) {
  const out = { problems: [], notes: [] };
  let files;
  try { files = fs.readdirSync(memoryDir); } catch { return null; }
  const cards = files.filter(f => f.endsWith('.md') && !NOT_CARDS.has(f)).sort();
  const read = name => { try { return fs.readFileSync(path.join(memoryDir, name), 'utf8'); } catch { return null; } };
  const index = read('MEMORY.md');
  if (index === null) out.problems.push('memory/MEMORY.md is missing: the index is what pushes cards into context.');
  const pointered = new Set();
  for (const line of (index || '').replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const m = line.match(/^- (?:\[[^\]]*\]\(([^)]+\.md)\)|(\S+\.md))/);
    if (m) pointered.add(path.basename(m[1] || m[2]));
  }
  const demoted = new Set();
  for (const line of (read('DEMOTED.md') || '').replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
    const m = line.match(/^- (\S+\.md)/);
    if (m) demoted.add(m[1]);
  }
  if (index !== null) {
    const lineCount = index.split('\n').length;
    if (lineCount > INDEX_MAX_LINES || Buffer.byteLength(index) > INDEX_MAX_BYTES) {
      out.problems.push(`memory/MEMORY.md is ${lineCount} lines, ${Buffer.byteLength(index)} bytes: past the 200 line / 24 KB cut, so the tail never reaches a session. Demote cards.`);
    }
  }
  for (const name of pointered) if (!cards.includes(name)) out.problems.push(`DANGLING pointer in MEMORY.md: ${name} does not exist.`);
  for (const card of cards) {
    const text = read(card) || '';
    const fm = text.startsWith('---\n') ? text.slice(4, text.indexOf('\n---', 4) === -1 ? 0 : text.indexOf('\n---', 4)) : '';
    const field = key => { const m = fm.match(new RegExp(`^${key}:[ \\t]*(.*)$`, 'm')); return m ? m[1].trim().replace(/^["']|["']$/g, '') : ''; };
    if (!fm) out.problems.push(`${card}: no frontmatter (name, description, type).`);
    else {
      if (field('name') !== card.slice(0, -3)) out.problems.push(`${card}: frontmatter name "${field('name')}" must equal the filename.`);
      if (!field('description')) out.problems.push(`${card}: frontmatter description is empty.`);
      if (!CARD_TYPES.has(field('type'))) out.problems.push(`${card}: type "${field('type')}" is not one of user, feedback, project, reference.`);
    }
    if (!pointered.has(card) && !demoted.has(card)) out.problems.push(`ORPHANED ${card}: no pointer in MEMORY.md and no line in DEMOTED.md. Find out why before adding anything.`);
  }
  out.notes.push(`${cards.length} card(s): ${[...pointered].filter(n => cards.includes(n)).length} pointered, ${cards.filter(c => !pointered.has(c) && demoted.has(c)).length} demoted on purpose.`);
  return out;
}
const found = cardFindings(path.join(root, 'memory'));
if (!found) {
  console.log('OPTIONAL memory/: no card folder here. Cards are the lessons layer; see memory/README.md.');
} else {
  console.log('Memory cards');
  for (const note of found.notes) console.log(`READABLE ${note}`);
  for (const problem of found.problems) { console.log(`NEEDS ATTENTION ${problem}`); missing = true; }
}

console.log('\nFile contents are not printed. Readable files may still contain template placeholders.');
console.log('Saving: unverified. Automatic loading: unverified. Fresh-session recall: unverified.');
console.log('Next: follow docs/memory-check.md to test recall and a correction in your assistant.');
process.exitCode = missing ? 1 : 0;
