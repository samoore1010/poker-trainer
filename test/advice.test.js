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

// ----- your read on an opponent -----
const R = require('../public/ranges.js');
const share = (read, test) => read.groups.filter(g => test(g.key)).reduce((n, g) => n + g.n, 0) / read.n;
const strong = k => /^(sf|quads|fh|flush|straight|set|trips|two)$/.test(k);
function flopRead({ style, flop = [] } = {}) {
  const sc = spot({ pos: 'BB', cards: ['5d', '4d'], moves: [['UTG', 'raise', 5], [0, 'call']], wait: true });
  S.apply(sc, 'set_board', { cards: ['Kh', '7s', '2c'] });
  const utg = S.seatOfPosition(sc, 'UTG');
  if (style) S.apply(sc, 'set_opponent', { seat: utg, style });
  for (const [seat, action, amount] of flop) S.apply(sc, 'act', { seat, action, amount });
  return { sc, utg, read: S.readOf(sc, utg, 1) };
}
test('the read starts from the preflop chart for what they did', () => {
  const sc = spot({ pos: 'BTN', cards: ['Ah', 'Kd'], moves: [['UTG', 'raise', 5], ['HJ', 'call']] });
  const utg = S.seatOfPosition(sc, 'UTG'), hj = S.seatOfPosition(sc, 'HJ');
  assert.equal(S.inferredRanges(sc)[utg].kind, 'open'); assert.equal(S.inferredRanges(sc)[hj].kind, 'call-open');
  const r = S.readOf(sc, utg, 0);
  assert.equal(r.kind, 'model'); assert.ok(r.pct > 10 && r.pct < 18, r.pct);
  assert.match(r.steps[0].text, /Opened from UTG/);
  // your own cards are removed: no hand in the read uses your ace of hearts or king of diamonds
  const mine = ['Ah', 'Kd'].map(E.cardFromCode);
  assert.ok(r.combos.every(([a, b]) => !mine.includes(a) && !mine.includes(b)));
  assert.ok(S.engineOpponents(sc, 0).every(o => o.combos || o.cards));
  S.apply(sc, 'set_opponent', { seat: utg, range: 'QQ+' }); // a range you type is used as it is
  const typed = S.readOf(sc, utg, 0);
  assert.equal(typed.kind, 'range'); assert.ok(typed.pct < 2);
});
test('a big bet polarizes the read; a check takes strong hands out', () => {
  const before = flopRead().read;
  const bet = flopRead({ flop: [[0, 'check'], ['UTG', 'bet', 11]] }).read;
  const chk = flopRead({ flop: [[0, 'check'], ['UTG', 'check']] }).read;
  assert.equal(bet.steps.length, 2); assert.match(bet.steps[1].text, /Bet .* polarized/);
  const midK = k => /^(tpw|mid|under|bottom|small)$/.test(k);
  assert.ok(share(bet, strong) > share(before, strong) * 1.2, 'more strong hands after a big bet');
  assert.ok(share(bet, midK) < share(before, midK), 'fewer medium hands after a big bet');
  assert.ok(share(chk, strong) < share(before, strong) * 0.8, 'fewer strong hands after a check');
});
test('a calling station calls with weaker hands than a nit', () => {
  const flop = [[0, 'bet', 8], ['UTG', 'call']];
  const weak = k => /^(bottom|small|ace|air|gut|mid|under|tpw)/.test(k);
  assert.ok(share(flopRead({ style: 'calling station', flop }).read, weak) > share(flopRead({ style: 'nit', flop }).read, weak) * 1.3);
});
test('the read never depends on their hidden cards', () => {
  const a = flopRead({ flop: [[0, 'check'], ['UTG', 'bet', 11]] }), b = flopRead({ flop: [[0, 'check'], ['UTG', 'bet', 11]] });
  // two different deals (each spot() is a fresh random table), same public facts → same read
  assert.deepEqual(a.read.combos.map(h => h.join()).sort().slice(0, 50), b.read.combos.map(h => h.join()).sort().slice(0, 50));
  assert.ok(!('cards' in a.sc.opponents[a.utg - 1]) || a.sc.opponents[a.utg - 1].cards === null);
});
test('weighted hands in the engine', () => {
  const c = E.cardFromCode, hero = ['Qh', 'Qd'].map(c);
  const AA = [c('As'), c('Ac')], T2 = [c('2s'), c('2c')];
  const even = E.equity({ hero, opps: [{ combos: [[...AA, 1], [...T2, 1]] }], trials: 6000 }).chance;
  const aces = E.equity({ hero, opps: [{ combos: [[...AA, 3], [...T2, 1]] }], trials: 6000 }).chance;
  const none = E.equity({ hero, opps: [{ combos: [[...AA, 0], [...T2, 1]] }], trials: 6000 }).chance;
  assert.ok(aces < even - 10 && none > 75, `${even} ${aces} ${none}`);
});
test('hand classes on a board', () => {
  const c = x => x.map(E.cardFromCode), board = c(['Kh', '7h', '2c']);
  assert.equal(R.classify(c(['7s', '7d']), board).made, 'set');
  assert.equal(R.classify(c(['Ks', 'Qd']), board).key, 'G');
  assert.equal(R.classify(c(['Ah', '5h']), board).key, 'D2');
  assert.equal(R.classify(c(['9s', '8d']), board).key, 'A');
  assert.equal(R.classify(c(['As', 'Ad']), board).made, 'over');
  const f = R.freqs('S', { facing: false }), a = R.freqs('A', { facing: false });
  assert.ok(f.small + f.big > a.small + a.big);
  assert.ok(R.freqs('W', { facing: true, price: 0.25, mods: R.MODS.station }).call > R.freqs('W', { facing: true, price: 0.25, mods: R.MODS.nit }).call);
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

test('the read lists hands as a player names them, likeliest kind first', () => {
  const S = require('../public/scenario.js');
  const sc = S.create({ opponents: 1 });
  sc.hero.cards = ['2c', '3d']; sc.board = ['Ah', '6h', 'Ks'];
  S.apply(sc, 'act', { action: 'call' }); S.apply(sc, 'act', { action: 'check' });
  const r = S.readOf(sc, 1, 1);
  const shares = r.groups.filter(g => g.key !== 'air').map(g => g.n);
  assert.deepEqual(shares, [...shares].sort((a, b) => b - a));
  if (r.groups.some(g => g.key === 'air')) assert.equal(r.groups[r.groups.length - 1].key, 'air');
  const all = r.groups.flatMap(g => g.hands);
  assert.equal(all.reduce((n, h) => n + h.count, 0), r.combos.length);
  // two hearts on board: a heart only shows on hands with two hearts (a flush draw); A6 offsuit collapses
  const heart = E.suitOf(E.cardFromCode('Ah'));
  for (const h of all) h.suits.forEach(su => { if (su !== null) assert.equal(su, heart); });
  assert.ok(all.some(h => h.suits.every(su => su === null) && h.count > 1));
});
