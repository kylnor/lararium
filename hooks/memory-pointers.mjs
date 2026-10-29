#!/usr/bin/env node
// Writes the shared-memory pointer block (memory/pointer-block.md) into the global instruction
// file of each agent CLI you have, so Claude Code, Codex and Gemini CLI all read the same files.
//
//   node hooks/memory-pointers.mjs <stack-folder> [--project] [--check] [--only claude,codex,gemini] [--home <dir>]
//
// Default scope is global: ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, ~/.gemini/GEMINI.md, for the CLIs
// whose config folder exists. --project writes the same block into AGENTS.md and GEMINI.md inside the
// stack folder instead (CLAUDE.md there is your map, which you write yourself), so nothing outside the
// folder is touched.
//
// Idempotent: the block lives between its own marker comments. A rerun replaces what is between
// them and never adds a second copy. New blocks are appended after everything else in the file, and
// the script refuses to append when the end of the file sits inside another tool's marker block.
// Symlinked instruction files are written through, so the link stays a link.
// --check changes nothing and exits 1 if a write would be needed or a file is unsafe to touch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const START = '<!-- lararium:shared-memory:start -->';
const END = '<!-- lararium:shared-memory:end -->';

const usage = () => {
  console.log('Usage: node hooks/memory-pointers.mjs <stack-folder> [--project] [--check] [--only claude,codex,gemini] [--home <dir>]');
  process.exit(2);
};

const args = process.argv.slice(2);
if (args.includes('--help')) usage();
let check = false;
let project = false;
let only = null;
let homeArg = null;
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--check') check = true;
  else if (args[i] === '--project') project = true;
  else if (args[i] === '--only') only = String(args[++i] || '').split(',').filter(Boolean);
  else if (args[i] === '--home') homeArg = args[++i];
  else positional.push(args[i]);
}
if (positional.length !== 1) usage();

const root = path.resolve(positional[0]);
if (/[`\n\r]/.test(root)) {
  console.error('The stack folder path contains a backtick or newline; rename the folder first.');
  process.exit(2);
}
let template;
try {
  template = fs.readFileSync(path.join(root, 'memory', 'pointer-block.md'), 'utf8').trim();
} catch {
  console.error(`No memory/pointer-block.md under ${root}. Point this at your stack folder.`);
  process.exit(2);
}
if (template.split(START).length !== 2 || template.split(END).length !== 2 || template.indexOf(START) > template.indexOf(END)) {
  console.error('memory/pointer-block.md must contain its start and end markers exactly once, in order.');
  process.exit(2);
}
const block = template.replaceAll('{{STACK_ROOT}}', root);

// With --home the base is fixed (used for tests and dry runs); otherwise honor each CLI's own
// config-dir variable, then the real home.
const home = homeArg ? path.resolve(homeArg) : os.homedir();
const envDir = name => (homeArg ? '' : process.env[name] || '');
const targets = project ? {
  codex: { dir: root, file: 'AGENTS.md' },
  gemini: { dir: root, file: 'GEMINI.md' },
} : {
  claude: { dir: envDir('CLAUDE_CONFIG_DIR') || path.join(home, '.claude'), file: 'CLAUDE.md' },
  codex: { dir: envDir('CODEX_HOME') || path.join(home, '.codex'), file: 'AGENTS.md' },
  gemini: { dir: path.join(home, '.gemini'), file: 'GEMINI.md' },
};
const names = only || Object.keys(targets);
const unknown = names.filter(n => !targets[n]);
if (unknown.length) { console.error(`Unknown CLI: ${unknown.join(', ')}. Choose from ${Object.keys(targets).join(', ')}.`); process.exit(2); }

// Another tool's marker block (<!-- name:start --> ... <!-- name:end -->, or BEGIN/END name).
// Returns the name of a block still open at the end of the text, or null.
function openForeignBlock(text) {
  const re = /<!--\s*(?:(BEGIN|END)\s+(\S+?)|(\S+?):(start|begin|end))\s*-->/gi;
  const open = [];
  for (const m of text.matchAll(re)) {
    const name = m[2] || m[3];
    if (name === 'lararium:shared-memory' || name === 'lararium') continue;
    const closing = (m[1] || m[4]).toLowerCase() === 'end';
    if (closing) { const at = open.lastIndexOf(name); if (at >= 0) open.splice(at, 1); }
    else open.push(name);
  }
  return open.length ? open[open.length - 1] : null;
}

// Decide what the file should become. Returns { status, next }.
function plan(text) {
  const starts = text.split(START).length - 1;
  const ends = text.split(END).length - 1;
  if (starts > 1 || ends > 1) return { status: 'refused: more than one shared-memory block, resolve by hand' };
  if (starts !== ends) return { status: 'refused: unbalanced shared-memory markers, resolve by hand' };
  if (starts === 1) {
    const s = text.indexOf(START);
    const e = text.indexOf(END);
    if (e < s) return { status: 'refused: shared-memory markers out of order, resolve by hand' };
    const next = text.slice(0, s) + block + text.slice(e + END.length);
    return next === text ? { status: 'unchanged' } : { status: 'updated', next };
  }
  const foreign = openForeignBlock(text);
  if (foreign) return { status: `refused: the end of the file is inside an unclosed "${foreign}" block` };
  const body = text.trimEnd();
  return { status: 'written', next: (body ? body + '\n\n' : '') + block + '\n' };
}

function writeThrough(file, next) {
  let target = file;
  let mode = 0o644;
  try { target = fs.realpathSync(file); mode = fs.statSync(target).mode & 0o777; } catch {}
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.lararium-${process.pid}.tmp`;
  fs.writeFileSync(tmp, next, { mode });
  fs.renameSync(tmp, target);
}

let problems = 0;
for (const name of names) {
  const { dir, file } = targets[name];
  const full = path.join(dir, file);
  if (!only && !fs.existsSync(dir)) { console.log(`${name.padEnd(7)} skipped (no ${dir})`); continue; }
  let text = '';
  try { text = fs.readFileSync(full, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') { console.log(`${name.padEnd(7)} refused: ${e.code}`); problems++; continue; } }
  const result = plan(text);
  const pending = result.next !== undefined;
  if (result.status.startsWith('refused')) problems++;
  else if (check && pending) problems++;
  if (pending && !check) writeThrough(full, result.next);
  const label = check && pending ? `would be ${result.status}` : result.status;
  console.log(`${name.padEnd(7)} ${label} (${full})`);
}
if (!check) console.log('\nDone. Open a new session in each CLI, in any folder, to load the block.');
process.exit(problems ? 1 : 0);
