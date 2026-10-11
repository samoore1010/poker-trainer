'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');
const c = E.cardFromCode, cs = (...x) => x.map(c);

test('card codes round-trip', () => {
  assert.equal(E.codeOf(c('Ah')), 'Ah'); assert.equal(c('10d'), c('Td')); assert.equal(c('xx'), -1); assert.equal(E.cardText(c('Ks')), 'K♠');
});

test('range notation', () => {
  const n = r => E.parseRange(r).combos.length;
  assert.equal(n('QQ+'), 18); assert.equal(n('22-55'), 24); assert.equal(n('AKs'), 4); assert.equal(n('AKo'), 12); assert.equal(n('AK'), 16);
  assert.equal(n('AQo+'), 24); assert.equal(n('A5s-A2s'), 16); assert.equal(n('KT+'), 48); assert.equal(n('AhKh'), 1);
  assert.equal(n('random'), 1326); assert.equal(n(''), 1326); assert.equal(n('QQ+, QQ+'), 18);
  assert.ok(Math.abs(E.parseRange('top 15%').pct - 15) < 1.5);
  assert.equal(n('tight'), n('top 15%')); assert.equal(n('calling station'), n('top 60%'));
  assert.deepEqual(E.parseRange('JJ+, zz').errors, ['zz: not understood']);
});

test('equity matches known matchups', () => {
  const aa = E.equity({ hero: cs('As', 'Ad'), board: [], opps: [{ cards: cs('Ks', 'Kd') }], trials: 20000 }).chance;
  assert.ok(aa > 80 && aa < 85, `AA vs KK ${aa}`);
  const flip = E.equity({ hero: cs('Ah', 'Kh'), board: [], opps: [{ cards: cs('Qs', 'Qd') }], trials: 20000 }).chance;
  assert.ok(flip > 43 && flip < 50, `AKs vs QQ ${flip}`);
});

test('exact on the river and turn against one opponent', () => {
  const r = E.equity({ hero: cs('Ah', 'Qh'), board: cs('Kh', '7h', '2h', '9s', '3d'), opps: [{ cards: cs('Kd', 'Kc') }] });
  assert.equal(r.exact, true); assert.equal(r.chance, 100); // A-high flush beats a set of kings
  const t = E.equity({ hero: cs('Ah', 'Qh'), board: cs('Kh', '7h', '2c', '9s'), opps: [{ range: 'QQ+, AK' }] });
  assert.equal(t.exact, true); assert.ok(t.trials > 500);
  assert.equal(E.equity({ hero: cs('Ah', 'Qh'), board: cs('Kh', '7h', '2c'), opps: [] }).chance, 100);
});

test('ranges change equity in the right direction', () => {
  const hero = cs('Ah', 'Qh'), board = cs('Kh', '7h', '2c');
  const vsRandom = E.equity({ hero, board, opps: [{ range: '' }], trials: 8000 }).chance;
  const vsTight = E.equity({ hero, board, opps: [{ range: 'KK+, AK' }], trials: 8000 }).chance;
  assert.ok(vsTight < vsRandom - 10, `${vsTight} vs ${vsRandom}`);
});

test('threats use opponent ranges', () => {
  const T = E.threatsNow(cs('Ah', 'Qh'), cs('Kh', '7h', '2c'), [{ range: 'KK+' }]);
  assert.ok(T.pAny > 99); // every KK+ hand beats ace high here
  const none = E.threatsNow(cs('Kd', 'Kc'), cs('Kh', '7h', '2c'), [{ range: '33-66' }]);
  assert.equal(none.pAny, 0);
});

test('hand descriptions', () => {
  assert.match(E.describe(cs('Ah', 'Qh'), cs('Kh', '7h', '2h')).text, /flush in hearts, ace high/);
  assert.equal(E.preflopShort(cs('Ah', 'Kh')), 'Ace-king suited');
});
