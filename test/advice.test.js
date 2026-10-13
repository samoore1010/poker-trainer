'use strict';
// "What you should do" on textbook spots: 100-big-blind charts preflop, price and position after the flop.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const E = require('../public/engine.js');
const S = require('../public/scenario.js');

// Builds a table: hero position, hero cards, then moves in order ([seat, action, amount]); finally the action goes
// to the hero (everyone in between folds) unless `wait` is set.
function spot({ pos, n = 5, cards, moves = [], board, street = 0, wait = false, setup = [] }) {
  const sc = S.create({ opponents: n });
  const run = (name, args) => { const r = S.apply(sc, name, args); assert.ok(r.ok, `${name} ${JSON.stringify(args)}: ${r.error}`); };
  run('setup_table', { reset: true, opponents: n, hero_position: pos, starting_stack: 200 });
  run('set_hero_cards', { cards });
  for (const [name, args] of setup) run(name, args);
  if (board) run('set_board', { cards: board });
  for (const [seat, action, amount] of moves) {
    if (S.money(sc).next !== S.seatFrom(sc, seat)) run('action_to', { seat });
    run('act', { seat, action, amount });
  }
  if (!wait && S.money(sc).next !== 0) run('action_to', { seat: 0 });
  return sc;
}
function advise(opts) {
  const sc = spot(opts), s = S.money(sc).frontier;
  const hero = sc.hero.cards.map(E.cardFromCode), board = sc.board.slice(0, S.BOARD_N[s]).map(E.cardFromCode);
  return S.recommendation(sc, s, hero, board, E.equity({ hero, board, opps: S.engineOpponents(sc, s), trials: 4000 }));
}
const H = (cards, action, opts) => [cards, action, opts];
function check(name, pos, list, base = {}) {
  test(name, () => {
    for (const [cards, action, extra] of list) {
      const r = advise({ pos, cards, ...base, ...(extra || {}) });
      assert.equal(r.action, action, `${pos} ${cards.join('')}: expected ${action}, got ${r.action} (${r.reasons.join(' ')})`);
    }
  });
}

// ----- raise first in (folded to you) -----
check('UTG at six-handed opens about 16%: premiums and pairs raise, weak offsuit folds', 'UTG', [
  H(['Ah', 'Ad'], 'raise'), H(['2h', '2d'], 'raise'), H(['Ah', '5h'], 'raise'), H(['Kh', 'Qd'], 'raise'),
  H(['Kh', 'Jd'], 'fold'), H(['7h', '6h'], 'fold'), H(['Ah', '9d'], 'fold'), H(['9h', '4c'], 'fold'),
]);
check('hijack and cutoff open wider', 'CO', [
  H(['Ah', '8d'], 'raise'), H(['Kh', 'Td'], 'raise'), H(['6h', '5h'], 'raise'), H(['Kh', '9d'], 'fold'), H(['Jh', '7d'], 'fold'),
]);
check('the button opens nearly half its hands', 'BTN', [
  H(['Kh', '8d'], 'raise'), H(['Qh', '4h'], 'raise'), H(['8h', '7d'], 'raise'), H(['Qh', '5d'], 'fold'), H(['7h', '2d'], 'fold'),
]);
check('the small blind raises or folds when folded to', 'SB', [
  H(['Kh', '3h'], 'raise'), H(['Th', '9d'], 'raise'), H(['7h', '2d'], 'fold'), H(['Jh', '4d'], 'fold'),
]);
check('nine-handed under the gun is tight', 'UTG', [
  H(['6h', '6d'], 'raise'), H(['Kh', 'Qd'], 'raise'), H(['5h', '5d'], 'fold'), H(['Ah', '9d'], 'fold'), H(['Kh', 'Jd'], 'fold'),
], { n: 8 });

