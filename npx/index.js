#!/usr/bin/env node
'use strict';

// lararium scaffolder. Node stdlib only, zero dependencies.
// Fetches the latest release of the lararium template and unpacks it
// into a new folder. See README.md in this package for the three-step story.

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const { execFileSync } = require('child_process');

const OWNER = 'kylnor';
const REPO = 'lararium';
const USER_AGENT = 'lararium-scaffolder';
const TAG_RE = /^[A-Za-z0-9._-]{1,32}$/;
const REQUEST_TIMEOUT_MS = 4000;

function manualRoute() {
  return [
    'Manual route:',
    `  git clone https://github.com/${OWNER}/${REPO}.git`,
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
  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/releases/latest`;
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
  const url = `https://codeload.github.com/${OWNER}/${REPO}/tar.gz/refs/${kind}/${ref}`;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lararium-'));
  const tarPath = path.join(tmpDir, 'stack.tar.gz');
  await httpGet(url, { destFile: tarPath });
  const stat = fs.statSync(tarPath);
  if (!stat.size) {
    throw new Error('downloaded tarball is empty');
  }
  return tarPath;
}

async function run() {
  const folderArg = process.argv[2] || 'lararium';
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
    execFileSync('tar', ['-xzf', tarPath, '-C', target, '--strip-components=1']);
  } catch (err) {
    fail(`tar extraction failed (${err.message}). Your system may be missing tar.`);
    return;
  }

  // The scaffolder's own package dir doesn't belong in the recipient's copy,
  // and neither do this repo's own CI files, if any ship in the release.
  for (const dir of ['npx', '.github']) {
    const p = path.join(target, dir);
    if (fs.existsSync(p)) {
      fs.rmSync(p, { recursive: true, force: true });
    }
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

  console.log('');
  console.log(`Landed in ${target}, fetched ${usedFallback ? 'main (no release found)' : ref}.`);
  console.log('');
  console.log(`  cd ${folderArg}`);
  console.log('  claude');
  console.log('');
  console.log('Then say: "Run the install interview in INSTALL.md".');
  console.log('');
}

run().catch((err) => {
  fail(err && err.message ? err.message : String(err));
});
