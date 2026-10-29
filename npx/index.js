#!/usr/bin/env node
'use strict';

// lararium scaffolder. This file uses the Node stdlib only. The package does have dependencies (the MCP
// SDK, see package.json), but only `serve` loads them, on demand, so scaffolding never touches them.
// Fetches the latest release of the lararium template and unpacks it
// into a new folder. See README.md in this package for the three-step story.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');

const SLUG = 'kylnor/lararium'; // the GitHub repo this template is published from
const USER_AGENT = 'lararium-scaffolder';
const TAG_RE = /^[A-Za-z0-9._-]{1,32}$/;
const REQUEST_TIMEOUT_MS = 4000;

// Contributor-only material. It lives in the template repo for the people who edit the template and
// never belongs in a stranger's personal stack: the contributor guide, the depersonalization
// checklist, release history, the blog, the scaffolder itself and this repo's CI.
const CONTRIBUTOR_ONLY = ['npx', '.github', 'tests', 'AGENTS.md', 'SCRUB.md', 'CHANGELOG.md', path.join('docs', 'blog')];
// The themed roster is flavor. It is only scaffolded on request (--with-examples).
const EXAMPLES_DIR = path.join('agents', 'examples');

function manualRoute() {
  return [
    'Manual route:',
    `  git clone https://github.com/${SLUG}.git`,
    '  (or click "Use this template" on GitHub, or grab the zip from Releases)',
  ].join('\n');
}

function fail(message) {
  console.error(`\nlararium: ${message}\n`);
  console.error(manualRoute());
  process.exit(1);
}

// GET a URL, following redirects, either buffering text or streaming to destFile.
function httpGet(url, { asJson = false, destFile = null } = {}, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': USER_AGENT, Accept: asJson ? 'application/vnd.github+json' : '*/*' } },
      (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new Error('too many redirects'));
            return;
          }
          resolve(httpGet(res.headers.location, { asJson, destFile }, redirectsLeft - 1));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          res.resume();
          reject(new Error(`HTTP ${res.statusCode} for ${url}`));
          return;
        }
        if (destFile) {
          const out = fs.createWriteStream(destFile);
          res.pipe(out);
          out.on('finish', () => out.close(() => resolve({ statusCode: res.statusCode })));
          out.on('error', reject);
        } else {
          let data = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        }
      }
    );
    req.on('error', reject);
    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      req.destroy(new Error('request timed out'));
    });
  });
}

async function resolveRef() {
  const apiUrl = `https://api.github.com/repos/${SLUG}/releases/latest`;
  try {
    const res = await httpGet(apiUrl, { asJson: true });
    const parsed = JSON.parse(res.body);
    const tag = parsed && parsed.tag_name;
    if (typeof tag === 'string' && TAG_RE.test(tag)) {
      return { ref: tag, kind: 'tags', usedFallback: false };
    }
    throw new Error('releases API returned no usable tag');
  } catch (err) {
    console.log(`lararium: could not resolve the latest release (${err.message}). Falling back to main.`);
    return { ref: 'main', kind: 'heads', usedFallback: true };
  }
}

async function downloadTarball(ref, kind) {
  const url = `https://codeload.github.com/${SLUG}/tar.gz/refs/${kind}/${ref}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lararium-'));
  const tarPath = path.join(tmpDir, 'stack.tar.gz');
  await httpGet(url, { destFile: tarPath });
  const stat = fs.statSync(tarPath);
  if (!stat.size) {
    throw new Error('downloaded tarball is empty');
  }
  return tarPath;
}

// Extract a template tarball into target and leave a personal stack: contributor-only files are
// removed (and the themed roster too, unless asked for) BEFORE the first commit, so none of it is in
// the stack's history. Exported so the scaffold test drives this exact path.
function unpack(tarPath, target, { withExamples = false } = {}) {
  try {
    execFileSync('tar', ['-xzf', tarPath, '-C', target, '--strip-components=1']);
  } catch (err) {
    throw new Error(`tar extraction failed (${err.message}).`);
  }

  const drop = withExamples ? CONTRIBUTOR_ONLY : [...CONTRIBUTOR_ONLY, EXAMPLES_DIR];
  for (const rel of drop) {
    fs.rmSync(path.join(target, rel), { recursive: true, force: true });
  }

  console.log('lararium: initializing git...');
  try {
    execFileSync('git', ['init'], { cwd: target, stdio: 'ignore' });
    execFileSync('git', ['add', '-A'], { cwd: target, stdio: 'ignore' });
    execFileSync('git', ['commit', '-m', 'Initial commit from lararium template'], {
      cwd: target,
      stdio: 'ignore',
    });
  } catch (err) {
    console.log(
      'lararium: git init/commit skipped (configure git user.name and user.email, then commit by hand).'
    );
  }
}

async function run() {
  const args = process.argv.slice(2);
  const withExamples = args.includes('--with-examples');
  const folderArg = args.find((a) => !a.startsWith('--')) || 'lararium';
  const target = path.resolve(process.cwd(), folderArg);

  if (fs.existsSync(target)) {
    const stat = fs.statSync(target);
    if (!stat.isDirectory()) {
      fail(`"${folderArg}" exists and is not a directory.`);
    }
    if (fs.readdirSync(target).length > 0) {
      fail(`"${folderArg}" already exists and is not empty. Pick a different folder name or clear it first.`);
    }
  } else {
    fs.mkdirSync(target, { recursive: true });
  }

  console.log('lararium: resolving the latest release...');
  const { ref, kind, usedFallback } = await resolveRef();

  console.log(`lararium: downloading ${ref}...`);
  let tarPath;
  try {
    tarPath = await downloadTarball(ref, kind);
  } catch (err) {
    fail(
      `could not download the template (${err.message}). ` +
        'This is expected if the repo is not public yet, or a network issue.'
    );
    return;
  }

  console.log(`lararium: unpacking into ${target}...`);
  try {
    unpack(tarPath, target, { withExamples });
  } catch (err) {
    fail(`${err.message} Your system may be missing tar.`);
    return;
  }

  console.log('');
  console.log(`Landed in ${target}, fetched ${usedFallback ? 'main (no release found)' : ref}.`);
  console.log('');
  console.log(`  cd ${folderArg}`);
  console.log('  claude');
  console.log('');
  console.log('Then say: "Run the starter in starter/README.md".');
  console.log('(When you outgrow it, the full setup is INSTALL.md.)');
  console.log('');
}

if (require.main === module) {
  // `serve` is the one subcommand: the memory server. It is loaded on demand so scaffolding never
  // needs the MCP SDK. Everything else is the scaffolder, unchanged.
  if (process.argv[2] === 'serve') {
    require('./serve').main(process.argv.slice(3)).catch((err) => {
      console.error(`lararium serve: ${err && err.message ? err.message : String(err)}`);
      process.exit(1);
    });
  } else {
    run().catch((err) => {
      fail(err && err.message ? err.message : String(err));
    });
  }
}

module.exports = { unpack, CONTRIBUTOR_ONLY, EXAMPLES_DIR };
