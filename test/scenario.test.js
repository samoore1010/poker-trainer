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

test('next hand at the same table: pot paid, stacks carried, button moves, your cards face down', () => {
  const E = require('../public/engine.js');
  const c = s => s.split(' ').map(E.cardFromCode);
  const sc = S.create({ opponents: 2, stack: 100, randomStacks: false }); // you BB, seat 1 BTN? check by positions
  const cards = { hero: c('As Ah'), opps: [c('Kd Kc'), c('2c 7d')], board: c('Ad 9s 4h 3c Jd') };
  // everyone else folds to you preflop except one caller, then the rest is played out
  const res = S.settleHand(sc, cards);
  const total = res.stacks.reduce((a, b) => a + b, 0);
  assert.equal(total, 300); // chips are never created or lost
  const before = sc.button;
  assert.ok(S.apply(sc, 'next_hand', { stacks: res.stacks }).ok);
  assert.equal(sc.button, (before + 1) % 3);
  assert.equal(sc.handNo, 2); assert.equal(sc.heroHidden, true);
  assert.deepEqual([sc.hero.stack, ...sc.opponents.map(o => o.stack)], res.stacks.map(x => x || 200));
  assert.equal(S.money(sc).street[0].actions.length, 0);
  // picking your cards turns them face up
  S.apply(sc, 'set_hero_cards', { cards: ['Qs', 'Qh'] });
  assert.equal(sc.heroHidden, false);
  assert.equal(S.normalize(sc).scenario.handNo, 2);
});

test('settling pays side pots to the best eligible hand', () => {
  const E = require('../public/engine.js');
  const c = s => s.split(' ').map(E.cardFromCode);
  const sc = S.create({ opponents: 2, stack: 100, randomStacks: false });
  sc.opponents[0].stack = 20; // a short stack
  const pos = S.positions(sc), order = ['BTN', 'SB', 'BB'].map(p => pos.indexOf(p));
  // BTN all-in, SB all-in, BB calls
  for (const seat of order) S.apply(sc, 'act', { seat, action: seat === 0 && pos[0] === 'BB' ? 'call' : 'allin' });
  const m = S.money(sc);
  assert.equal(m.foldedAt.every(x => x === null), true);
  // seat 1 (short) has the best hand: it wins only the main pot (3 × 20)
  const res = S.settleHand(sc, { hero: c('Kd Kc'), opps: [c('As Ah'), c('2c 7d')], board: c('Ad 9s 4h 3c Jd') });
  assert.equal(res.won[1], 60);
  assert.equal(res.stacks.reduce((a, b) => a + b, 0), 220);
  assert.equal(res.stacks[0], 160); // the side pot goes to your kings
});

test('your face-down cards say nothing about anyone\'s range', () => {
  const sc = S.create({ opponents: 2 });
  sc.hero.cards = ['As', 'Ah']; sc.heroHidden = true;
  const hidden = S.readOf(sc, 1, 0).n;
  sc.heroHidden = false;
  assert.ok(hidden > S.readOf(sc, 1, 0).n); // seen cards remove combos; unseen ones don't
  sc.heroHidden = true;
  assert.match(S.summary(sc), /not known yet/);
});

test('sync table: offers only what was read clearly, applies picked lines, keeps known players', () => {
  const sc = S.create({ opponents: 2, stack: 100, randomStacks: false });
  sc.opponents[0].name = 'Ravi'; sc.opponents[0].style = 'maniac'; sc.opponents[1].name = 'Greta';
  const seat = (name, stack, dealer = false) => ({ name, stack, dealer, folded: false, bet: 0, last: 'none' });
  const T = { readable: { cards: true, seats: true, names: true, stacks: true, betting: false }, problems: [], unit: 'chips', blinds: null,
    seats: [{ ...seat('You', 79), bet: 1, last: 'post' }, { ...seat('Ravi', 118), bet: 2, last: 'post' }, seat('Lena', 60), seat('Greta', 90, true)], toAct: 2, board: [], hero: null }; // you SB, Ravi BB
  const plan = S.syncPlan(sc, T), ids = plan.map(x => x.id);
  assert.ok(ids.includes('players') && ids.includes('dealer') && ids.includes('name:2') && ids.includes('stack:0'));
  S.applySync(sc, T, ids);
  assert.deepEqual(sc.opponents.map(o => o.name), ['Ravi', 'Lena', 'Greta']);
  assert.equal(sc.opponents[0].style, 'maniac'); // Ravi kept his read
  assert.equal(sc.button, 3);
  assert.deepEqual([sc.hero.stack, ...sc.opponents.map(o => o.stack)], [80, 120, 60, 90]); // a new seating: no chips in yet
  assert.equal(S.syncPlan(sc, T).length, 0); // now in sync
  // a known player seen in another seat brings their read along; stacks stay seat by seat
  sc.opponents[2].note = 'tells: shakes when strong';
  const T3 = { ...T, seats: [T.seats[0], { ...T.seats[3], name: 'Greta' }, T.seats[2], { ...T.seats[1], name: 'Ravi', dealer: true }] };
  T3.seats[1] = { ...T3.seats[1], dealer: false, stack: 118, bet: 2, last: 'post' }; T3.seats[3] = { ...T3.seats[3], stack: 90, bet: 0, last: 'none' };
  S.applySync(sc, T3, S.syncPlan(sc, T3).map(x => x.id));
  assert.deepEqual(sc.opponents.map(o => o.name), ['Greta', 'Lena', 'Ravi']);
  assert.equal(sc.opponents[0].note, 'tells: shakes when strong'); assert.equal(sc.opponents[2].style, 'maniac');
  assert.deepEqual(sc.opponents.map(o => o.stack), [120, 60, 90]);
  // unreadable stacks are not offered
  const T2 = { ...T, readable: { ...T.readable, stacks: false }, seats: T.seats.map(x => ({ ...x, stack: 5 })) };
  assert.equal(S.syncPlan(sc, T2).filter(x => x.id.startsWith('stack')).length, 0);
  // seats unreadable: nothing at all
  assert.equal(S.syncPlan(sc, { ...T, readable: { ...T.readable, seats: false } }).length, 0);
});

