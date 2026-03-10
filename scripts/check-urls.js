#!/usr/bin/env node
/**
 * Exhibition URL validator
 * Checks all exhibition URLs in data/exhibitions.json for accessibility.
 * Usage: node scripts/check-urls.js
 */

const https = require('https');
const http = require('http');
const path = require('path');
const exhibitionData = require(path.join(__dirname, '..', 'data', 'exhibitions.json'));

const TIMEOUT = 10000; // 10s

function checkUrl(url) {
  return new Promise((resolve) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, { timeout: TIMEOUT, headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      // Follow redirects (3xx)
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        resolve({ status: res.statusCode, redirect: res.headers.location, ok: true });
      } else if (res.statusCode >= 200 && res.statusCode < 400) {
        resolve({ status: res.statusCode, ok: true });
      } else {
        resolve({ status: res.statusCode, ok: false });
      }
      res.resume(); // drain response
    });
    req.on('error', (err) => {
      resolve({ ok: false, error: err.code || err.message });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'TIMEOUT' });
    });
  });
}

async function main() {
  console.log(`Checking ${exhibitionData.exhibitions.length} exhibition URLs...\n`);

  const results = [];
  for (const ex of exhibitionData.exhibitions) {
    process.stdout.write(`  ${ex.name} ... `);
    const result = await checkUrl(ex.url);
    if (result.ok) {
      const extra = result.redirect ? ` → ${result.redirect}` : '';
      console.log(`✅ ${result.status}${extra}`);
    } else {
      console.log(`❌ ${result.error || result.status}`);
      results.push({ id: ex.id, name: ex.name, url: ex.url, ...result });
    }
  }

  console.log('');
  if (results.length === 0) {
    console.log('All URLs are accessible! ✅');
  } else {
    console.log(`⚠️  ${results.length} URL(s) have issues:`);
    results.forEach(r => {
      console.log(`  - ${r.name}: ${r.url} (${r.error || r.status})`);
    });
    process.exit(1);
  }
}

main();
