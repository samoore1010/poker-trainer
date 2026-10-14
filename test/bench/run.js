'use strict';
// Plays each benchmark spot onto a table and asks the advice what to do. Deterministic: a seeded random generator
// drives the equity simulations, so the score only moves when the advice changes.
const E = require('../../public/engine.js');
const S = require('../../public/scenario.js');

function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function build(spot) {
  const sc = S.create({ opponents: spot.opponents || 5, stack: spot.stack || 200, bigBlind: 2, randomStacks: false });
  const must = (r, what) => { if (!r.ok) throw new Error(`${spot.id}: ${what}: ${r.error}`); };
  must(S.apply(sc, 'setup_table', { hero_position: spot.pos }), 'position');
  must(S.apply(sc, 'set_hero_cards', { cards: spot.hero }), 'cards');
  for (const [pos, style] of Object.entries(spot.styles || {})) must(S.apply(sc, 'set_opponent', { seat: pos, style }), 'style');
  const streets = [{ acts: spot.pre || [] }, spot.flop, spot.turn, spot.river];
  let board = [], last = 0;
  streets.forEach((st, s) => { if (st) last = s; });
  for (let s = 0; s <= last; s++) {
    const st = streets[s];
    if (s > 0) { board = board.concat(st.cards); must(S.apply(sc, 'set_board', { cards: board }), `board ${s}`); }
    for (const [who, action, to] of st.acts || []) {
      const seat = who === 'hero' ? 0 : S.seatFrom(sc, who);
      if (seat < 0) throw new Error(`${spot.id}: no seat ${who}`);
      if (S.money(sc).next !== seat) must(S.apply(sc, 'action_to', { seat }), `action to ${who}`);
      must(S.apply(sc, 'act', { seat, action, amount: to }), `${who} ${action}`);
    }
  }
  const m = S.money(sc);
  if (m.next !== 0) must(S.apply(sc, 'action_to', { seat: 0 }), 'action to you');
  return sc;
}

// → {spot, got, ok, rec}
function runSpot(spot, opts = {}) {
  const real = Math.random; Math.random = seeded(opts.seed || 12345);
  try {
    const sc = build(spot), m = S.money(sc), s = m.frontier;
    const hero = sc.hero.cards.map(E.cardFromCode), board = sc.board.map(E.cardFromCode).slice(0, S.BOARD_N[s]);
    const eq = E.equity({ hero, board, opps: S.engineOpponents(sc, s), trials: opts.trials || 4000 });
    const rec = S.recommendation(sc, s, hero, board, eq);
    let ok = spot.ok.includes(rec.action), share = null;
    if (ok && spot.size && (rec.action === 'bet' || rec.action === 'raise')) {
      share = rec.size ? rec.size / m.potShow[s] : null;
      ok = share !== null && share >= spot.size[0] - 1e-9 && share <= spot.size[1] + 1e-9;
    }
    return { spot, got: rec.action + (share !== null ? ` ${Math.round(share * 100)}% pot` : ''), ok, rec };
  } finally { Math.random = real; }
}

function runAll(spots, opts) {
  const results = spots.map(sp => runSpot(sp, opts));
  const byCat = {};
  for (const r of results) { const c = byCat[r.spot.cat] || (byCat[r.spot.cat] = { n: 0, ok: 0 }); c.n++; if (r.ok) c.ok++; }
  const ok = results.filter(r => r.ok).length;
  return { results, byCat, ok, n: results.length, score: Math.round(ok / results.length * 1000) / 10 };
}

module.exports = { build, runSpot, runAll, seeded };
