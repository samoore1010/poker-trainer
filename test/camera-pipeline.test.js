'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Requests, shouldRead } = require('../public/camera-pipeline');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };

test('late full response cannot overwrite a newer short response', async () => {
  const gate = new Requests(() => 'session:crop:hand');
  const old = deferred(), fresh = deferred(), applied = [];
  const a = gate.run(() => old.promise).then(x => applied.push(x));
  const rejected = assert.rejects(a, { name: 'AbortError' });
  const b = gate.run(() => fresh.promise).then(x => applied.push(x));
  fresh.resolve('fresh'); await b; old.resolve('old'); await rejected;
  assert.deepEqual(applied, ['fresh']);
});
for (const change of ['session', 'crop', 'rotation', 'hand']) test(`discard response after ${change} changes`, async () => {
  let context = 'before'; const gate = new Requests(() => context), d = deferred();
  const result = gate.run(() => d.promise); const rejected = assert.rejects(result, { name: 'AbortError' });
  context = change; d.resolve({ seats: ['obsolete'] }); await rejected;
});
test('camera stop aborts requests even when transport ignores cancellation', async () => {
  const gate = new Requests(() => 'same'), d = deferred(); let signal;
  const result = gate.run(s => { signal = s; return d.promise; });
  const rejected = assert.rejects(result, { name: 'AbortError' });
  gate.cancel(); assert.equal(signal.aborted, true); d.resolve('old'); await rejected;
  assert.equal(await gate.run(() => Promise.resolve('new')), 'new');
});
test('errors from an obsolete session do not count as current camera failures', async () => {
  let context = 1; const gate = new Requests(() => context), d = deferred();
  const result = gate.run(() => d.promise); const rejected = assert.rejects(result, { name: 'AbortError' });
  context++; d.reject(new Error('offline')); await rejected;
});
test('idle scene is quiet, confirmations continue, recovery runs, and requests never queue', () => {
  const s = { inflight: 0, changed: false, confirming: false, lastSent: 1000, now: 1600 };
  assert.equal(shouldRead(s), false);
  assert.equal(shouldRead({ ...s, changed: true }), true);
  assert.equal(shouldRead({ ...s, confirming: true }), true);
  assert.equal(shouldRead({ ...s, now: 4000 }), true);
  assert.equal(shouldRead({ ...s, now: 1200, changed: true }), false);
  assert.equal(shouldRead({ ...s, inflight: 1, now: 9000, changed: true }), false);
});
test('clear hero cards update independently of an unreadable board; uncertainty resets confirmation', () => {
  const { stableCards } = require('../public/camera-pipeline');
  const history = {}, reading = { hero: ['As', 'Kd'], board: ['2s', '3s', '4s'], heroComplete: true, boardComplete: false };
  assert.equal(stableCards(history, reading), null);
  assert.equal(stableCards(history, reading), null);
  assert.deepEqual(stableCards(history, reading), { hero: reading.hero, board: null });
  assert.equal(stableCards(history, { ...reading, heroComplete: false }), null);
  assert.equal(stableCards(history, reading), null);
});
