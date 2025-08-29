#!/usr/bin/env node
/*
  Subset local Cormorant fonts during CI (Netlify build).
  - Crawls index.html text to derive the glyph set
  - Ensures fontTools + brotli are available
  - Runs: python3 -m fontTools.subset ... --flavor=woff2
  - Rewrites the original WOFF2 files in-place (safe on CI)

  Local dev: you don't need to run this; full fonts remain in git.
*/
const { execSync, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = process.cwd();
const FONTS_DIR = path.join(ROOT, 'fonts');
const FILES = [
  'Cormorant Variable Font.woff2',
  'Cormorant Italic Variable Font.woff2',
].map((f) => path.join(FONTS_DIR, f));

function log(msg) {
  process.stdout.write(`[subset-fonts] ${msg}\n`);
}

function ensurePythonDeps() {
  const cmds = [
    'python3 -m pip install --user --upgrade pip > /dev/null 2>&1 || true',
    'python3 -m pip install --user --upgrade fonttools brotli > /dev/null',
  ];
  for (const cmd of cmds) {
    try {
      execSync(cmd, { stdio: 'inherit', env: process.env });
    } catch (e) {
      // Fallback to pip if python3 -m pip fails
      if (cmd.includes('python3')) {
        execSync(cmd.replace('python3 -m ', ''), { stdio: 'inherit', env: process.env });
      } else {
        throw e;
      }
    }
  }
}

function extractCharsFromHTML(file) {
  const html = fs.readFileSync(file, 'utf8');
  // Strip tags and decode common entities needed here
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  const base =
    ' \n\t' +
    '0123456789' +
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
    'abcdefghijklmnopqrstuvwxyz' +
    '.,;:!?"\'()[]{}<>-–—‑/+*&%#@^$=_`~|\\';

  // Symbols we know appear on the page
  const extras = '\u00A9\u2018\u2019\u2013\u2014\u2011';

  const set = new Set((text + base + extras).split(''));
  return Array.from(set).sort();
}

function charsToUnicodeArg(chars) {
  // Convert to comma-separated U+XXXX tokens. For ranges, the correct
  // fonttools syntax is: U+XXXX-YYYY (only one leading U+ per token).
  const codepoints = chars.map((ch) => ch.codePointAt(0));
  codepoints.sort((a, b) => a - b);
  // Merge small ranges for a compact arg
  const ranges = [];
  let start = null;
  let prev = null;
  for (const cp of codepoints) {
    if (start === null) {
      start = prev = cp;
      continue;
    }
    if (cp === prev + 1) {
      prev = cp;
    } else {
      ranges.push([start, prev]);
      start = prev = cp;
    }
  }
  if (start !== null) ranges.push([start, prev]);
  const fmt = (cp) => cp.toString(16).toUpperCase().padStart(4, '0');
  return ranges
    .map(([a, b]) => (a === b ? `U+${fmt(a)}` : `U+${fmt(a)}-${fmt(b)}`))
    .join(',');
}

function subsetOneFont(srcPath, unicodesArg) {
  const outTmp = srcPath + '.subset.tmp.woff2';
  const args = [
    '-m',
    'fontTools.subset',
    srcPath,
    `--output-file=${outTmp}`,
    '--flavor=woff2',
    '--layout-features=*',
    '--no-hinting',
    '--glyph-names',
    `--unicodes=${unicodesArg}`,
  ];
  const res = spawnSync('python3', args, { stdio: 'inherit' });
  if (res.status !== 0 || !fs.existsSync(outTmp)) {
    log(`WARN: subsetting failed for ${path.basename(srcPath)}; keeping original file`);
    return false;
  }
  fs.renameSync(outTmp, srcPath);
  return true;
}

(async function main() {
  try {
    if (process.env.SKIP_FONT_SUBSET === '1') {
      log('SKIP_FONT_SUBSET=1 set; skipping subsetting');
      return;
    }
    const index = path.join(ROOT, 'index.html');
    const chars = extractCharsFromHTML(index);
    const unicodesArg = charsToUnicodeArg(chars);
    log(`Derived glyphs: ${chars.length} chars -> ${unicodesArg.length} unicode spec chars`);

    ensurePythonDeps();

    for (const f of FILES) {
      if (!fs.existsSync(f)) {
        log(`Skip: ${path.basename(f)} not found.`);
        continue;
      }
      log(`Subsetting ${path.basename(f)} ...`);
      subsetOneFont(f, unicodesArg);
    }
    log('Done.');
  } catch (err) {
    console.error('[subset-fonts] ERROR:', err.message || err);
    // Do not fail the build; keep original fonts.
    process.exit(0);
  }
})();
