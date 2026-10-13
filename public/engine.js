// Poker math engine shared by the browser (window.PokerEngine), the Web Worker (importScripts) and the server (require).
// Exact 7-card evaluator, hand descriptions, opponent ranges, and equity by simulation or, where small enough, full enumeration.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PokerEngine = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ----- cards: int = rank * 4 + suit; rank 0 = deuce … 12 = ace; suit c d h s -----
  const RANKS = '23456789TJQKA', SUITS = 'cdhs', SYM = ['♣', '♦', '♥', '♠'];
  const RN = ['two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'jack', 'queen', 'king', 'ace'];
  const RP = ['twos', 'threes', 'fours', 'fives', 'sixes', 'sevens', 'eights', 'nines', 'tens', 'jacks', 'queens', 'kings', 'aces'];
  const SN = ['clubs', 'diamonds', 'hearts', 'spades'];
  const rankOf = c => c >> 2, suitOf = c => c & 3;
  const DECK = Array.from({ length: 52 }, (_, i) => i);
  const rnd = n => Math.floor(Math.random() * n);
  function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = rnd(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
  // "Ah", "ah", "10h", "AH" → int; anything else → -1
  function cardFromCode(code) {
    const m = String(code || '').trim().match(/^(10|[2-9tjqka])([cdhs])$/i);
    if (!m) return -1;
    const r = RANKS.indexOf(m[1] === '10' ? 'T' : m[1].toUpperCase());
    return r * 4 + SUITS.indexOf(m[2].toLowerCase());
  }
  const codeOf = c => RANKS[rankOf(c)] + SUITS[suitOf(c)];
  const cardText = c => RANKS[rankOf(c)] + SYM[suitOf(c)];

  // ----- evaluator: higher value = better hand; category = floor(v / M) -----
  const B = 13, M = B ** 5;
  function straightHigh(bits) { for (let h = 12; h >= 4; h--) { const m = 0x1F << (h - 4); if ((bits & m) === m) return h; } return ((bits & 0x100F) === 0x100F) ? 3 : -1; }
  function top5(bits) { let v = 0, n = 0; for (let r = 12; r >= 0 && n < 5; r--) if (bits & (1 << r)) { v = v * B + r; n++; } return v; }
  function evalHand(cs) {
    const cnt = new Array(13).fill(0), sc = [0, 0, 0, 0], sb = [0, 0, 0, 0]; let bits = 0;
    for (const c of cs) { const r = rankOf(c), s = suitOf(c); cnt[r]++; bits |= 1 << r; sc[s]++; sb[s] |= 1 << r; }
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) { const sh = straightHigh(sb[s]); if (sh >= 0) return 8 * M + sh; return 5 * M + top5(sb[s]); }
    let quad = -1; const trips = [], pairs = [], singles = [];
    for (let r = 12; r >= 0; r--) { if (cnt[r] === 4) quad = r; else if (cnt[r] === 3) trips.push(r); else if (cnt[r] === 2) pairs.push(r); else if (cnt[r] === 1) singles.push(r); }
    if (quad >= 0) { let k = 12; while (k === quad || !cnt[k]) k--; return 7 * M + quad * B + k; }
    if (trips.length && (pairs.length || trips.length > 1)) { const p = trips.length > 1 ? trips[1] : pairs[0]; return 6 * M + trips[0] * B + p; }
    const sh = straightHigh(bits); if (sh >= 0) return 4 * M + sh;
    if (trips.length) { const ks = singles.concat(pairs).sort((a, b) => b - a); return 3 * M + trips[0] * B * B + ks[0] * B + ks[1]; }
    if (pairs.length >= 2) { const k = Math.max(...singles, ...(pairs.slice(2))); return 2 * M + pairs[0] * B * B + pairs[1] * B + k; }
    if (pairs.length === 1) return 1 * M + pairs[0] * B ** 3 + singles[0] * B * B + singles[1] * B + singles[2];
    return top5(bits);
  }
  const cat = v => Math.floor(v / M);
  const CATN = ['High card', 'Pair', 'Two pair', 'Three of a kind', 'Straight', 'Flush', 'Full house', 'Four of a kind', 'Straight flush'];

  // ----- descriptions: {v, c, text, short, shared} -----
  function describe(hero, board) {
    const all = hero.concat(board), v = evalHand(all), c = cat(v);
    const cnt = new Array(13).fill(0); for (const x of all) cnt[rankOf(x)]++;
    const hr = hero.map(rankOf), has = r => hr.includes(r), both = r => hr[0] === r && hr[1] === r;
    const boardOnly = board.length === 5 && evalHand(board) === v;
    let t, s, shared = boardOnly;
    if (c === 0) { const hi = Math.max(...all.map(rankOf)); s = `${cap(RN[hi])} high`; t = `${RN[hi]} high`; }
    else if (c === 1) { const p = cnt.findIndex(n => n === 2); if (both(p)) { s = `Pair of ${RP[p]}`; t = `a pair of ${RP[p]} in hand <span class="term">(pocket pair)</span>`; } else if (has(p)) { s = `Pair of ${RP[p]}`; t = `a pair of ${RP[p]}`; } else { s = 'Board pair only'; shared = true; t = `the board's pair of ${RP[p]}, shared by everyone`; } }
    else if (c === 2) { const ps = []; for (let r = 12; r >= 0; r--) if (cnt[r] === 2) ps.push(r); const mine = ps.slice(0, 2).filter(has).length; s = 'Two pair'; t = `two pair, ${RP[ps[0]]} and ${RP[ps[1]]}` + (mine === 2 ? '' : mine === 1 ? ' (one pair is on the board)' : ' (both pairs on the board, shared)'); if (mine === 0) { shared = true; s = 'Board two pair'; } }
    else if (c === 3) { const tr = cnt.findIndex(n => n === 3); if (both(tr)) { s = `Three ${RP[tr]}`; t = `three ${RP[tr]}, pair hidden in hand <span class="term">(a set)</span>`; } else if (has(tr)) { s = `Three ${RP[tr]}`; t = `three ${RP[tr]} <span class="term">(trips)</span>`; } else { s = 'Board trips'; shared = true; t = `three ${RP[tr]} on the board, shared`; } }
    else if (c === 4) { s = 'Straight'; t = `a straight, ${RN[v % M]} high`; }
    else if (c === 5) { const sc = [0, 0, 0, 0]; all.forEach(x => sc[suitOf(x)]++); const su = sc.findIndex(n => n >= 5); const hi = Math.max(...all.filter(x => suitOf(x) === su).map(rankOf)); s = 'Flush'; t = `a flush in ${SN[su]}, ${RN[hi]} high`; }
    else if (c === 6) { const tr = Math.floor((v % M) / B), p = v % B; s = 'Full house'; t = `a full house, ${RP[tr]} full of ${RP[p]}`; }
    else if (c === 7) { s = 'Four of a kind'; t = `four ${RP[Math.floor((v % M) / B)]}`; }
    else { s = (v % M) === 12 ? 'Royal flush' : 'Straight flush'; t = (v % M) === 12 ? 'a royal flush' : `a straight flush, ${RN[v % M]} high`; }
    if (boardOnly) t += ' (on the board, shared by everyone)';
    return { v, c, text: t, short: s, shared };
  }
  function preflopShort(hero) { const [a, b] = hero.map(rankOf).sort((x, y) => y - x); if (a === b) return `Pair of ${RP[a]}`; return `${cap(RN[a])}-${RN[b]}${suitOf(hero[0]) === suitOf(hero[1]) ? ' suited' : ''}`; }

  // Which better hand a runout gives you (null = no real improvement).
  function pathOf(hero, board, curCat) {
    const all = hero.concat(board), v = evalHand(all), c = cat(v); if (c <= curCat) return null;
    const hr = hero.map(rankOf), has = r => hr.includes(r), x = v % M;
    if (c === 1) { const p = Math.floor(x / (B * B * B)); return has(p) ? { key: 'P' + p, c, ord: c * 13 + p, label: `Pair of ${RP[p]}` } : null; }
    if (c === 2) { const p1 = Math.floor(x / (B * B)), p2 = Math.floor(x / B) % B; return (has(p1) || has(p2)) ? { key: 'TP', c, ord: c * 13, label: 'Two pair' } : null; }
    if (c === 3) { const t = Math.floor(x / (B * B)); return has(t) ? { key: 'T', c, ord: c * 13, label: 'Three of a kind' } : null; }
    if (board.length === 5 && evalHand(board) === v) return null;
    return { key: 'C' + c, c, ord: c * 13, label: CATN[c] };
  }
  const curCatOf = (hero, board) => { const d = describe(hero, board); return d.shared ? 0 : d.c; };
  // What beats you, named relative to your own hand.
  function relLabel(ov, hv) {
    const c = cat(ov), hc = cat(hv), x = ov % M, hx = hv % M;
    if (c > hc) return CATN[c];
    if (c === 1) return Math.floor(x / (B * B * B)) === Math.floor(hx / (B * B * B)) ? 'Same pair, better kicker' : 'Higher pair';
    if (c === 3) return Math.floor(x / (B * B)) === Math.floor(hx / (B * B)) ? 'Same three of a kind, better kicker' : 'Higher three of a kind';
    if (c === 2) return 'Better two pair';
    if (c === 0) return 'Higher card';
    return 'Higher ' + CATN[c].toLowerCase();
  }
  const catOrd = ov => cat(ov) * 100000 + Math.floor((ov % M) / M * 99999);

  // ----- starting hands: 169 classes ranked best → worst -----
  const ORDER = ('AA KK QQ AKs JJ AQs KQs AJs KJs TT AKo ATs QJs KTs QTs JTs 99 AQo A9s KQo 88 K9s T9s A8s Q9s J9s AJo A5s 77 A7s KJo A4s A3s A6s QJo 66 K8s T8s A2s 98s J8s ATo Q8s K7s KTo 55 JTo 87s QTo 44 22 33 K6s 97s K5s 76s T7s K4s K3s K2s Q7s 86s 65s J7s 54s Q6s 75s 96s Q5s 64s Q4s Q3s T9o T6s Q2s A9o 53s 85s J6s J9o K9o J5s Q9o 43s 74s J4s J3s 95s J2s 63s A8o 52s T5s 84s T4s T3s 42s T2s 98o T8o A5o A7o 73s A4o 32s 94s 93s J8o A3o 62s 92s K8o A6o 87o Q8o 83s A2o 82s 97o 72s 76o K7o 65o T7o K6o 86o 54o K5o J7o 75o Q7o K4o K3o 96o K2o 64o Q6o 53o 85o T6o Q5o 43o Q4o Q3o 74o Q2o J6o 63o J5o 95o 52o J4o J3o 42o J2o 84o T5o T4o 32o T3o 73o T2o 62o 94o 93o 92o 83o 82o 72o').split(' ');
  const PCT = {}; { let n = 0; for (const h of ORDER) { n += h.length === 2 ? 6 : h[2] === 's' ? 4 : 12; PCT[h] = n / 1326 * 100; } }
  function handLabel(c1, c2) { let a = rankOf(c1), b = rankOf(c2); if (a < b) [a, b] = [b, a]; return a === b ? RANKS[a] + RANKS[b] : RANKS[a] + RANKS[b] + (suitOf(c1) === suitOf(c2) ? 's' : 'o'); }

  // ----- ranges -----
  // Notation: "QQ+", "22-55", "AKs", "AQo+", "A5s-A2s", "KT+" (suited and offsuit), "AhKh", "top 15%", "random".
  // Styles map to a share of the best starting hands; a typed range always wins over a style.
  const STYLES = { random: 100, any: 100, nit: 8, rock: 8, tight: 15, tag: 18, 'tight-aggressive': 18, solid: 22, regular: 25, lag: 35, 'loose-aggressive': 35, loose: 40, fish: 55, 'calling station': 60, station: 60, maniac: 75 };
  function combosOfClass(label) {
    const r1 = RANKS.indexOf(label[0]), r2 = RANKS.indexOf(label[1]), kind = label[2] || '';
    const out = [];
    for (let s1 = 0; s1 < 4; s1++) for (let s2 = 0; s2 < 4; s2++) {
      if (r1 === r2) { if (s2 > s1) out.push([r1 * 4 + s1, r2 * 4 + s2]); continue; }
      if (kind === 's' && s1 !== s2) continue;
      if (kind === 'o' && s1 === s2) continue;
      out.push([r1 * 4 + s1, r2 * 4 + s2]);
    }
    return out;
  }
  const classLabel = (hi, lo, kind) => hi === lo ? RANKS[hi] + RANKS[hi] : RANKS[hi] + RANKS[lo] + kind;
  function topClasses(pct) { const out = []; for (const h of ORDER) { out.push(h); if (PCT[h] >= pct - 1e-9) break; } return out; }

  // → {combos: [[a,b],...] (no duplicates), pct: share of all 1326 hands, errors: [], label}
  function parseRange(text) {
    const src = String(text == null ? '' : text).trim();
    const errors = [], keys = new Set(), combos = [];
    const addCombo = (a, b) => { const k = a < b ? a * 52 + b : b * 52 + a; if (a !== b && !keys.has(k)) { keys.add(k); combos.push(a < b ? [a, b] : [b, a]); } };
    const addClass = l => combosOfClass(l).forEach(([a, b]) => addCombo(a, b));
    const addTop = pct => topClasses(Math.max(0.1, Math.min(100, pct))).forEach(addClass);
    const lower = src.toLowerCase();
    if (!src || lower in STYLES) { addTop(src ? STYLES[lower] : 100); }
    else {
      const toks = src.replace(/\btop\s+(\d+(?:\.\d+)?)\s*%/gi, 'top$1%').replace(/\b10(?![\d%.])/g, 'T').split(/[\s,;]+/).filter(Boolean);
      const R = '([2-9TJQKA])';
      for (const raw of toks) {
        const t = raw.replace(/^([2-9tjqka])([2-9tjqka])/i, (m, a, b) => a.toUpperCase() + b.toUpperCase());
        let m;
        if (/^(random|any|all|anytwo|any2)$/i.test(t)) { addTop(100); continue; }
        if ((m = t.match(/^(?:top)?(\d+(?:\.\d+)?)%$/i))) { addTop(+m[1]); continue; }
        if ((m = t.match(/^([2-9tjqka])([cdhs])([2-9tjqka])([cdhs])$/i))) { const a = cardFromCode(m[1] + m[2]), b = cardFromCode(m[3] + m[4]); if (a === b) errors.push(`${raw}: same card twice`); else addCombo(a, b); continue; }
        if ((m = t.match(new RegExp(`^${R}\\1(\\+)?$`)))) { const r = RANKS.indexOf(m[1]); for (let x = r; x <= (m[2] ? 12 : r); x++) addClass(classLabel(x, x)); continue; }
        if ((m = t.match(new RegExp(`^${R}\\1-${R}\\2$`)))) { let a = RANKS.indexOf(m[1]), b = RANKS.indexOf(m[2]); if (a > b) [a, b] = [b, a]; for (let x = a; x <= b; x++) addClass(classLabel(x, x)); continue; }
        if ((m = t.match(new RegExp(`^${R}${R}([so])?(\\+)?$`, 'i')))) {
          let hi = RANKS.indexOf(m[1]), lo = RANKS.indexOf(m[2]); if (hi === lo) { errors.push(`${raw}: not a hand`); continue; } if (hi < lo) [hi, lo] = [lo, hi];
          const kinds = m[3] ? [m[3].toLowerCase()] : ['s', 'o'];
          for (let k = lo; k <= (m[4] ? hi - 1 : lo); k++) kinds.forEach(kind => addClass(classLabel(hi, k, kind)));
          continue;
        }
        if ((m = t.match(new RegExp(`^${R}${R}([so])?-${R}${R}([so])?$`, 'i')))) {
          const hi = RANKS.indexOf(m[1]), a = RANKS.indexOf(m[2]), hi2 = RANKS.indexOf(m[4]), b = RANKS.indexOf(m[5]);
          if (hi !== hi2) { errors.push(`${raw}: both ends need the same top card`); continue; }
          const kinds = (m[3] || m[6]) ? [(m[3] || m[6]).toLowerCase()] : ['s', 'o'];
          for (let k = Math.min(a, b); k <= Math.max(a, b); k++) if (k !== hi) kinds.forEach(kind => addClass(classLabel(Math.max(hi, k), Math.min(hi, k), kind)));
          continue;
        }
        if (raw.toLowerCase() in STYLES) { addTop(STYLES[raw.toLowerCase()]); continue; }
        errors.push(`${raw}: not understood`);
      }
    }
    if (!combos.length && !errors.length) errors.push('range is empty');
    return { combos, pct: combos.length / 1326 * 100, errors, label: src || 'random' };
  }
  const rangeCache = new Map();
  function rangeOf(text) { const k = String(text || '').trim().toLowerCase(); if (!rangeCache.has(k)) { if (rangeCache.size > 200) rangeCache.clear(); rangeCache.set(k, parseRange(text)); } return rangeCache.get(k); }

  // An opponent's possible hands as [a, b, weight]: from weighted combos ({combos: [[a,b,w],...]}, a read) or a range
  // string (all weight 1). isDead(card) removes hands that use a card already out.
  function poolOf(o, isDead) {
    if (Array.isArray(o.combos)) return o.combos.filter(h => h[2] > 0 && !isDead(h[0]) && !isDead(h[1]));
    return rangeOf(o.range).combos.filter(([a, b]) => !isDead(a) && !isDead(b)).map(([a, b]) => [a, b, 1]);
  }

  // ----- equity -----
  // opts: {hero:[c,c], board:[...], opps:[{cards:[c,c]} | {range:"QQ+, AK"} | {combos:[[a,b,weight],...]}], trials, exact:true|false|'auto'}
  // Opponents with known cards are fixed; the rest are drawn from their range (card removal respected).
  // Exact enumeration runs when one opponent is left and at most one card is to come; otherwise Monte Carlo.
  function equity(opts) {
    const hero = opts.hero, board = opts.board || [], trials = opts.trials || 14000;
    const toCome = 5 - board.length, curCat = curCatOf(hero, board);
    const heroCur = board.length >= 3 ? evalHand(hero.concat(board)) : null;
    const dead = new Uint8Array(52); hero.concat(board).forEach(c => dead[c] = 1);
    const fixed = [], ranged = [], warnings = [];
    for (const o of opts.opps || []) {
      if (o.cards && o.cards.length === 2) { fixed.push(o.cards.slice()); o.cards.forEach(c => dead[c] = 1); }
      else ranged.push(o);
    }
    const pools = ranged.map(o => {
      let pool = poolOf(o, c => dead[c]);
      if (!pool.length) { warnings.push(`No hands left in ${o.combos ? 'that read' : `range "${rangeOf(o.range).label}"`} after removing known cards; treated as random.`); pool = poolOf({ range: '' }, c => dead[c]); }
      // cumulative weights for drawing a hand in proportion to its weight
      const cum = new Float64Array(pool.length); let t = 0; pool.forEach((h, i) => { t += h[2]; cum[i] = t; });
      pool.cum = cum; pool.total = t;
      return pool;
    });
    const drawFrom = pool => { const x = Math.random() * pool.total; let lo = 0, hi = pool.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (pool.cum[mid] > x) hi = mid; else lo = mid + 1; } return pool[lo]; };
    const nOpp = fixed.length + ranged.length;

    const paths = new Map(), nowG = new Map(), rivG = new Map();
    let score = 0, weight = 0, noneN = 0, noneW = 0, nowBeat = 0, rivBeat = 0;
    let wt0 = 1; // weight of the deal being recorded
    const bump = (m, k, ord) => { const g = m.get(k); if (g) g.n += wt0; else m.set(k, { label: k, n: wt0, ord }); };
    function record(oppHands, run, wt = 1) {
      const full = run.length ? board.concat(run) : board;
      const hv = evalHand(hero.concat(full)); let best = -1, ties = 0, bestNow = -1;
      for (const oc of oppHands) {
        const v = evalHand(oc.concat(full)); if (v > best) { best = v; ties = 1; } else if (v === best) ties++;
        if (heroCur !== null && toCome) { const vn = evalHand(oc.concat(board)); if (vn > bestNow) bestNow = vn; }
      }
      wt0 = wt;
      const w = hv > best ? 1 : hv === best ? 1 / (ties + 1) : 0; score += w * wt; weight += wt;
      if (heroCur !== null && toCome && bestNow > heroCur) { nowBeat += wt; bump(nowG, relLabel(bestNow, heroCur), catOrd(bestNow)); }
      if (hv < best) { rivBeat += wt; bump(rivG, relLabel(best, hv), catOrd(best)); }
      const p = toCome ? pathOf(hero, full, curCat) : null;
      if (p) { let g = paths.get(p.key); if (!g) { g = { ...p, river: 0, win: 0, flop: 0 }; paths.set(p.key, g); } g.river += wt; g.win += w * wt; } else { noneN += wt; noneW += w * wt; }
      if (board.length === 0) { const pf = pathOf(hero, run.slice(0, 3), curCat); if (pf) { let g = paths.get(pf.key); if (!g) { g = { ...pf, river: 0, win: 0, flop: 0 }; paths.set(pf.key, g); } g.flop += wt; } }
    }

    const exact = opts.exact !== false && nOpp <= 1 && toCome <= 1;
    if (exact) {
      const hands = nOpp === 0 ? [null] : fixed.length ? [fixed[0]] : pools[0];
      for (const h of hands) {
        const used = h ? [h[0], h[1]] : [], opp = h ? [[h[0], h[1]]] : [], wt = h && h.length > 2 ? h[2] : 1;
        if (!toCome) { record(opp, [], wt); continue; }
        for (let c = 0; c < 52; c++) if (!dead[c] && !used.includes(c)) record(opp, [c], wt);
      }
    } else {
      const flags = new Uint8Array(52), avail = new Array(52);
      for (let t = 0; t < trials; t++) {
        flags.set(dead);
        const hands = fixed.slice();
        for (let i = 0; i < pools.length; i++) {
          const pool = pools[i]; let pick = null;
          for (let tries = 0; tries < 40 && !pick; tries++) { const h = drawFrom(pool); if (!flags[h[0]] && !flags[h[1]]) pick = [h[0], h[1]]; }
          if (!pick) { const left = pool.filter(([a, b]) => !flags[a] && !flags[b]); pick = left.length ? left[rnd(left.length)].slice(0, 2) : null; }
          if (!pick) { const free = []; for (let c = 0; c < 52; c++) if (!flags[c]) free.push(c); shuffle(free); pick = [free[0], free[1]]; }
          flags[pick[0]] = flags[pick[1]] = 1; hands.push(pick);
        }
        let n = 0; for (let c = 0; c < 52; c++) if (!flags[c]) avail[n++] = c;
        const run = [];
        for (let k = 0; k < toCome; k++) { const j = k + rnd(n - k); const x = avail[j]; avail[j] = avail[k]; avail[k] = x; run.push(x); }
        record(hands, run);
      }
    }
    if (heroCur !== null && !toCome) { nowBeat = rivBeat; rivG.forEach((g, k) => nowG.set(k, g)); }
    const list = [...paths.values()].sort((a, b) => b.ord - a.ord);
    return { chance: score / weight * 100, list, trials: weight, noneN, noneW, nowBeat: nowBeat / weight * 100, rivBeat: rivBeat / weight * 100, nowG, rivG, exact, opponents: nOpp, warnings };
  }

  // Exact list of two-card hands that beat you right now, grouped, with the chance at least one live opponent holds each.
  function threatsNow(hero, board, opps) {
    const used = new Set(hero.concat(board)); const avail = DECK.filter(c => !used.has(c)); const hv = evalHand(hero.concat(board));
    const g = new Map(); let total = 0;
    const beats = new Map(); // combo key → group label
    for (let i = 0; i < avail.length; i++) for (let j = i + 1; j < avail.length; j++) {
      total++; const a = avail[i], b = avail[j], v = evalHand([a, b].concat(board));
      if (v > hv) { const k = relLabel(v, hv); if (!g.has(k)) g.set(k, { combos: [], ord: catOrd(v), label: k }); g.get(k).combos.push([a, b]); beats.set(a * 52 + b, k); }
    }
    // Per opponent: share of their possible hands that beats you, overall and per group.
    const shares = (opps || []).map(o => {
      if (o.cards && o.cards.length === 2) { const [a, b] = o.cards[0] < o.cards[1] ? o.cards : [o.cards[1], o.cards[0]]; const k = beats.get(a * 52 + b); return { total: 1, by: k ? { [k]: 1 } : {}, beat: k ? 1 : 0 }; }
      const pool = poolOf(o, c => used.has(c));
      const by = {}; let beat = 0, total = 0;
      for (const [a, b, w] of pool) { total += w; const k = beats.get(a < b ? a * 52 + b : b * 52 + a); if (k) { by[k] = (by[k] || 0) + w; beat += w; } }
      return { total: total || 1, by, beat };
    });
    const any = fracs => (1 - fracs.reduce((p, f) => p * (1 - f), 1)) * 100;
    g.forEach((x, k) => { x.desc = describeCombos(x.combos); x.pNow = any(shares.map(s => (s.by[k] || 0) / s.total)); x.inRange = shares.some(s => s.by[k]); });
    return { groups: g, total, beat: [...g.values()].reduce((n, x) => n + x.combos.length, 0), pAny: any(shares.map(s => s.beat / s.total)) };
  }
  function describeCombos(combos) {
    const bySuit = combos.every(([a, b]) => suitOf(a) === suitOf(b)); const suits = new Set(combos.map(([a]) => suitOf(a)));
    if (bySuit && suits.size === 1 && combos.length >= 6) return `any two ${SYM[[...suits][0]]}`;
    const partners = {}; combos.forEach(([a, b]) => { const r1 = rankOf(a), r2 = rankOf(b); (partners[r1] = partners[r1] || new Set()).add(r2); (partners[r2] = partners[r2] || new Set()).add(r1); });
    const anyR = Object.keys(partners).filter(r => partners[r].size >= 9).map(Number);
    const labels = new Set(); combos.forEach(([a, b]) => { let r1 = rankOf(a), r2 = rankOf(b); if (r1 < r2) [r1, r2] = [r2, r1]; if (anyR.includes(r1) || anyR.includes(r2)) return; labels.add(RANKS[r1] + RANKS[r2] + (suitOf(a) === suitOf(b) ? 's' : '')); });
    const out = anyR.sort((a, b) => b - a).map(r => `${RANKS[r]} + any`).concat([...labels].sort((a, b) => b.localeCompare(a)));
    return out.length > 5 ? out.slice(0, 5).join(', ') + ` +${out.length - 5}` : out.join(', ');
  }
  function nextCardGroups(hero, board) {
    const used = new Set(hero.concat(board)); const avail = DECK.filter(c => !used.has(c)); const curCat = curCatOf(hero, board);
    const g = new Map(); for (const c of avail) { const p = pathOf(hero, board.concat(c), curCat); if (p) { if (!g.has(p.key)) g.set(p.key, []); g.get(p.key).push(c); } }
    return { groups: g, avail: avail.length };
  }
  // Win chance against n random hands (used for the "by number of opponents" strip).
  function winChanceQuick(hero, board, n, trials) { return equity({ hero, board, opps: Array.from({ length: n }, () => ({ range: '' })), trials, exact: false }).chance; }

  // Cards forming the made hand, for the table glow.
  function handCards(hero, board) {
    const all = hero.concat(board); if (all.length < 5) return new Set();
    let best = -1, bestSet = null;
    for (let a = 0; a < all.length; a++) for (let b = a + 1; b < all.length; b++) for (let c = b + 1; c < all.length; c++) for (let d = c + 1; d < all.length; d++) for (let e = d + 1; e < all.length; e++) {
      const five = [all[a], all[b], all[c], all[d], all[e]]; const v = evalHand(five); if (v > best) { best = v; bestSet = five; } }
    const cat5 = cat(best); const out = new Set();
    if (cat5 === 0) return out;
    if (cat5 >= 4 && cat5 !== 7) { bestSet.forEach(c => out.add(c)); return out; }
    const cnt = new Array(13).fill(0); bestSet.forEach(c => cnt[rankOf(c)]++);
    bestSet.forEach(c => { if (cnt[rankOf(c)] >= 2) out.add(c); });
    return out;
  }


  // ----- "what you should do": rule-of-thumb advice, not a solver -----
  // Board texture: how many draws the board allows (decides bet sizing).
  function texture(board) {
    if (board.length < 3) return { wet: false, words: '' };
    const suits = [0, 0, 0, 0]; board.forEach(c => suits[suitOf(c)]++);
    const maxSuit = Math.max(...suits), ranks = [...new Set(board.map(rankOf))].sort((a, b) => a - b);
    const paired = ranks.length < board.length;
    let connected = false; for (let i = 0; i + 2 < ranks.length; i++) if (ranks[i + 2] - ranks[i] <= 4) connected = true;
    const words = [maxSuit >= 3 ? `${maxSuit} of one suit` : maxSuit === 2 && board.length < 5 ? 'a flush draw possible' : '', connected ? 'connected cards' : '', paired ? 'a pair on board' : ''].filter(Boolean);
    return { wet: maxSuit >= 3 || (maxSuit === 2 && board.length < 5) || connected, paired, words: words.join(', ') };
  }
  // Cards that would give you a straight or flush next (your draw), with a label.
  function drawOuts(hero, board) {
    if (board.length < 3 || board.length >= 5) return { outs: 0, label: '' };
    const g = nextCardGroups(hero, board); let outs = 0; const kinds = [];
    g.groups.forEach((cards, key) => { if (key === 'C4' || key === 'C5' || key === 'C8') { outs += cards.length; kinds.push(key === 'C5' ? 'flush' : key === 'C4' ? 'straight' : 'straight flush'); } });
    return { outs, label: kinds.length ? `${kinds.join(' and ')} draw` : '' };
  }
  // Share of hands a player in this preflop slot usually opens (by how many players act after them).
  function openPct(behind, players) {
    if (players === 2) return 80;
    return [100, 40, 43, 29, 23, 18, 16, 14, 13][Math.min(Math.max(behind, 0), 8)];
  }
  const roundChips = (x, bb) => { const step = bb >= 2 ? 1 : 0.5; return Math.max(bb, Math.round(x / step) * step); };
  const clamp01 = x => Math.max(0, Math.min(1, x));

  // ctx: {street, hero:[c,c], board, eq (equity result), live (opponents in), players, position, behind (preflop),
  //   inPosition, toCall, pot (before your call), bb, aggressor: 'none'|'hero'|'opp', bet (current street bet),
  //   raiserPct, raiserLabel, callers, station, rangesSet}
  // → {action: fold|check|call|bet|raise|wait, label, size, gauge 0-100, close, reasons[], note}
  function recommend(ctx) {
    const { street, hero, board, eq, live, bb } = ctx;
    const win = eq.chance, need = ctx.toCall > 0 ? ctx.toCall / (ctx.pot + ctx.toCall) * 100 : 0;
    const reasons = [], fmt = x => (x > 0 && x < 0.95 ? 'under 1' : Math.round(x * 10) / 10);
    const F = ctx.fmt || (x => String(Math.round(x * 100) / 100)); // chip amounts
    const out = (action, t, opts = {}) => {
      const zone = action === 'fold' ? 0 : action === 'check' || action === 'call' ? 1 : action === 'wait' ? 1 : 2;
      const label = { fold: 'Fold', check: 'Check', call: 'Call', bet: 'Bet', raise: 'Raise', wait: 'Your bet stands' }[action];
      return { action, label, size: opts.size || null, sizeText: opts.sizeText || '', gauge: Math.round((zone + clamp01(t)) / 3 * 100), close: !!opts.close, reasons, note: street === 0 ? '' : ctx.note !== undefined ? ctx.note : ctx.rangesSet ? '' : 'Opponents are treated as random hands. Give them a range or style for sharper advice.' };
    };
    if (!live) { reasons.push('Everyone else has folded: the pot is yours.'); return out('wait', 1); }

    // ---------- preflop: standard charts (strategy.js), worked out by the scenario and passed in as ctx.pre ----------
    if (street === 0) {
      const p = ctx.pre;
      if (!p) { reasons.push('Preflop advice needs the table\'s betting.'); return out('wait', 0.5); }
      p.reasons.forEach(r => reasons.push(r));
      let action = p.action;
      if (action === 'call' && !(ctx.toCall > 0)) action = 'check';
      const o = { close: !!p.close };
      if (action === 'raise' && p.to) { o.size = p.to; o.sizeText = `to ${F(p.to)}`; }
      return out(action, p.t, o);
    }

    // ---------- flop, turn, river: your chances against what it costs ----------
    const tex = texture(board), draw = drawOuts(hero, board), river = street === 3, made = describe(hero, board);
    const pos = ctx.inPosition ? 'in position' : 'out of position';
    reasons.push(`You win ${fmt(win)}% ${live > 1 ? `against ${live} opponents` : 'against your opponent'}${ctx.rangesSet ? ' (given their likely hands)' : ''}.`);
    if (ctx.aggressor === 'hero') { reasons.push(`You bet ${F(ctx.bet)}; the stats assume they call.`); return out('wait', clamp01(win / 100)); }
    if (ctx.toCall > 0) {
      // Equity you actually get to use: out of position you often can't see the next card or get paid when you hit.
      const realize = river || ctx.inPosition ? 1 : street === 1 ? 0.8 : 0.9, eff = win * realize;
      reasons.push(`Calling ${F(ctx.toCall)} into ${F(ctx.pot)} needs ${fmt(need)}% to break even.`);
      if (realize < 1) reasons.push(`Out of position you won't realize all of it: it plays more like ${fmt(eff)}%.`);
      if (eff >= need) {
        const raiseAt = Math.max(70, need + 35);
        if (win >= raiseAt) {
          const to = roundChips(ctx.bet * (river ? 2.5 : 3) + ctx.pot * 0.2, bb);
          reasons.push(`You're well ahead (${fmt(win)}% vs ${fmt(need)}% needed): raise for value${tex.wet && !river ? ' and charge the draws' : ''}.`);
          return out('raise', clamp01((win - raiseAt) / 30 + 0.3), { size: to, sizeText: `to ${F(to)}` });
        }
        if (eff < need + 5) reasons.push('Only just profitable: a close call.');
        else if (!river && draw.outs >= 8) reasons.push(`Your ${draw.label} (${draw.outs} cards) adds to your chances.`);
        return out('call', clamp01((eff - need) / Math.max(raiseAt - need, 1)), { close: eff < need + 5 });
      }
      if (!river && draw.outs >= 8 && live <= 2 && eff >= need * 0.85) {
        reasons.push(`Just short of the price, but your ${draw.label} (${draw.outs} cards) can win a bigger pot later when it hits (implied odds).`);
        return out('call', 0.1, { close: true });
      }
      reasons.push(river ? 'Nothing more can come: the price is too high.' : `Not enough to call${draw.outs ? ` even counting your ${draw.label}` : ''}.`);
      return out('fold', clamp01(eff / need), { close: eff >= need * 0.85 });
    }
    // checked to you (or you act first)
    let valueAt = live === 1 ? (river ? 60 : 56) : Math.max(30, 100 / (live + 1) * 1.5);
    if (ctx.station) { valueAt -= 6; reasons.push('A calling station is in the hand: bet thinner for value, and don\'t bluff.'); }
    const frac = river && win >= 85 ? 0.8 : tex.wet ? 0.7 : 0.5;
    const size = roundChips(ctx.pot * (frac + (live > 1 ? 0.1 : 0)), bb), pctPot = Math.round(size / ctx.pot * 100);
    if (win >= valueAt) {
      reasons.push(`${cap(made.text.replace(/<[^>]+>/g, ''))} is ahead often enough to bet for value (${fmt(win)}% vs about ${Math.round(valueAt)}% needed).`);
      if (tex.wet && !river) reasons.push(`The board has ${tex.words}: bet bigger to make draws pay.`);
      return out('bet', clamp01((win - valueAt) / 30 + 0.3), { size, sizeText: `${F(size)} (about ${pctPot}% of the pot)` });
    }
    if (!river && draw.outs >= 8 && live <= 2 && !ctx.station) {
      reasons.push(`Your ${draw.label} (${draw.outs} cards) makes a good semi-bluff ${pos}: you can win now, or improve.`);
      const sb = roundChips(ctx.pot * 0.6, bb);
      return out('bet', 0.15, { size: sb, sizeText: `${F(sb)} (about 60% of the pot)`, close: true });
    }
    reasons.push(`Not strong enough to bet${live > 1 ? ` into ${live} players` : ''}; check and see what they do${ctx.inPosition ? '' : ''}.`);
    return out('check', clamp01(win / valueAt));
  }

  return {
    RANKS, SUITS, SYM, RN, RP, SN, CATN, DECK, ORDER, PCT, STYLES, B, M,
    rankOf, suitOf, rnd, shuffle, cap, cardFromCode, codeOf, cardText,
    evalHand, cat, describe, preflopShort, pathOf, curCatOf, relLabel, catOrd, handLabel,
    combosOfClass, parseRange, rangeOf, poolOf, equity, threatsNow, describeCombos, nextCardGroups, winChanceQuick, handCards,
    texture, drawOuts, openPct, recommend,
  };
});
