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
];
let missing = false;
console.log('Memory file check');
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
console.log('\nFile contents are not printed. Readable files may still contain template placeholders.');
console.log('Saving: unverified. Automatic loading: unverified. Fresh-session recall: unverified.');
console.log('Next: follow docs/memory-check.md to test recall and a correction in your assistant.');
process.exitCode = missing ? 1 : 0;
