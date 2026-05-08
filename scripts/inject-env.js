/**
 * inject-env.js — runs automatically before `npm run build` via the "prebuild" hook.
 *
 * Reads UNSPLASH_ACCESS_KEY from the shell environment and writes it into
 * src/build-config.json, which electron-builder then bundles into the asar archive.
 *
 * Why: process.env is the live OS environment, so it works fine for `npm start`
 * (dev). But the packaged .exe runs in a fresh process with no shell env vars,
 * so the key must be physically embedded in a file at build time.
 *
 * Usage:
 *   set UNSPLASH_ACCESS_KEY=your_key_here   (Windows CMD)
 *   $env:UNSPLASH_ACCESS_KEY="your_key"     (PowerShell)
 *   export UNSPLASH_ACCESS_KEY=your_key     (bash/zsh)
 *   npm run build
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const key = process.env.UNSPLASH_ACCESS_KEY || '';

if (!key) {
  console.warn('[inject-env] WARNING: UNSPLASH_ACCESS_KEY is not set — Discover tab will be disabled in the built app.');
} else {
  console.log('[inject-env] UNSPLASH_ACCESS_KEY found — embedding in build-config.json');
}

const config = { unsplashKey: key };
const outPath = path.join(__dirname, '..', 'src', 'build-config.json');
fs.writeFileSync(outPath, JSON.stringify(config, null, 2) + '\n', 'utf8');
console.log('[inject-env] Wrote', outPath);
