#!/usr/bin/env node
/*
  Fingerprint static assets and rewrite references in index.html.
  - Inputs: assets/tailwind.css, fonts/*.woff2
  - Output: assets/tailwind.<hash>.css, fonts/<name>.<hash>.woff2
  - Rewrites URLs in index.html (handles prior fingerprinted names).
  - Adds fail-soft behavior: if anything goes wrong, exits 0.
*/
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = process.cwd();
const INDEX = path.join(ROOT, 'index.html');

function log(msg) {
  process.stdout.write(`[fingerprint] ${msg}\n`);
}

function hashFile(file) {
  const buf = fs.readFileSync(file);
  const h = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 10);
  return h;
}

function ensureCopyWithHash(file, hash) {
  const dir = path.dirname(file);
  const ext = path.extname(file);
  const base = path.basename(file, ext); // may contain spaces
  const hashed = path.join(dir, `${base}.${hash}${ext}`);
  if (!fs.existsSync(hashed)) {
    fs.copyFileSync(file, hashed);
  }
  return hashed;
}

function replaceAll(content, pattern, replacement) {
  return content.replace(pattern, replacement);
}

function main() {
  try {
    if (process.env.SKIP_FINGERPRINT === '1') {
      log('SKIP_FINGERPRINT=1 set; skipping');
      return;
    }
    const cssFile = path.join(ROOT, 'assets', 'tailwind.css');
    const fontRegular = path.join(ROOT, 'fonts', 'Cormorant Variable Font.woff2');
    const fontItalic = path.join(ROOT, 'fonts', 'Cormorant Italic Variable Font.woff2');

    const files = [cssFile, fontRegular, fontItalic].filter((f) => fs.existsSync(f));
    if (files.length === 0) {
      log('No assets found to fingerprint. Skipping.');
      return;
    }

    // Produce hashed copies
    const outputs = {};
    for (const f of files) {
      const h = hashFile(f);
      const hashedPath = ensureCopyWithHash(f, h);
      outputs[f] = hashedPath;
      log(`${path.basename(f)} -> ${path.basename(hashedPath)}`);
    }

    // Rewrite references in index.html using regex that tolerates previous hashes
    let html = fs.readFileSync(INDEX, 'utf8');

    function toWeb(p) {
      // Return web path with forward slashes and preserve spaces
      return '/' + path.relative(ROOT, p).split(path.sep).join('/');
    }

    const cssHashed = toWeb(outputs[cssFile]);
    if (outputs[cssFile]) {
      // /assets/tailwind.css or /assets/tailwind.<hash>.css
      html = replaceAll(
        html,
        /\/assets\/tailwind(?:\.[a-f0-9]{8,12})?\.css/g,
        cssHashed
      );
    }

    if (outputs[fontRegular]) {
      const regHashed = toWeb(outputs[fontRegular]);
      html = replaceAll(
        html,
        /\/fonts\/Cormorant Variable Font(?:\.[a-f0-9]{8,12})?\.woff2/g,
        regHashed
      );
      // Fix any previously escaped path variants introduced by older builds
      const escaped = regHashed.replaceAll('/', '\\/').replaceAll('.', '\\.');
      if (html.includes(escaped)) {
        html = html.split(escaped).join(regHashed);
      }
    }

    if (outputs[fontItalic]) {
      const itaHashed = toWeb(outputs[fontItalic]);
      html = replaceAll(
        html,
        /\/fonts\/Cormorant Italic Variable Font(?:\.[a-f0-9]{8,12})?\.woff2/g,
        itaHashed
      );
      const escaped = itaHashed.replaceAll('/', '\\/').replaceAll('.', '\\.');
      if (html.includes(escaped)) {
        html = html.split(escaped).join(itaHashed);
      }
    }

    fs.writeFileSync(INDEX, html);
    log('Rewrote asset URLs in index.html');
  } catch (err) {
    console.error('[fingerprint] WARN:', err.message || err);
    // Do not fail the build.
  }
}

main();
