#!/usr/bin/env node
// Writes the shared-memory pointer block (memory/pointer-block.md) into the global instruction
// file of each agent CLI you have, so Claude Code, Codex and Gemini CLI all read the same files.
//
//   node hooks/memory-pointers.mjs <stack-folder> [--project] [--check] [--only claude,codex,gemini] [--home <dir>]
//
// Default scope is global: ~/.claude/CLAUDE.md, ~/.codex/AGENTS.md, ~/.gemini/GEMINI.md, for the CLIs
// whose config folder exists. --project writes the same block into CLAUDE.md, AGENTS.md and GEMINI.md
// inside the stack folder instead, so nothing outside the folder is touched. A CLAUDE.md that is
// already there keeps its content and gets the block appended; a new one starts with an import of
// brain/CLAUDE.md when the stack has one (the full install), so the map still loads.
//
// Idempotent: the block lives between its own marker comments. A rerun replaces what is between
// them and never adds a second copy. New blocks are appended after everything else in the file.
// Before it writes anything the script checks every other tool's marker block and refuses when the
// file ends inside an unclosed one, or when our block overlaps, contains or sits inside another
// tool's block (replacing it would destroy or corrupt that tool's text).
// Symlinked instruction files are written through, so the link stays a link. A symlink that points
// nowhere is refused, never replaced by a regular file.
// --check changes nothing and exits 1 if a write would be needed or a file is unsafe to touch.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

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
// --project appends to AGENTS.md in the stack folder. In a clone of the Lararium repository itself
// that file is the contributor guide, so refuse there and send the user to their own stack.
const UPSTREAM = 'kylnor/lararium';
const isUpstream = url => {
  const bare = url.trim().toLowerCase().replace(/\/?(\.git)?\/?$/, '');
  return bare.endsWith(`github.com/${UPSTREAM}`) || bare.endsWith(`github.com:${UPSTREAM}`);
};
// The contributor guide carries this marker. A personal stack never should: the scaffolder drops the
// file, and a stack that still has it (a manual copy, an old scaffold) must not get it appended to.
const CONTRIBUTOR_MARKER = '<!-- lararium:contributor-file -->';
if (project) {
  let agentsText = '';
  try { agentsText = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'); } catch { /* none yet: --project creates it */ }
  if (agentsText.includes(CONTRIBUTOR_MARKER)) {
    console.error(`${path.join(root, 'AGENTS.md')} is the Lararium contributor guide, and --project would append your memory pointers to it.`);
    console.error('Delete or move that file out of your personal stack (it is for people editing the template), then run this again and a fresh AGENTS.md is created.');
    process.exit(2);
  }
  const remote = spawnSync('git', ['-C', root, 'remote', 'get-url', 'origin'], { encoding: 'utf8' });
  if (remote.status === 0 && isUpstream(remote.stdout)) {
    console.error(`${root} is a clone of the Lararium repository itself, and --project would append to its contributor AGENTS.md.`);
    console.error('Make your own stack first (npx lararium my-stack), then run this command inside that folder.');
    process.exit(2);
  }
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
// Two renderings of the root: plain for prose, single-quoted for the grep command so a path with
// spaces or shell characters still runs. Replacement functions keep `$&` and `$'` in a path literal.
const shellQuote = value => `'${value.replaceAll("'", () => "'\\''")}'`;
const block = template
  .replaceAll('{{STACK_ROOT_SHELL}}', () => shellQuote(root))
  .replaceAll('{{STACK_ROOT}}', () => root);

// With --home the base is fixed (used for tests and dry runs); otherwise honor each CLI's own
// config-dir variable, then the real home.
const home = homeArg ? path.resolve(homeArg) : os.homedir();
const envDir = name => (homeArg ? '' : process.env[name] || '');
const targets = project ? {
  claude: { dir: root, file: 'CLAUDE.md' },
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
// Returns every foreign marker in order, with its offset and whether it opens or closes a block.
function foreignMarkers(text) {
  const re = /<!--\s*(?:(BEGIN|END)\s+(\S+?)|(\S+?):(start|begin|end))\s*-->/gi;
  const markers = [];
  for (const m of text.matchAll(re)) {
    const name = m[2] || m[3];
    if (name === 'lararium:shared-memory' || name === 'lararium') continue;
    markers.push({ name, closing: (m[1] || m[4]).toLowerCase() === 'end', at: m.index });
  }
  return markers;
}

// Names of the foreign blocks still open after walking the markers, innermost last.
function openBlocks(markers) {
  const open = [];
  for (const { name, closing } of markers) {
    if (closing) { const at = open.lastIndexOf(name); if (at >= 0) open.splice(at, 1); }
    else open.push(name);
  }
  return open;
}

// Decide what the file should become. Returns { status, next }.
function plan(text, seed = '') {
  const starts = text.split(START).length - 1;
  const ends = text.split(END).length - 1;
  if (starts > 1 || ends > 1) return { status: 'refused: more than one shared-memory block, resolve by hand' };
  if (starts !== ends) return { status: 'refused: unbalanced shared-memory markers, resolve by hand' };
  const markers = foreignMarkers(text);
  const s = text.indexOf(START);
  const e = text.indexOf(END);
  if (starts === 1 && e < s) return { status: 'refused: shared-memory markers out of order, resolve by hand' };
  // Every check below runs before anything is replaced or appended.
  const unclosed = openBlocks(markers);
  if (unclosed.length) return { status: `refused: the end of the file is inside an unclosed "${unclosed[unclosed.length - 1]}" block` };
  if (starts === 0) {
    const body = text.trimEnd();
    return { status: 'written', next: (body ? body + '\n\n' : seed) + block + '\n' };
  }
  const inside = markers.find(m => m.at > s && m.at < e);
  if (inside) return { status: `refused: the shared-memory block contains another tool's "${inside.name}" marker, resolve by hand` };
  const enclosing = openBlocks(markers.filter(m => m.at < s));
  if (enclosing.length) return { status: `refused: the shared-memory block sits inside another tool's "${enclosing[enclosing.length - 1]}" block, resolve by hand` };
  const next = text.slice(0, s) + block + text.slice(e + END.length);
  return next === text ? { status: 'unchanged' } : { status: 'updated', next };
}

// A symlink whose target is missing: realpath fails and a rename would swap the link for a file.
function danglingLink(file) {
  let isLink = false;
  try { isLink = fs.lstatSync(file).isSymbolicLink(); } catch { return null; }
  if (!isLink) return null;
  try { fs.realpathSync(file); return null; } catch { return fs.readlinkSync(file); }
}

function writeThrough(file, next) {
  let target = file;
  let mode = 0o644;
  try { target = fs.realpathSync(file); mode = fs.statSync(target).mode & 0o777; } catch {} // a plain missing file: create it
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
  const dangling = danglingLink(full);
  if (dangling !== null) {
    console.log(`${name.padEnd(7)} refused: ${full} is a symlink to ${dangling}, which does not exist; fix or remove the link first`);
    problems++;
    continue;
  }
  let text = '';
  try { text = fs.readFileSync(full, 'utf8'); } catch (e) { if (e.code !== 'ENOENT') { console.log(`${name.padEnd(7)} refused: ${e.code}`); problems++; continue; } }
  // A brand new project CLAUDE.md pulls in the full install's nested map, which Claude Code would
  // otherwise load only after reading files under brain/.
  const seed = project && name === 'claude' && fs.existsSync(path.join(root, 'brain', 'CLAUDE.md')) ? '@brain/CLAUDE.md\n\n' : '';
  const result = plan(text, seed);
  const pending = result.next !== undefined;
  if (result.status.startsWith('refused')) problems++;
  else if (check && pending) problems++;
  if (pending && !check) writeThrough(full, result.next);
  const label = check && pending ? `would be ${result.status}` : result.status;
  console.log(`${name.padEnd(7)} ${label} (${full})`);
}
if (!check) {
  if (project) {
    console.log(`\nDone. The block is in CLAUDE.md, AGENTS.md and GEMINI.md inside ${root} only: open a new Claude Code, Codex or Gemini CLI session in that folder to load it.`);
    console.log('If CLAUDE.md is still the blank map, fill it in from starter/CLAUDE.template.md; the block you just added stays where it is.');
  } else {
    console.log('\nDone. Open a new session in each CLI, in any folder, to load the block.');
  }
}
process.exit(problems ? 1 : 0);
