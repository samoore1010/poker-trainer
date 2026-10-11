'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/scenario.js');

test('fresh table: hero in the big blind, limped pot', () => {
  const sc = S.create({ opponents: 5, stack: 200 });
  assert.equal(S.positions(sc)[0], 'BB');
  const m = S.money(sc);
  assert.equal(m.potShow[0], 12); assert.equal(m.toCall[0], 0);
});

test('preflop raise with folds', () => {
  const sc = S.create({ opponents: 5 });
  assert.ok(S.apply(sc, 'setup_table', { reset: true, opponents: 5, hero_position: 'BTN', starting_stack: 100 }).ok);
  const r = S.apply(sc, 'set_action', { street: 'preflop', aggressor: 'UTG', amount: 6, folds: ['SB', 'HJ', 'CO'] });
  assert.ok(r.ok, r.error);
  const m = S.money(sc);
  assert.equal(m.potShow[0], 13); // UTG 6 + BB 6 + SB's dead small blind 1
  assert.equal(m.toCall[0], 6);
  assert.deepEqual(S.liveOpponents(sc, 0).map(x => S.positions(sc)[x]).sort(), ['BB', 'UTG']);
});

test('cards: validation and the newest assignment wins', () => {
  const sc = S.create({ opponents: 3 });
  assert.equal(S.apply(sc, 'set_hero_cards', { cards: ['Zz', 'Ah'] }).ok, false);
  assert.equal(S.apply(sc, 'set_board', { cards: ['Kh', '7h'] }).ok, false);
  S.apply(sc, 'set_board', { cards: ['Kh', '7h', '2c'] });
  const r = S.apply(sc, 'set_hero_cards', { cards: ['Kh', 'Qd'] });
  assert.ok(r.ok); assert.match(r.summary, /cleared the board/); assert.deepEqual(sc.board, []);
  assert.ok(S.apply(sc, 'set_opponent', { seat: 1, cards: ['Ac', 'Ad'] }).ok);
  assert.equal(S.apply(sc, 'set_opponent', { seat: 1, range: 'nonsense' }).ok, false);
  assert.ok(S.apply(sc, 'set_opponent', { seat: 'Ravi-not-a-name', style: 'tight' }).ok === false);
});

test('changing table size keeps your position and unique names', () => {
  const sc = S.create({ opponents: 2 });
  S.apply(sc, 'setup_table', { opponents: 8 });
  assert.equal(S.positions(sc)[0], 'BB');
  const names = sc.opponents.map(o => o.name);
  assert.equal(new Set(names).size, names.length);
});

test('normalize repairs bad input', () => {
  const { scenario, fixes } = S.normalize({ hero: { cards: ['Ah', 'Ah'] }, board: ['Kh', 'zz', '7h', '2c'], opponents: [{ cards: ['Kh', '2d'] }, {}] });
  assert.deepEqual(scenario.board, ['Kh', '7h', '2c']);
  assert.deepEqual(scenario.hero.cards, []);
  assert.equal(scenario.opponents[0].cards, null);
  assert.ok(fixes.length >= 3);
});

test('summary shows only what the user knows', () => {
  const sc = S.create({ opponents: 2 });
  S.apply(sc, 'set_hero_cards', { cards: ['Ah', 'Qh'] });
  S.apply(sc, 'set_opponent', { seat: 1, range: 'QQ+' });
  const txt = S.summary(sc);
  assert.match(txt, /Seat 0 You \(BB\): cards Ah Qh/); assert.match(txt, /QQ\+/);
});
