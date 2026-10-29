// Frontmatter of every agent def and skill must be valid YAML, because Claude Code refuses to load
// a def it cannot parse, and a newcomer copying one gets a silent dud. Node has no YAML parser in
// its standard library and the template ships zero dependencies, so two checks run:
//   1. a strict check of the small YAML subset the defs use (always runs),
//   2. a full PyYAML parse of the same files when python3 with PyYAML is present (CI has it).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function collect() {
  const out = [];
  const walk = dir => {
    if (!fs.existsSync(dir)) return;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md') && /^[a-z]/.test(e.name) || e.name === 'SKILL.md') out.push(p);
    }
  };
  walk(path.join(root, 'agents/defs'));
  walk(path.join(root, 'skills/defs'));
  walk(path.join(root, 'agents/examples'));
  return out.filter(f => /^---\n/.test(fs.readFileSync(f, 'utf8')));
}

export function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
  return m ? m[1] : null;
}

// Returns a list of problems with one frontmatter block; empty means fine.
export function strictProblems(block) {
  const problems = [];
  block.split('\n').forEach((line, i) => {
    if (line.trim() === '' || /^\s*#/.test(line)) return;
    const m = /^([A-Za-z][\w-]*):(?: (.*))?$/.exec(line);
    if (!m) { problems.push(`line ${i + 1}: not a "key: value" line: ${line.slice(0, 60)}`); return; }
    const value = (m[2] || '').trim();
    if (value === '') return;
    if (value.startsWith('"')) {
      if (!/^"(?:[^"\\]|\\.)*"$/.test(value)) problems.push(`line ${i + 1}: ${m[1]}: bad double-quoted string`);
    } else if (value.startsWith("'")) {
      if (!/^'(?:[^']|'')*'$/.test(value)) problems.push(`line ${i + 1}: ${m[1]}: bad single-quoted string`);
    } else if (/^[\[{&*!|>%@`]/.test(value) && !/^\[.*\]$/.test(value)) {
      problems.push(`line ${i + 1}: ${m[1]}: value starts with a YAML indicator, quote it`);
    } else if (!/^\[.*\]$/.test(value) && (/: /.test(value) || /:$/.test(value) || / #/.test(value))) {
      problems.push(`line ${i + 1}: ${m[1]}: unquoted value contains ": " or " #", quote it`);
    }
  });
  return problems;
}

const files = collect();

test('the strict checker rejects the failures it exists to catch', () => {
  assert.ok(strictProblems('name: x\ndescription: Read-only: it never fixes').length >= 1);
  assert.ok(strictProblems('name: x\ndescription: say "hi" # not a comment').length >= 1);
  assert.ok(strictProblems('name: x\ndescription: "unterminated').length >= 1);
  assert.ok(strictProblems('name: x\ndescription: "has "inner" quotes"').length >= 1);
  assert.deepEqual(strictProblems('name: x\ndescription: "Read-only: fine when quoted"\ntools: Read, Grep, Glob'), []);
});

test('every agent def and skill has strictly valid frontmatter, a name and a description', () => {
  assert.ok(files.length >= 10, `expected to find the defs, found ${files.length}`);
  const bad = [];
  for (const f of files) {
    const rel = path.relative(root, f);
    const block = frontmatter(fs.readFileSync(f, 'utf8'));
    if (block === null) { bad.push(`${rel}: frontmatter is not closed`); continue; }
    for (const p of strictProblems(block)) bad.push(`${rel}: ${p}`);
    if (!/^name: \S/m.test(block)) bad.push(`${rel}: no name`);
    if (!/^description: \S/m.test(block)) bad.push(`${rel}: no description`);
    const name = /^name: *"?([^"\n]+)"?$/m.exec(block);
    const expected = path.basename(f) === 'SKILL.md' ? path.basename(path.dirname(f)) : path.basename(f, '.md');
    if (name && name[1].trim() !== expected) bad.push(`${rel}: name "${name[1].trim()}" does not match "${expected}"`);
  }
  assert.deepEqual(bad, []);
});

test('the default read-only agents grant no shell and no write tools', () => {
  for (const n of ['reviewer', 'verifier']) {
    const block = frontmatter(fs.readFileSync(path.join(root, 'agents/defs', `${n}.md`), 'utf8'));
    const tools = /^tools: *(.*)$/m.exec(block)[1].split(',').map(s => s.trim()).sort();
    assert.deepEqual(tools, ['Glob', 'Grep', 'Read'], `${n} must be Read, Grep, Glob only`);
  }
});

const py = spawnSync('python3', ['-c', 'import yaml'], { encoding: 'utf8' });
// Local runs may skip without PyYAML; CI installs it, and CI=true turns a missing parser into a failure.
const needPy = py.status !== 0 && process.env.CI !== 'true';
test('every frontmatter block parses with a real YAML parser (PyYAML)', { skip: needPy && 'python3 with PyYAML not available (CI requires it)' }, () => {
  assert.equal(py.status, 0, 'CI=true needs python3 with PyYAML (pip install pyyaml)');
  const script = [
    'import sys, yaml',
    'bad = []',
    'for f in sys.argv[1:]:',
    '    t = open(f, encoding="utf-8").read()',
    '    end = t.index("\\n---\\n", 4)',
    '    try:',
    '        d = yaml.safe_load(t[4:end])',
    '        assert isinstance(d, dict) and d.get("name") and d.get("description")',
    '    except Exception as e:',
    '        bad.append(f + ": " + str(e).splitlines()[0])',
    'print("\\n".join(bad))',
    'sys.exit(1 if bad else 0)',
  ].join('\n');
  const r = spawnSync('python3', ['-I', '-c', script, ...files], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
