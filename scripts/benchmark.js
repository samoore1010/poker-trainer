#!/usr/bin/env node
'use strict';
// Scores the advice against the benchmark spots (test/bench/spots.js): `npm run bench`, or `npm run bench -- -v` to
// list every miss.
const { spots } = require('../test/bench/spots.js');
const { runAll } = require('../test/bench/run.js');

const verbose = process.argv.includes('-v');
const t0 = Date.now();
const r = runAll(spots);
console.log(`Advice benchmark: ${r.ok}/${r.n} (${r.score}%) in ${((Date.now() - t0) / 1000).toFixed(1)} s\n`);
for (const [cat, c] of Object.entries(r.byCat)) console.log(`  ${cat.padEnd(20)} ${String(c.ok).padStart(3)}/${String(c.n).padEnd(3)} ${'█'.repeat(Math.round(c.ok / c.n * 20)).padEnd(20, '·')}`);
const misses = r.results.filter(x => !x.ok);
if (misses.length) {
  console.log(`\nMisses${verbose ? '' : ' (-v for reasons)'}:`);
  for (const x of misses) {
    console.log(`  ${x.spot.id.padEnd(22)} ${x.spot.hero.join('')}  wanted ${x.spot.ok.join('/')}${x.spot.size ? ` at ${x.spot.size.map(v => Math.round(v * 100)).join('–')}% pot` : ''}, got ${x.got}`);
    if (verbose) console.log(`      ${x.rec.reasons.join(' ')}`);
  }
}
