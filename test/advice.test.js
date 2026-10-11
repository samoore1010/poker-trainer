'use strict';
// "What you should do" rules on clear-cut spots.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');
const S = require('../public/scenario.js');

function advise(steps, street) {
  const sc = S.create({ opponents: 5 });
  for (const [name, args] of steps) { const r = S.apply(sc, name, args); assert.ok(r.ok, r.error); }
  const hero = sc.hero.cards.map(E.cardFromCode), board = sc.board.slice(0, S.BOARD_N[street]).map(E.cardFromCode);
  return S.recommendation(sc, street, hero, board, E.equity({ hero, board, opps: S.engineOpponents(sc, street), trials: 6000 }));
}
const table = (pos, n = 5) => ['setup_table', { reset: true, opponents: n, hero_position: pos }];

test('preflop: open good hands, fold trash, check the big blind', () => {
  assert.equal(advise([table('BTN'), ['set_hero_cards', { cards: ['Ah', 'Qh'] }]], 0).action, 'raise');
  assert.equal(advise([table('UTG'), ['set_hero_cards', { cards: ['7h', '2c'] }]], 0).action, 'fold');
  assert.equal(advise([table('BB'), ['set_hero_cards', { cards: ['9h', '4c'] }]], 0).action, 'check');
});

test('preflop: re-raise premiums against a raise, fold weak hands to a tight raise', () => {
  const kk = advise([table('CO'), ['set_hero_cards', { cards: ['Kh', 'Kd'] }], ['set_action', { street: 'preflop', aggressor: 'UTG', amount: 6 }]], 0);
  assert.equal(kk.action, 'raise'); assert.ok(kk.size > 6);
  const weak = advise([table('HJ'), ['set_hero_cards', { cards: ['Kc', '9d'] }], ['set_opponent', { seat: 'UTG', range: 'QQ+, AK' }], ['set_action', { street: 'preflop', aggressor: 'UTG', amount: 6 }]], 0);
  assert.equal(weak.action, 'fold');
});

test('postflop: bet a set, fold air on the river, call a cheap price', () => {
  const set = advise([table('BTN', 2), ['set_hero_cards', { cards: ['Kd', 'Kc'] }], ['set_board', { cards: ['Kh', '7h', '2c'] }], ['set_action', { street: 'flop', aggressor: null }]], 1);
  assert.equal(set.action, 'bet'); assert.ok(set.gauge > 66);
  const air = advise([table('BTN', 1), ['set_hero_cards', { cards: ['5d', '6d'] }], ['set_board', { cards: ['Kh', '7h', '2c', 'Js', 'Ac'] }], ['set_action', { street: 'river', aggressor: 'BB', amount: 20 }]], 3);
  assert.equal(air.action, 'fold'); assert.ok(air.gauge < 34);
  const cheap = advise([table('BB'), ['set_hero_cards', { cards: ['As', 'Kd'] }], ['set_board', { cards: ['Ad', '6s', '7s', '4s', '4d'] }], ['set_action', { street: 'river', aggressor: 'HJ', amount: 72 }]], 3);
  assert.equal(cheap.action, 'call');
});

test('texture and draws', () => {
  const c = E.cardFromCode;
  assert.equal(E.texture(['Kh', '7h', '2c'].map(c)).wet, true);
  assert.equal(E.texture(['Kh', '7d', '2c'].map(c)).wet, false);
  assert.equal(E.drawOuts(['Ah', 'Qh'].map(c), ['Kh', '7h', '2c'].map(c)).outs, 9);
});
