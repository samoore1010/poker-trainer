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

test('blind sizes', () => {
  const sc = S.create({ opponents: 5 });
  assert.ok(S.apply(sc, 'setup_table', { big_blind: 3, small_blind: 1 }).ok);
  let m = S.money(sc);
  assert.equal(m.potShow[0], 4);
  assert.equal(S.blindOf(sc, S.seatOfPosition(sc, 'SB')), 1);
  S.apply(sc, 'setup_table', { big_blind: 10 }); // a new big blind alone resets the small blind to half
  assert.equal(sc.smallBlind, 5); assert.equal(S.money(sc).potShow[0], 15);
  const back = S.normalize(JSON.parse(JSON.stringify(sc))).scenario;
  assert.equal(back.smallBlind, 5);
});

test('moving the dealer button moves every position and restarts the betting', () => {
  const sc = S.create({ opponents: 5 });
  S.apply(sc, 'act', { action: 'raise', amount: 6 });
  const r = S.apply(sc, 'set_button', { seat: 0 });
  assert.ok(r.ok, r.error); assert.match(r.summary, /on the button/);
  assert.equal(S.positions(sc)[0], 'BTN'); assert.equal(S.positions(sc)[1], 'SB');
  assert.equal(S.money(sc).street[0].actions.length, 0);
  assert.ok(S.apply(sc, 'set_button', { seat: 'Nobody' }).ok === false);
});

test('action to a player: everyone before folds, or it goes back to their turn', () => {
  const sc = S.create({ opponents: 5 });
  S.apply(sc, 'setup_table', { hero_position: 'BTN' });
  const r = S.apply(sc, 'action_to', { seat: 'hero' });
  assert.ok(r.ok, r.error); assert.equal(S.money(sc).next, 0);
  assert.equal(S.money(sc).street[0].actions.filter(a => a.type === 'fold').length, 3);
  S.apply(sc, 'act', { action: 'raise', amount: 5 });
  assert.ok(S.apply(sc, 'action_to', { seat: 0 }).ok); // already acted: back to your turn
  assert.equal(S.money(sc).next, 0); assert.equal(S.money(sc).street[0].max, 2);
  // the big blind can't be reached by folds alone: the hand would end first
  const sc2 = S.create({ opponents: 5 });
  assert.equal(S.apply(sc2, 'action_to', { seat: 'BB' }).ok, false);
  assert.ok(S.apply(sc2, 'action_to', { seat: 'BB', passive: true }).ok);
});

test('amounts can be shown in big blinds', () => {
  const sc = S.create({ opponents: 2 });
  S.setUnit('bb');
  try {
    assert.equal(S.fmt(sc, 5), '2.5 BB');
    S.apply(sc, 'act', { action: 'raise', amount: 6 });
    assert.match(S.money(sc).street[0].actions[0].text, /3 BB/);
  } finally { S.setUnit('$'); }
  assert.equal(S.fmt(sc, 5), '$5');
});

// ----- following the betting a camera saw -----
function sixMax() { const sc = S.create({ opponents: 5 }); S.apply(sc, 'setup_table', { reset: true, opponents: 5, hero_position: 'BB', starting_stack: 200 }); return sc; }
const seat = (folded, bet, last) => ({ folded, bet, last });

test('camera betting: missing actions are played in turn order up to whose turn it is', () => {
  const sc = sixMax();
  const seen = { players: 6, heroPosition: 'BB', toAct: 'BB', unit: 'chips', seats: {
    UTG: seat(false, 6, 'raise'), HJ: seat(true, 0, 'fold'), CO: seat(false, 6, 'call'), BTN: seat(true, 0, 'fold'), SB: seat(true, 1, 'fold'), BB: seat(false, 2, 'post') } };
  const r = S.followBetting(sc, seen, 0);
  assert.ok(r.ok, r.error);
  assert.equal(r.log.length, 5);
  const m = S.money(r.sc);
  assert.equal(m.next, 0); assert.equal(m.street[0].max, 6); assert.equal(m.toCall[0], 4);
  assert.equal(S.money(sc).street[0].actions.length, 0); // the original is untouched
  // already up to date: nothing new
  const again = S.followBetting(r.sc, seen, 0);
  assert.ok(again.ok); assert.equal(again.log.length, 0);
});

test('camera betting: a picture that does not add up changes nothing', () => {
  const sc = sixMax();
  const base = { UTG: seat(false, 6, 'raise'), HJ: seat(true, 0, 'fold'), CO: seat(false, 6, 'call'), BTN: seat(true, 0, 'fold'), SB: seat(true, 1, 'fold'), BB: seat(false, 2, 'post') };
  assert.equal(S.followBetting(sc, { players: 6, heroPosition: 'BB', toAct: 'CO', unit: 'chips', seats: base }, 0).ok, false); // wrong turn
  assert.equal(S.followBetting(sc, { players: 6, heroPosition: 'BB', toAct: 'BB', unit: 'chips', seats: { ...base, CO: seat(false, 6, 'raise') } }, 0).ok, false); // label vs chips
  assert.equal(S.followBetting(sc, { players: 6, heroPosition: 'BTN', toAct: 'BB', unit: 'chips', seats: base }, 0).ok, false); // a different table
  assert.equal(S.followBetting(sc, { players: 6, heroPosition: 'BB', toAct: 'BB', unit: 'chips', seats: { ...base, CO: seat(false, 4, 'call') } }, 0).ok, false); // less than the bet
});

test('camera betting: the flop picture finishes preflop first, amounts in big blinds work', () => {
  const sc = sixMax();
  const seen = { players: 6, heroPosition: 'BB', toAct: 'CO', unit: 'bb', seats: {
    UTG: seat(false, 4, 'bet'), HJ: seat(true, 0, 'none'), CO: seat(false, 0, 'none'), BTN: seat(true, 0, 'none'), SB: seat(true, 0, 'none'), BB: seat(false, 0, 'check') } };
  const r = S.followBetting(sc, seen, 1);
  assert.ok(r.ok, r.error);
  const m = S.money(r.sc);
  assert.equal(m.frontier, 1); assert.deepEqual(m.liveAfter[0], [0, 1, 3]); // UTG, CO and you saw the flop
  assert.equal(m.street[1].max, 8); assert.equal(S.positions(r.sc)[m.next], 'CO');
});
