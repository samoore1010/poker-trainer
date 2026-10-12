'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/setup-parser.js');
const E = require('../public/engine.js');
const run = (text, ctx = {}) => { const p = P.parse(text); return { p, r: P.resolve(p, { used: new Set(), runout: [], memo: {}, ...ctx }) }; };

test('cards with suits, shorthand and sections', () => {
  assert.deepEqual(run('I have the ace of spades and king of hearts').r.hero, ['As', 'Kh']);
  const { r } = run('AhKd flop Qs 7h 2c turn 9d river the four of spades');
  assert.deepEqual(r.hero, ['Ah', 'Kd']); assert.deepEqual(r.board, ['Qs', '7h', '2c', '9d', '4s']);
  assert.deepEqual(run('ace of hearts king of hearts queen of spades seven of hearts two of clubs').r.board, ['Qs', '7h', '2c']); // no street words: fills in order
});

test('ranks without suits get free suits that fit the words', () => {
  const s = run('ace king suited').r.hero; assert.equal(s[0][1], s[1][1]); assert.deepEqual(s.map(c => c[0]), ['A', 'K']);
  const o = run('ace queen offsuit').r.hero; assert.notEqual(o[0][1], o[1][1]);
  const pr = run('pocket nines').r.hero; assert.equal(pr[0][0], '9'); assert.equal(pr[1][0], '9'); assert.notEqual(pr[0], pr[1]);
  const rb = run('flop queen seven deuce rainbow').r.board; assert.equal(new Set(rb.map(c => c[1])).size, 3);
  const mono = run('flop king ten two all hearts').r.board; assert.ok(mono.every(c => c[1] === 'h'));
});

test('avoids cards already in use and keeps picks stable while speaking', () => {
  const used = new Set(['As', 'Ah', 'Ad'].map(E.cardFromCode));
  assert.deepEqual(run('ace king', { used }).r.hero[0], 'Ac');
  const memo = {};
  const a = P.resolve(P.parse('ace king suited'), { used: new Set(), memo }).hero;
  const b = P.resolve(P.parse('ace king suited on the button'), { used: new Set(), memo }).hero;
  assert.deepEqual(a, b);
});

test('positions and table size', () => {
  assert.equal(run('on the button').p.position, 'BTN');
  assert.equal(run('under the gun with jacks').p.position, 'UTG');
  assert.equal(run('in the big blind').p.position, 'BB');
  assert.equal(run('six handed').p.opponents, 5);
  assert.equal(run('heads up').p.opponents, 1);
  assert.equal(run('4 opponents').p.opponents, 4);
  assert.equal(run('6 max').p.opponents, 5);
});

test('turn or river alone keep the board that is on the table', () => {
  const runout = ['Kh', '7d', '2c', '9s', '3h'].map(E.cardFromCode);
  assert.deepEqual(run('turn the queen of hearts', { runout }).r.board, ['Kh', '7d', '2c', 'Qh']);
  assert.deepEqual(run('river ace of spades', { runout }).r.board, ['Kh', '7d', '2c', '9s', 'As']);
});

test('words it cannot use are reported for the coach', () => {
  const q = run('should I call here').p; assert.equal(P.understood(q), false); assert.deepEqual(q.unknown, ['should', 'call']);
  const m = run('make the big blind a calling station').p; assert.ok(m.unknown.includes('station'));
  assert.deepEqual(run('as I said ace of spades queen of spades').p.unknown, []);
});