test('player stats: only real decisions count; a style follows from enough hands; your own call wins', () => {
  const sc = S.create({ opponents: 2, stack: 200, randomStacks: false });
  sc.opponents[0].name = 'Ravi'; sc.opponents[1].name = 'Greta';
  const pos = S.positions(sc), seatOf = p => pos.indexOf(p); // you BB: BTN and SB act first
  S.apply(sc, 'act', { seat: seatOf('BTN'), action: 'call' });
  S.apply(sc, 'act', { seat: seatOf('SB'), action: 'raise', amount: 8, auto: true }); // the computer's move
  const hs = S.handStats(sc);
  assert.deepEqual(Object.keys(hs), [sc.opponents[seatOf('BTN') - 1].name.toLowerCase()]);
  assert.equal(Object.values(hs)[0].vpip, 1); assert.equal(Object.values(hs)[0].pfr, 0);
  // 20 hands of calling almost everything, never raising: a calling station
  const book = {};
  for (let i = 0; i < 20; i++) S.addStats(book, { ravi: { name: 'Ravi', hands: 1, vpip: i % 5 ? 1 : 0, pfr: 0, agg: 0, calls: 2 } });
  assert.equal(S.styleFromStats(book.ravi), 'calling station');
  assert.equal(S.styleFromStats({ hands: 5, vpip: 5, pfr: 0, agg: 0, calls: 0 }), null); // too few hands
  assert.equal(S.styleFromStats({ hands: 30, vpip: 3, pfr: 2, agg: 1, calls: 1 }), 'nit');
  assert.equal(S.styleFromStats({ hands: 30, vpip: 6, pfr: 5, agg: 5, calls: 3 }), 'tight');
  assert.deepEqual(S.applyStats(sc, book), ['Ravi: calling station']);
  assert.equal(sc.opponents[0].styleBy, 'stats');
  S.apply(sc, 'set_opponent', { seat: 1, style: 'nit' }); // you know better
  assert.deepEqual(S.applyStats(sc, book), []); assert.equal(sc.opponents[0].style, 'nit');
  assert.equal(S.normalize(sc).scenario.opponents[0].styleBy, 'you');
});

test('live tracking: follows chips, folds and whose turn; repairs folds a fast flop filled in as calls', () => {
  const sc = S.create({ opponents: 5, stack: 200, randomStacks: false });
  const pos = S.positions(sc), at = p => pos.indexOf(p);
  const seat = (o = {}) => ({ name: '', stack: 190, dealer: false, folded: false, bet: 0, last: 'none', ...o });
  const table = (bySeat, toAct) => ({ unit: 'chips', toAct, seats: pos.map((p, i) => seat({ dealer: p === 'BTN', ...(bySeat[p] || {}) })) });
  // preflop: UTG raises to 5, HJ folds, CO calls, BTN folds; the small blind is to act
  const pre = table({ BB: { bet: 2, last: 'post' }, SB: { bet: 1, last: 'post' }, UTG: { bet: 5, last: 'raise' }, HJ: { folded: true, last: 'fold' }, CO: { bet: 5, last: 'call' }, BTN: { folded: true, last: 'fold' } }, at('SB'));
  const r1 = S.trackTable(sc, pre, 0);
  assert.ok(r1.ok, r1.error);
  const m1 = S.money(r1.sc);
  assert.equal(m1.next, at('SB')); assert.equal(m1.street[0].max, 5);
  assert.deepEqual(m1.street[0].actions.map(a => `${pos[a.seat]} ${a.type}`), ['UTG raise', 'HJ fold', 'CO call', 'BTN fold']);
  // the flop lands before the camera saw the small blind fold and you call: the table fills those in as calls
  S.apply(r1.sc, 'set_board', { cards: ['Ah', '7c', '2d'] });
  assert.equal(S.money(r1.sc).foldedAt[at('SB')], null);
  // the next reading: the small blind folded; you checked, UTG bets 8, CO to act
  const flop = table({ SB: { folded: true, last: 'fold' }, BB: { last: 'check' }, UTG: { bet: 8, last: 'bet' }, HJ: { folded: true }, BTN: { folded: true } }, at('CO'));
  const r2 = S.trackTable(r1.sc, flop, 1);
  assert.ok(r2.ok, r2.error);
  const m2 = S.money(r2.sc);
  assert.equal(m2.foldedAt[at('SB')], 0); // a preflop fold now, not a call
  assert.equal(m2.next, at('CO')); assert.equal(m2.street[1].max, 8);
  assert.equal(m2.potShow[1], 1 + 5 + 5 + 5 + 8); // SB's blind, three callers of 5 and the bet
  // a reading that contradicts the table is refused
  const bad = table({ UTG: { folded: true }, HJ: { folded: true }, BTN: { folded: true }, SB: { folded: true } }, at('CO'));
  assert.equal(S.trackTable(r2.sc, bad, 1).ok, false);
});
