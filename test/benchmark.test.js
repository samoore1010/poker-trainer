'use strict';
// The advice benchmark (npm run bench) as a regression floor: the score may go up, not down.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spots } = require('./bench/spots.js');
const { runAll } = require('./bench/run.js');

test('advice benchmark stays at or above its floor', () => {
  const r = runAll(spots);
  const misses = r.results.filter(x => !x.ok).map(x => `${x.spot.id}: wanted ${x.spot.ok.join('/')}, got ${x.got}`);
  assert.ok(r.ok >= 142, `benchmark ${r.ok}/${r.n}; misses:\n${misses.join('\n')}`);
});