// ----- facing one raise -----
const utgOpen = { moves: [['UTG', 'raise', 5]] }, btnOpen = { moves: [['BTN', 'raise', 5]] };
check('big blind against an early raise: defend suited and strong hands, fold junk, 3-bet premiums', 'BB', [
  H(['Kh', '4d'], 'fold'), H(['Jh', '7d'], 'fold'), H(['Kh', 'Th'], 'call'), H(['7h', '7d'], 'call'), H(['Qh', 'Qd'], 'raise'),
], utgOpen);
check('big blind against a button raise defends wide', 'BB', [
  H(['Qh', '9d'], 'call'), H(['Kh', '2h'], 'call'), H(['7h', '2d'], 'fold'), H(['Ah', '5h'], 'raise'),
], btnOpen);
check('in position against an early raise: call pairs and big suited hands, fold the rest', 'CO', [
  H(['8h', '8d'], 'call'), H(['Ah', 'Jd'], 'fold'), H(['Kh', 'Td'], 'fold'), H(['Ah', 'Kd'], 'raise'),
], utgOpen);
check('button against a cutoff raise', 'BTN', [
  H(['Ah', '5h'], 'raise'), H(['Kh', 'Qd'], 'call'), H(['Th', '9h'], 'call'), H(['Kh', '8d'], 'fold'),
], { moves: [['CO', 'raise', 5]] });
check('small blind 3-bets or folds against early raises', 'SB', [
  H(['Ah', 'Jh'], 'fold'), H(['2h', '2d'], 'fold'), H(['Kh', 'Kd'], 'raise'),
], utgOpen);
check('a raise and a caller ahead: tighten up', 'BTN', [
  H(['7h', '6h'], 'fold'), H(['Ah', 'Td'], 'fold'), H(['Th', 'Td'], 'call'),
], { moves: [['UTG', 'raise', 5], ['HJ', 'call']] });

// ----- 3-bets and 4-bets -----
check('you opened and got 3-bet', 'UTG', [
  H(['Ah', 'Ad'], 'raise'), H(['Ah', 'Jd'], 'fold'), H(['Jh', 'Jd'], 'call'), H(['Kh', '9h'], 'fold'),
], { moves: [[0, 'raise', 5], ['CO', 'raise', 16]] });
check('button open against a big-blind 3-bet continues wider', 'BTN', [
  H(['Kh', 'Jh'], 'call'), H(['8h', '8d'], 'call'), H(['Kh', '9d'], 'fold'),
], { moves: [[0, 'raise', 5], ['BB', 'raise', 22]] });
check('a raise and a 3-bet before you: premiums only', 'BTN', [
  H(['Ah', 'Kh'], 'raise'), H(['Ah', 'Qd'], 'fold'), H(['Th', 'Td'], 'fold'),
], { moves: [['UTG', 'raise', 5], ['HJ', 'raise', 16]] });
check('facing a 4-bet', 'CO', [
  H(['Kh', 'Kd'], 'raise'), H(['Ah', 'Kd'], 'call'), H(['Jh', 'Jd'], 'fold'),
], { moves: [['UTG', 'raise', 5], [0, 'raise', 16], ['UTG', 'raise', 40]] });

// ----- limped pots -----
check('over a limper: raise good hands, limp small suited hands, fold the rest', 'BTN', [
  H(['Ah', 'Jd'], 'raise'), H(['8h', '7h'], 'call'), H(['6h', '4h'], 'fold'), H(['Kh', '5d'], 'fold'),
], { moves: [['UTG', 'call']] });
check('big blind after limps: check weak hands, raise strong ones', 'BB', [
  H(['7h', '2d'], 'check'), H(['Ah', 'Qd'], 'raise'),
], { moves: [['UTG', 'call'], ['BTN', 'call'], ['SB', 'call']] });
check('small blind completes cheaply in a limped pot', 'SB', [
  H(['Qh', '6h'], 'call'), H(['7h', '2d'], 'fold'),
], { moves: [['UTG', 'call'], ['BTN', 'call']] });

// ----- before your turn: a preview, not an instruction -----
test('before your turn you get what to do if it folds to you and if someone raises', () => {
  const bb = advise({ pos: 'BB', cards: ['7h', '2d'], wait: true });
  assert.equal(bb.action, 'wait'); assert.equal(bb.label, 'Not your turn yet');
  assert.equal(bb.preview.length, 2);
  assert.match(bb.preview[0].when, /calls/); assert.equal(bb.preview[0].action, 'check');
  assert.match(bb.preview[1].when, /raises to/); assert.equal(bb.preview[1].action, 'fold');
  const btn = advise({ pos: 'BTN', cards: ['Ah', 'Qh'], wait: true });
  assert.match(btn.preview[0].when, /folds to you/); assert.equal(btn.preview[0].action, 'raise');
  assert.notEqual(btn.preview[1].action, 'fold');
  const trash = advise({ pos: 'CO', cards: ['9h', '3d'], wait: true });
  assert.ok(trash.preview.every(p => p.action === 'fold'));
});
test('after you raise, the preview covers a re-raise', () => {
  const r = advise({ pos: 'UTG', cards: ['Ah', 'Jd'], moves: [[0, 'raise', 5]], wait: true });
  assert.equal(r.label, 'Your bet stands');
  assert.ok(r.preview.length >= 1 && r.preview[0].action === 'fold');
});

