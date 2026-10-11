'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const S = require('../public/scenario.js');

test('fresh table: blinds posted, under the gun to act', () => {
  const sc = S.create({ opponents: 5, stack: 200 });
  assert.equal(S.positions(sc)[0], 'BB');
  const m = S.money(sc);
  assert.equal(m.potShow[0], 3); assert.equal(S.positions(sc)[m.next], 'UTG'); assert.equal(m.frontier, 0);
});

test('scripted preflop raise stops at your decision', () => {
  const sc = S.create({ opponents: 5 });
  assert.ok(S.apply(sc, 'setup_table', { reset: true, opponents: 5, hero_position: 'BTN', starting_stack: 100 }).ok);
  const r = S.apply(sc, 'set_action', { street: 'preflop', aggressor: 'UTG', amount: 6, folds: ['SB', 'HJ', 'CO'] });
  assert.ok(r.ok, r.error);
  const m = S.money(sc);
  assert.equal(m.next, 0); assert.equal(m.toCall[0], 6); assert.equal(m.potShow[0], 9); // blinds 1+2, UTG 6
  S.apply(sc, 'act', { action: 'call' });
  const m2 = S.money(sc); // SB folds (scripted), BB still to act
  assert.equal(S.positions(sc)[m2.next], 'BB');
});

test('turn order, round completion and the next street', () => {
  const sc = S.create({ opponents: 2 }); // you BB; seats: BTN, SB
  const order = [];
  for (let i = 0; i < 3; i++) { const m = S.money(sc); order.push(S.positions(sc)[m.next]); S.apply(sc, 'act', { action: m.next === 0 ? 'check' : 'call' }); }
  assert.deepEqual(order, ['BTN', 'SB', 'BB']);
  const m = S.money(sc);
  assert.equal(m.street[0].complete, true); assert.equal(m.frontier, 1); assert.equal(m.potShow[0], 6);
  assert.equal(S.positions(sc)[m.street[1].next], 'SB'); // first to act after the flop
});

test('a bet re-opens the action and everyone folding ends the hand', () => {
  const sc = S.create({ opponents: 2 });
  S.apply(sc, 'act', { action: 'small' }); // BTN raises
  S.apply(sc, 'act', { action: 'fold' }); // SB
  assert.ok(S.apply(sc, 'act', { action: 'fold' }).ok); // you
  const m = S.money(sc);
  assert.equal(m.ended.winner, sc.opponents.findIndex((o, i) => S.positions(sc)[i + 1] === 'BTN') + 1);
  assert.equal(S.apply(sc, 'act', { action: 'call' }).ok, false);
});

test('all-in caps at the stack', () => {
  const sc = S.create({ opponents: 1, stack: 50, randomStacks: false });
  assert.equal(S.positions(sc)[0], 'BTN'); // heads-up you start on the button and act first
  S.apply(sc, 'act', { action: 'allin' });
  const m = S.money(sc);
  assert.equal(m.street[0].max, 50); assert.equal(m.next, 1);
  assert.equal(S.choices(sc).owe, 48); assert.equal(S.choices(sc).canRaise, false);
  S.apply(sc, 'act', { action: 'call' });
  assert.equal(S.money(sc).frontier, 4); // nobody left to bet: straight to showdown
});

test('auto-play makes a legal move', () => {
  const E = require('../public/engine.js');
  for (let k = 0; k < 30; k++) {
    const sc = S.create({ opponents: 4 }), m = S.money(sc);
    const hole = [E.rnd(13) * 4, E.rnd(13) * 4 + 1];
    const a = S.autoAction(sc, m.next, hole, []);
    assert.ok(S.apply(sc, 'act', { action: a.action }).ok);
  }
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

test('setting a board finishes the betting before it', () => {
  const sc = S.create({ opponents: 3 });
  S.apply(sc, 'set_action', { street: 'preflop', aggressor: 'UTG', amount: 6 });
  assert.ok(S.apply(sc, 'set_board', { cards: ['Kh', '7h', '2c'] }).ok);
  const m = S.money(sc);
  assert.equal(m.street[0].complete, true); assert.equal(sc.street, 1); assert.equal(m.frontier, 1);
  assert.equal(m.potShow[0], 24); // four players in for 6
});
