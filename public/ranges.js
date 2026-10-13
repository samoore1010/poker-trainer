// Hand reading after the flop: how each kind of holding tends to act (check, bet small or big, call, raise, fold)
// on a given board, adjusted by playing style. Two uses, one model:
//  - your read on an opponent: start from their preflop range, then weight every possible holding by how likely it is
//    to have taken the actions you saw (Bayes). Built only from what you can see, never from their hidden cards.
//  - the computer players: they act with their actual cards using the same frequencies, so the read matches how they play.
// Frequencies are heuristics in the spirit of modern ranges (polarized big bets, condensed calls, capped checks), not solver output.
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('./engine.js') : root.PokerEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PokerRanges = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

  // ----- what a holding is on a board -----
  // key: S strong (two pair+, sets, straights, flushes) · G good (overpair, top pair good kicker) · M medium (top pair
  // weak kicker, middle pair, pocket pair below top) · W weak (bottom pair, small pairs, ace high) · A nothing ·
  // D2 strong draw (flush or open-ended, 8+ outs) · D1 gutshot. name/ord are for display, best first.
  const NAMES = {
    sf: ['Straight flush', 1], quads: ['Four of a kind', 2], fh: ['Full house', 3], flush: ['Flush', 4], straight: ['Straight', 5],
    set: ['Set', 6], trips: ['Trips', 7], two: ['Two pair', 8], over: ['Overpair', 9], tpg: ['Top pair, good kicker', 10], tpw: ['Top pair, weak kicker', 11],
    combo: ['Flush + straight draw', 12], fd: ['Flush draw', 13], oesd: ['Open-ended straight draw', 14],
    mid: ['Middle pair', 15], under: ['Pocket pair below the top card', 16], bottom: ['Bottom pair', 17], small: ['Small pocket pair', 18],
    gut: ['Gutshot', 19], ace: ['Ace high', 20], air: ['Nothing', 21],
  };
  const straightIn = bits => { const ext = ((bits << 1) | ((bits >> 12) & 1)) & 0x3fff; for (let i = 0; i <= 9; i++) if (((ext >> i) & 31) === 31) return true; return false; };
  function classify(hole, board) {
    const all = hole.concat(board), v = E.evalHand(all), c = E.cat(v);
    const hr = hole.map(E.rankOf).sort((a, b) => b - a), br = board.map(E.rankOf);
    const cnt = new Array(13).fill(0); br.forEach(r => cnt[r]++);
    const desc = [...new Set(br)].sort((a, b) => b - a), top = desc[0], second = desc.length > 1 ? desc[1] : -1;
    const pocket = hr[0] === hr[1], shared = board.length >= 5 && E.evalHand(board) === v;
    let made = null;
    if (!shared && c >= 4) made = c === 8 ? 'sf' : c === 7 ? 'quads' : c === 6 ? 'fh' : c === 5 ? 'flush' : 'straight';
    else if (pocket && cnt[hr[0]] >= 1) made = 'set';
    else if (!pocket && cnt[hr[0]] >= 1 && cnt[hr[1]] >= 1) made = 'two';
    else if (!pocket && (cnt[hr[0]] === 2 || cnt[hr[1]] === 2)) made = 'trips';
    else if (pocket) made = hr[0] > top ? 'over' : hr[0] > second ? 'under' : 'small';
    else if (cnt[hr[0]] === 1 || cnt[hr[1]] === 1) {
      const r = cnt[hr[0]] === 1 ? hr[0] : hr[1], k = r === hr[0] ? hr[1] : hr[0];
      made = r === top ? (k >= 9 ? 'tpg' : 'tpw') : r === second ? 'mid' : 'bottom';
    }
    let draw = null;
    if (board.length >= 3 && board.length <= 4 && (!made || !['sf', 'quads', 'fh', 'flush', 'straight', 'set', 'trips', 'two'].includes(made))) {
      const suits = [0, 0, 0, 0]; all.forEach(x => suits[E.suitOf(x)]++);
      const fd = suits.some((n, s) => n === 4 && hole.some(x => E.suitOf(x) === s));
      let bits = 0, bb = 0; all.forEach(x => { bits |= 1 << E.rankOf(x); }); board.forEach(x => { bb |= 1 << E.rankOf(x); });
      let outs = 0; for (let r = 0; r < 13; r++) if (!(bits >> r & 1) && straightIn(bits | 1 << r) && !straightIn(bb | 1 << r)) outs++;
      draw = fd && outs ? 'combo' : fd ? 'fd' : outs >= 2 ? 'oesd' : outs === 1 ? 'gut' : null;
    }
    const tier = { sf: 'S', quads: 'S', fh: 'S', flush: 'S', straight: 'S', set: 'S', trips: 'S', two: 'S', over: 'G', tpg: 'G', tpw: 'M', mid: 'M', under: 'M', bottom: 'W', small: 'W' }[made] || (hr[0] === 12 ? 'W' : 'A');
    const strongDraw = draw === 'combo' || draw === 'fd' || draw === 'oesd';
    let key = tier;
    if (strongDraw && (tier === 'M' || tier === 'W' || tier === 'A')) key = 'D2';
    else if (draw === 'gut' && (tier === 'W' || tier === 'A')) key = 'D1';
    // display group: the made hand, a draw, or both ("Middle pair + flush draw")
    const madeName = made || (hr[0] === 12 ? 'ace' : 'air');
    let group = madeName;
    if (draw && (key === 'D2' || key === 'D1')) group = made ? madeName + '+' + draw : draw;
    return { key, made: madeName, draw, group };
  }
  function groupName(g) { const [a, b] = g.split('+'); return b ? `${NAMES[a][0]} + ${NAMES[b][0].toLowerCase()}` : NAMES[a][0]; }
  function groupOrd(g) { const [a, b] = g.split('+'); return b ? Math.min(NAMES[a][1], NAMES[b][1]) - 0.5 : NAMES[a][1]; }

  // ----- how each kind of holding acts -----
  // Not facing a bet: [how often it bets, share of those bets that are big]. Facing a bet: [raise, call] (the rest fold).
  const OPEN = { S: [0.75, 0.55], G: [0.7, 0.35], D2: [0.55, 0.45], M: [0.4, 0.15], D1: [0.3, 0.3], W: [0.2, 0.2], A: [0.25, 0.45] };
  const FACE = { S: [0.5, 0.48], G: [0.12, 0.83], D2: [0.25, 0.65], M: [0.03, 0.72], D1: [0.07, 0.4], W: [0.02, 0.3], A: [0.08, 0.03] };
  // Style: aggro scales betting/raising with value hands, bluff with weak hands and draws, call the calling of non-value hands.
  const MODS = {
    regular: { aggro: 1, bluff: 1, call: 1, text: '' },
    nit: { aggro: 0.9, bluff: 0.45, call: 0.65, text: 'A nit: bets and calls with strong hands, rarely bluffs.' },
    tight: { aggro: 0.95, bluff: 0.7, call: 0.8, text: 'Tight: fewer bluffs and fewer loose calls.' },
    lag: { aggro: 1.3, bluff: 1.7, call: 1.05, text: 'Loose-aggressive: bets and raises a lot, with plenty of bluffs.' },
    loose: { aggro: 1.1, bluff: 1.3, call: 1.35, text: 'Loose: plays and calls wider than a solid player.' },
    fish: { aggro: 0.6, bluff: 0.7, call: 1.9, text: 'A fish: calls far too much, rarely raises.' },
    station: { aggro: 0.5, bluff: 0.5, call: 2.3, text: 'A calling station: calls with almost any piece, rarely raises or bluffs.' },
    maniac: { aggro: 1.6, bluff: 2.4, call: 1.3, text: 'A maniac: bets and raises constantly, many bluffs.' },
  };
  function modsFor(style) {
    const s = String(style || '').toLowerCase();
    if (/nit|rock/.test(s)) return MODS.nit;
    if (/maniac/.test(s)) return MODS.maniac;
    if (/station/.test(s)) return MODS.station;
    if (/fish/.test(s)) return MODS.fish;
    if (/lag|loose-aggressive/.test(s)) return MODS.lag;
    if (/loose/.test(s)) return MODS.loose;
    if (/tight|tag/.test(s)) return MODS.tight;
    return MODS.regular;
  }
  // sit: {facing, price (call ÷ pot after calling), river, cbet (preflop raiser, first in on the flop), mods}
  // → not facing: {check, small, big}; facing: {fold, call, raise}
  function freqs(key, sit) {
    const m = sit.mods || MODS.regular, value = key === 'S' || key === 'G';
    if (!sit.facing) {
      let [b, big] = OPEN[key];
      if (sit.river && key === 'A') { b = 0.3; big = 0.6; } // missed draws turn into big river bluffs
      if (sit.river && key === 'D1') b = 0.2;
      if (sit.cbet && !value) b *= 1.5; // the preflop raiser continuation-bets wide
      b = clamp(b * (value || key === 'M' ? m.aggro : m.bluff), 0.02, 0.95);
      return { check: 1 - b, small: b * (1 - big), big: b * big };
    }
    let [r, c] = FACE[key];
    if (sit.river && (key === 'D2' || key === 'D1')) { r = 0.06; c = 0.05; }
    if (sit.river && key === 'A') { r = 0.06; c = 0.02; }
    if (!value) c *= clamp(1.4 - (sit.price || 0.25) * 2, 0.5, 1.2) * m.call; // bigger bets get fewer calls from middling hands
    r = clamp(r * (value || key === 'D2' ? m.aggro : m.bluff), 0, 0.9);
    c = clamp(c, 0, 0.97 - r);
    return { fold: 1 - r - c, call: c, raise: r };
  }
  // What an action says, in words (for the read's steps).
  const SAYS = {
    check: 'strong hands get less likely (they usually bet them); medium and weak hands stay',
    small: 'a wide range: value hands, draws and some bluffs',
    big: 'polarized: mostly strong hands and draws plus some bluffs; fewer medium hands',
    call: 'mostly pairs and draws; the biggest hands get less likely (they\'d raise) and little air is left',
    raise: 'strong hands and strong draws, with a few bluffs',
  };

  return { classify, freqs, modsFor, MODS, NAMES, SAYS, groupName, groupOrd };
});