// ----- after the flop -----
test('postflop: bet a set, fold air on the river, call a cheap price', () => {
  const set = advise({ pos: 'BTN', n: 2, cards: ['Kd', 'Kc'], board: ['Kh', '7h', '2c'], moves: [] });
  assert.equal(set.action, 'bet'); assert.ok(set.gauge > 66);
  const air = advise({ pos: 'BTN', n: 1, cards: ['5d', '6d'], board: ['Kh', '7h', '2c', 'Js', 'Ac'], moves: [['BB', 'bet', 20]] });
  assert.equal(air.action, 'fold'); assert.ok(air.gauge < 34);
  const sc = S.create({ opponents: 5 });
  S.apply(sc, 'setup_table', { reset: true, opponents: 5, hero_position: 'BB' });
  S.apply(sc, 'set_hero_cards', { cards: ['As', 'Kd'] });
  S.apply(sc, 'set_board', { cards: ['Ad', '6s', '7s', '4s', '4d'] });
  S.apply(sc, 'set_action', { street: 'river', aggressor: 'HJ', amount: 72 });
  const hero = sc.hero.cards.map(E.cardFromCode), board = sc.board.map(E.cardFromCode);
  assert.equal(S.recommendation(sc, 3, hero, board, E.equity({ hero, board, opps: S.engineOpponents(sc, 3), trials: 3000 })).action, 'call');
});
test('out of position a marginal call becomes a fold (equity realization)', () => {
  const c = E.cardFromCode, hero = ['Ac', 'Kd'].map(c), board = ['9h', '5s', '2c'].map(c);
  const ctx = inPosition => ({ street: 1, hero, board, eq: { chance: 30 }, live: 1, players: 6, position: 'BB', inPosition, toCall: 50, pot: 150, bb: 2, aggressor: 'opp', bet: 50, rangesSet: true });
  assert.equal(E.recommend(ctx(true)).action, 'call');
  assert.equal(E.recommend(ctx(false)).action, 'fold');
});

// ----- opponents' likely hands from what they did -----
test('opponents are read from their preflop actions', () => {
  const sc = spot({ pos: 'BTN', cards: ['Ah', 'Kd'], moves: [['UTG', 'raise', 5], ['HJ', 'call']] });
  const inf = S.inferredRanges(sc), utg = S.seatOfPosition(sc, 'UTG'), hj = S.seatOfPosition(sc, 'HJ');
  assert.equal(inf[utg].kind, 'open'); assert.equal(inf[hj].kind, 'call-open');
  assert.ok(inf[utg].pct > 10 && inf[utg].pct < 22);
  assert.match(S.seatRangeLabel(sc, utg), /opened/);
  const opps = S.engineOpponents(sc, 0);
  assert.equal(opps.filter(o => o.range).length, 2); // the opener and the caller carry ranges; the blinds haven't acted yet
  S.apply(sc, 'set_opponent', { seat: utg, range: 'QQ+' }); // your read wins
  assert.equal(S.likelyRange(sc, utg), 'QQ+');
});

// ----- computer players -----
test('computer players raise or fold preflop; stations call more', () => {
  const count = style => {
    const out = { fold: 0, call: 0, raise: 0, check: 0 };
    for (let k = 0; k < 400; k++) {
      const sc = S.create({ opponents: 5 }), seat = S.money(sc).next;
      if (style) S.apply(sc, 'set_opponent', { seat, style });
      const deck = E.shuffle(E.DECK.slice()), a = S.autoAction(sc, seat, [deck[0], deck[1]], []);
      out[a.action === 'small' || a.action === 'big' ? 'raise' : a.action]++;
      assert.ok(S.apply(sc, 'act', { seat, action: a.action, amount: a.amount }).ok);
    }
    return out;
  };
  const reg = count(''), st = count('calling station');
  assert.equal(reg.call, 0); // a solid player opens or folds
  assert.ok(reg.fold > 300 && reg.raise > 30);
  assert.ok(st.call > 20);
});
