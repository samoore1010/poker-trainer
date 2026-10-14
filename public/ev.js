// What each choice is worth: for every action you could take now (fold, check, call, bet or raise at a few sizes),
// the chips you can expect to win or lose from here, against the opponents' likely hands and how they tend to answer.
//
// How: thousands of sampled deals. Each one draws a hand for every opponent from their weighted range (card removal
// respected) and the rest of the board. For a bet, each opponent folds, calls or raises with the frequencies the
// hand-reading model gives their kind of hand at that price (ranges.js, adjusted for their style). Then:
//   fold = 0 · call = your share of the final pot − what you put in · bet = the pot when all fold, otherwise your share
//   of the pot against the callers − your bet · a re-raise = the better of folding and calling it.
// Checking lets the players behind you bet; you then call or fold, whichever pays better on average.
// One street deep: later streets enter only through equity realization (out of position you win less than your raw
// share). The same sampled deals price every option, so the comparison between them is steady.
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./engine.js') : root.PokerEngine, node ? require('./ranges.js') : root.PokerRanges);
  if (node) module.exports = api;
  else root.PokerEV = api;
})(typeof self !== 'undefined' ? self : this, function (E, RG) {
  'use strict';
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

  // args: {hero: [c,c], board: [...], street (1–3), pot (everything in, this street's bets included), toCall, max (the
  //   bet to match), heroIn (your chips in on this street), heroBehind, minTo, maxTo (raise limits), unit (chip step),
  //   inPosition, opps: [{cards|combos, mods, in (chips in on this street), behind, after (acts after you this round)}],
  //   samples, seed}
  // → {options: [{key, label, to, add, share (of the pot), ev, folds (how often everyone folds)}], best, close}
  function evaluate(a) {
    const N = a.samples || 2500, R = rng(a.seed || 1), river = a.board.length >= 5;
    const realize = river || a.inPosition ? 1 : a.board.length === 3 ? 0.8 : 0.9;
    const dead = new Uint8Array(52); a.hero.concat(a.board).forEach(c => { dead[c] = 1; });
    const K = a.opps.length;
    // weighted pools, sampled through cumulative weights
    const pools = a.opps.map(o => {
      if (o.cards) return { fixed: o.cards };
      const list = (o.combos || []).filter(h => h[2] > 0 && !dead[h[0]] && !dead[h[1]]);
      const cum = new Float64Array(list.length); let t = 0; list.forEach((h, i) => { t += h[2]; cum[i] = t; });
      return { list, cum, total: t };
    });
    const pick = p => { if (p.fixed) return p.fixed; if (!p.list.length) return null; const x = R() * p.total; let lo = 0, hi = p.cum.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (p.cum[mid] < x) lo = mid + 1; else hi = mid; } return p.list[lo]; };
    // the sampled deals
    const heroV = new Float64Array(N), oppV = [], oppKey = [], u = [], u2 = [];
    for (let k = 0; k < K; k++) { oppV.push(new Float64Array(N)); oppKey.push(new Array(N)); u.push(new Float64Array(N)); u2.push(new Float64Array(N)); }
    const used = new Uint8Array(52), keyCache = new Map();
    let n = 0;
    for (let tries = 0; n < N && tries < N * 4; tries++) {
      used.set(dead);
      const hands = []; let bad = false;
      for (let k = 0; k < K && !bad; k++) { const h = pick(pools[k]); if (!h || used[h[0]] || used[h[1]]) bad = true; else { used[h[0]] = used[h[1]] = 1; hands.push(h); } }
      if (bad) continue;
      const run = a.board.slice();
      while (run.length < 5) { const c = (R() * 52) | 0; if (!used[c]) { used[c] = 1; run.push(c); } }
      heroV[n] = E.evalHand(a.hero.concat(run));
      for (let k = 0; k < K; k++) {
        const h = hands[k];
        oppV[k][n] = E.evalHand([h[0], h[1]].concat(run));
        const ck = h[0] * 52 + h[1];
        let key = keyCache.get(ck); if (key === undefined) { key = a.board.length >= 3 ? RG.classify([h[0], h[1]], a.board).key : 'M'; keyCache.set(ck, key); }
        oppKey[k][n] = key; u[k][n] = R(); u2[k][n] = R();
      }
      n++;
    }
    if (!n) return null;
    // your share of the pot in deal i against the opponents in `vs` (indexes)
    const share = (i, vs) => { let ties = 0; for (const k of vs) { if (oppV[k][i] > heroV[i]) return 0; if (oppV[k][i] === heroV[i]) ties++; } return 1 / (ties + 1); };
    const all = [...Array(K).keys()];
    const freqCache = new Map();
    const answer = (k, key, price, callers = 0) => { const ck = `${k}|${key}|${price.toFixed(3)}|${callers}`; let f = freqCache.get(ck); if (!f) { f = RG.freqs(key, { facing: true, price, river, mods: a.opps[k].mods, others: K - 1, callers }); freqCache.set(ck, f); } return f; };
    const P = a.pot, opts = [];

    // fold / call
    if (a.toCall > 0) {
      opts.push({ key: 'fold', label: 'Fold', ev: 0 });
      // players who haven't matched the bet yet (they act after you) still call or fold it
      const c = Math.min(a.toCall, a.heroBehind), owe = all.map(k => Math.max(0, Math.min(a.max - a.opps[k].in, a.opps[k].behind)));
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const vs = []; let pot = P + c;
        for (const k of all) {
          if (owe[k] <= 0) { vs.push(k); continue; }
          const f = answer(k, oppKey[k][i], owe[k] / (P + c + owe[k]), 1 + vs.filter(j => owe[j] > 0).length); // you called, and maybe others
          if (u[k][i] >= f.fold) { vs.push(k); pot += owe[k]; }
        }
        sum += vs.length ? realize * share(i, vs) * pot - c : pot - c;
      }
      opts.push({ key: 'call', label: c < a.toCall ? 'Call all-in' : 'Call', to: a.heroIn + c, add: c, ev: sum / n });
    } else {
      // check: the players behind may bet; you then call or fold, whichever pays better on average
      const behind = all.filter(k => a.opps[k].after);
      const sizes = { small: Math.max(a.unit, P * 0.4), big: Math.max(a.unit, P * 0.8) };
      const facing = { small: { sum: 0, n: 0 }, big: { sum: 0, n: 0 } }, plan = new Array(n);
      let quiet = 0;
      for (let i = 0; i < n; i++) {
        let bettor = -1, size = null;
        for (const k of behind) {
          const f = RG.freqs(oppKey[k][i], { facing: false, river, mods: a.opps[k].mods, others: K - 1 });
          const x = u2[k][i];
          if (x < f.big) { bettor = k; size = 'big'; break; }
          if (x < f.big + f.small) { bettor = k; size = 'small'; break; }
        }
        if (bettor < 0) { quiet += realize * share(i, all) * P; plan[i] = null; continue; }
        const b = Math.min(sizes[size], a.opps[bettor].behind, a.heroBehind);
        const v = realize * share(i, [bettor]) * (P + 2 * b) - b; // others fold to the bet and your call
        facing[size].sum += v; facing[size].n++; plan[i] = size;
      }
      const callSmall = facing.small.n && facing.small.sum > 0, callBig = facing.big.n && facing.big.sum > 0;
      const ev = (quiet + (callSmall ? facing.small.sum : 0) + (callBig ? facing.big.sum : 0)) / n;
      opts.push({ key: 'check', label: 'Check', ev, note: behind.length ? `if they bet: ${callSmall || callBig ? (callSmall && callBig ? 'call' : callBig ? 'call a big bet, fold to a small one' : 'call a small bet, fold to a big one') : 'fold'}` : '' });
    }

    // bets and raises
    const cap = a.heroIn + a.heroBehind, round = x => Math.max(a.unit, Math.round(x / a.unit) * a.unit);
    const targets = new Set();
    // multiway, facing a bet: raise only very strong hands (the callers' ranges are stronger than one read can show)
    const raiseOk = a.max === 0 || K < 3 || RG.classify(a.hero, a.board).key === 'S';
    if (a.heroBehind > a.toCall && raiseOk) {
      if (a.max === 0) {
        [0.33, 0.66, 1].forEach(f => targets.add(round(P * f)));
        if (K === 1 && a.board.length >= 4) targets.add(round(P * 1.5));
      } else {
        targets.add(round(a.max * 3)); targets.add(round(a.max + (P + a.toCall))); // 3x, and a pot-sized raise
      }
      if (a.heroBehind <= 3 * P) targets.add(cap); // short enough to move in
    }
    for (let to of [...targets].sort((x, y) => x - y)) {
      to = clamp(to, a.minTo || 0, cap); if (to <= a.max) continue;
      if (opts.some(o => o.to === to && o.key !== 'call')) continue;
      const add = to - a.heroIn, allIn = to >= cap;
      const call = all.map(k => Math.min(to - a.opps[k].in, a.opps[k].behind));
      const price = all.map(k => call[k] / (P + add + call[k]));
      let sum = 0, folds = 0; const raised = { call: 0, fold: 0, n: 0, vals: [] };
      for (let i = 0; i < n; i++) {
        const callers = []; let raiser = -1;
        for (const k of all) {
          const f = answer(k, oppKey[k][i], price[k], callers.length), x = u[k][i];
          if (x < f.fold) continue;
          if (x >= f.fold + f.call && !allIn && a.opps[k].behind > call[k] && raiser < 0) raiser = k; else callers.push(k);
        }
        if (raiser >= 0) {
          // they come back over the top (3x your bet, or all their chips): call it or fold
          const k = raiser, y = Math.min(a.opps[k].in + a.opps[k].behind, to + 2 * (to - a.max || to), cap);
          const pot = P + add + (y - a.opps[k].in) + (y - to);
          const vCall = realize * share(i, [k]) * pot - (add + (y - to));
          raised.vals.push(vCall); raised.n++;
          continue;
        }
        if (!callers.length) { sum += P; folds++; continue; }
        const pot = P + add + callers.reduce((t, k) => t + call[k], 0);
        sum += realize * share(i, callers) * pot - add;
      }
      // facing a re-raise: the better of calling (on average) and folding (losing the bet)
      if (raised.n) { const avg = raised.vals.reduce((t, v) => t + v, 0) / raised.n; sum += raised.n * Math.max(avg, -add); raised.call = avg > -add; }
      const label = allIn ? 'All-in' : a.max === 0 ? 'Bet' : 'Raise';
      opts.push({ key: a.max === 0 ? 'bet' : 'raise', label, to, add, allIn, potShare: (a.max === 0 ? add : to) / P, ev: sum / n, folds: folds / n, reraised: raised.n / n, callReraise: raised.call });
    }
    opts.sort((x, y) => y.ev - x.ev);
    const best = opts[0];
    // close: the best option of another kind (passive vs aggressive) is within a few percent of the pot
    const passive = o => o.key === 'check' || o.key === 'call' || o.key === 'fold';
    const other = opts.find(o => passive(o) !== passive(best) || (best.key === 'fold') !== (o.key === 'fold'));
    const close = !!other && best.ev - other.ev < Math.max(0.04 * P, a.unit / 2);
    return { options: opts, best, close, samples: n, realize };
  }

  return { evaluate, rng };
});
