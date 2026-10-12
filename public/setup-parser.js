// Understands spoken or typed setup phrases on the device, instantly — no network:
//   "ace king suited on the button, six handed, flop queen seven deuce rainbow, turn the nine of hearts"
//   "pocket nines", "AhKd", "Qs 7h 2c", "heads up", "I'm in the big blind", "river four of spades"
// parse() → what was said (ranks may lack suits); resolve() picks free suits and returns scenario edits.
// Words it doesn't understand are returned so the caller can hand the request to the coach.
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('./engine.js') : root.PokerEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.SetupParser = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  const RANK = { ace: 12, king: 11, queen: 10, jack: 9, ten: 8, nine: 7, eight: 6, seven: 5, six: 4, five: 3, four: 2, three: 1, trey: 1, two: 0, deuce: 0 };
  const PLURAL = { aces: 12, kings: 11, queens: 10, jacks: 9, tens: 8, nines: 7, eights: 6, sevens: 5, sixes: 4, fives: 3, fours: 2, threes: 1, treys: 1, twos: 0, deuces: 0, ducks: 0, rockets: 12, cowboys: 11, ladies: 10, hooks: 9 };
  const RANK_CHAR = { a: 12, k: 11, q: 10, j: 9, t: 8, 10: 8, 9: 7, 8: 6, 7: 5, 6: 4, 5: 3, 4: 2, 3: 1, 2: 0 };
  // Speech-recognition slips: only treated as ranks when a suit follows.
  const SOUNDS = { for: 2, fore: 2, to: 0, too: 0, ate: 6, tree: 1, free: 1 };
  const SUIT = { club: 0, clubs: 0, clover: 0, clovers: 0, diamond: 1, diamonds: 1, heart: 2, hearts: 2, harts: 2, spade: 3, spades: 3, spayed: 3 };
  const SUIT_CHAR = { c: 0, d: 1, h: 2, s: 3 };
  const NUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const POSITION = { btn: 'BTN', button: 'BTN', dealer: 'BTN', co: 'CO', cutoff: 'CO', hj: 'HJ', hijack: 'HJ', lj: 'LJ', lojack: 'LJ', utg: 'UTG', utg1: 'UTG+1', utg2: 'UTG+2', sb: 'SB', bb: 'BB' };
  const SECTION = { hand: 'hero', hole: 'hero', holding: 'hero', have: 'hero', dealt: 'hero', flop: 'flop', flopped: 'flop', board: 'flop', turn: 'turn', river: 'river' };
  // Filler that never needs the coach.
  const FILLER = new Set('i im am a an the and of my me on in at is its it with got get gets give set put please ok okay so um uh like lets let us we then now comes come coming falls fall falling hits hit card cards hand hole holding hold dealt play playing seat sit sitting position table spot from pocket pair suits suit be are was there here this that what new start just also plus all as said say think guess maybe pot hm hmm well right alright yeah yes now'.split(' '));

  // Multi-word phrases → single tokens, before splitting.
  const PHRASES = [
    [/\bunder the gun plus (one|1)\b/g, 'utg1'], [/\bunder the gun plus (two|2)\b/g, 'utg2'], [/\butg ?\+ ?1\b|\butg plus (one|1)\b/g, 'utg1'], [/\butg ?\+ ?2\b|\butg plus (two|2)\b/g, 'utg2'],
    [/\bunder the gun\b/g, 'utg'], [/\bsmall blind\b/g, 'sb'], [/\bbig blind\b/g, 'bb'], [/\bcut ?off\b/g, 'cutoff'], [/\bhi ?jack\b/g, 'hijack'], [/\blo ?jack\b/g, 'lojack'],
    [/\bheads ?up\b/g, 'headsup'], [/\bfull ring\b/g, 'fullring'], [/\boff ?suit(ed)?\b/g, 'offsuit'], [/\btwo ?tone\b/g, 'twotone'], [/\brainbow\b/g, 'rainbow'],
    [/\bmono ?tone\b/g, 'monotone'], [/\b(\d|one|two|three|four|five|six|seven|eight|nine|ten) ?max\b/g, '$1 handed'], [/\bpocket rockets\b/g, 'aces'], [/\bon the button\b/g, 'button'],
  ];

  function tokenize(text) {
    let t = ' ' + String(text || '').toLowerCase().replace(/['’]/g, '') + ' ';
    for (const [re, rep] of PHRASES) t = t.replace(re, rep);
    return t.replace(/[^a-z0-9+]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  }
  const SHORT = /^(?:(?:10|[2-9akqjt])[cdhs])+$/;
  const num = w => (w in NUM ? NUM[w] : /^\d+$/.test(w) ? +w : null);

  // → {groups: {hero, flop, turn, river: [{rank, suit|null}]}, mods: {section: Set}, position, opponents, unknown[], heard[]}
  function parse(text) {
    const toks = tokenize(text);
    const groups = { hero: [], flop: [], turn: [], river: [] }, mods = { hero: new Set(), flop: new Set(), turn: new Set(), river: new Set() };
    const order = [], unknown = [], heard = [];
    let section = null, position = null, opponents = null, held = [];
    const target = () => {
      if (section) return section;
      // no street named yet: fill your hand, then flop, turn, river in order
      if (groups.hero.length < 2) return 'hero';
      if (groups.flop.length < 3) return 'flop';
      if (!groups.turn.length) return 'turn';
      return 'river';
    };
    const push = card => { const g = target(); groups[g].push(card); if (!order.includes(g)) order.push(g); };
    const flushHeld = () => { held.forEach(r => push({ rank: r, suit: null })); held = []; };
    for (let i = 0; i < toks.length; i++) {
      const w = toks[i], nx = toks[i + 1], nn = num(w);
      // table size: "six handed", "6 players", "4 opponents", "heads up", "full ring"
      if (w === 'headsup') { opponents = 1; heard.push('heads-up'); continue; }
      if (w === 'fullring') { opponents = 8; heard.push('full ring'); continue; }
      if (nn !== null && /^(handed|players|player|way|people|seats)$/.test(nx || '')) { opponents = Math.max(1, Math.min(8, nn - 1)); heard.push(`${nn} players`); i++; continue; }
      if (nn !== null && /^(opponents|opponent|others|villains)$/.test(nx || '')) { opponents = Math.max(1, Math.min(8, nn)); heard.push(`${nn} opponents`); i++; continue; }
      if (w in POSITION && !(w === 'bb' && /^\d/.test(nx || ''))) { flushHeld(); position = POSITION[w]; heard.push(position); continue; }
      if (w in SECTION) { flushHeld(); if (SECTION[w] !== 'hero' || !groups.hero.length) section = SECTION[w]; continue; }
      if (w === 'suited' || w === 'offsuit' || w === 'rainbow' || w === 'monotone' || w === 'twotone') { flushHeld(); mods[order[order.length - 1] || target()].add(w); continue; }
      // shorthand: Ah, 10h, AhKd, QsTd2c ("as" counts only next to other card codes or after a street word)
      if (SHORT.test(w) && (w !== 'as' || SHORT.test(nx || '') || SHORT.test(toks[i - 1] || '') || (toks[i - 1] in SECTION))) {
        flushHeld();
        for (const m of w.matchAll(/(10|[2-9akqjt])([cdhs])/g)) push({ rank: RANK_CHAR[m[1]], suit: SUIT_CHAR[m[2]] });
        continue;
      }
      // "aces", "pocket nines", "pair of sixes": a pair
      if (w in PLURAL && !(nx in SUIT) && !(toks[i + 2] in SUIT && nx === 'of')) { flushHeld(); push({ rank: PLURAL[w], suit: null }); push({ rank: PLURAL[w], suit: null }); continue; }
      // ranks, with or without a suit: "queen of hearts", "queen", "Q", "7"
      const r = w in RANK ? RANK[w] : /^(10|[2-9]|[akqjt])$/.test(w) && w !== 'a' ? RANK_CHAR[w] : w in SOUNDS ? SOUNDS[w] : w === 'a' ? 12 : null;
      if (r !== null) {
        let j = i + 1; if (toks[j] === 'of' || toks[j] === 'a') j++;
        const su = toks[j] in SUIT ? SUIT[toks[j]] : null;
        if (su !== null) { held.forEach(x => push({ rank: x, suit: su })); held = []; push({ rank: r, suit: su }); i = j; continue; }
        if (w in SOUNDS || w === 'a') { if (!FILLER.has(w) && w !== 'a') unknown.push(w); continue; } // "to", "for", "a" without a suit are just words
        held.push(r); continue;
      }
      // "all hearts", "three hearts": a monotone flop in that suit
      if (w in SUIT) { const g = order[order.length - 1] || target(); mods[g].add('suit:' + SUIT[w]); flushHeld(); continue; }
      if (FILLER.has(w) || nn !== null) continue;
      unknown.push(w);
    }
    flushHeld();
    return { groups, mods, position, opponents, unknown, heard };
  }

  // Picks suits for ranks said without one, avoiding cards in use. memo keeps the same picks while a sentence grows.
  // ctx: {used: Set of card ints (cards staying on the table), runout: [5 ints] (board as currently dealt), fixedBoard: n, memo: {}}
  // → {hero:[codes]|null, board:[codes]|null, position, opponents, errors[], said[]}
  function resolve(p, ctx) {
    const used = new Set(ctx.used || []), memo = ctx.memo || {}, errors = [], said = [];
    const rnd = n => Math.floor(Math.random() * n);
    const take = c => { used.add(c); return c; };
    const fill = (name, cards, need) => {
      if (!cards.length) return null;
      const m = p.mods[name], same = m.has('suited') || m.has('monotone') || [...m].some(x => x.startsWith('suit:'));
      const fixedSuit = [...m].find(x => x.startsWith('suit:'));
      // explicit cards first
      const out = cards.map(c => (c.suit !== null ? E.cardFromCode('23456789TJQKA'[c.rank] + 'cdhs'[c.suit]) : null));
      out.forEach(c => { if (c !== null) { if (used.has(c)) errors.push(`${E.cardText(c)} is already in use`); used.add(c); } });
      const key = i => `${name}:${i}:${cards[i].rank}:${[...m].sort().join(',')}`;
      let shared = fixedSuit ? +fixedSuit.slice(5) : null;
      if (same && shared === null) {
        const ok = [0, 1, 2, 3].filter(s => cards.every((c, i) => out[i] !== null || !used.has(c.rank * 4 + s)));
        shared = memo[name + ':suit'] !== undefined && ok.includes(memo[name + ':suit']) ? memo[name + ':suit'] : ok[rnd(ok.length)];
        memo[name + ':suit'] = shared;
      }
      const usedSuits = new Set(out.filter(c => c !== null).map(c => c & 3));
      cards.forEach((c, i) => {
        if (out[i] !== null) return;
        const prev = memo[key(i)];
        if (prev !== undefined && !used.has(prev)) { out[i] = take(prev); usedSuits.add(prev & 3); return; }
        let options = [0, 1, 2, 3].filter(s => !used.has(c.rank * 4 + s));
        if (shared !== null && shared !== undefined && options.includes(shared)) options = [shared];
        else if (!same) { const fresh = options.filter(s => !usedSuits.has(s)); if (fresh.length) options = fresh; }
        if (!options.length) { errors.push(`no ${E.RN[c.rank]} left`); return; }
        const card = c.rank * 4 + options[rnd(options.length)];
        memo[key(i)] = card; out[i] = take(card); usedSuits.add(card & 3);
      });
      if (need && out.filter(x => x !== null).length < need) { errors.push(`${name === 'hero' ? 'your hand' : name} needs ${need} cards`); return null; }
      return out.filter(x => x !== null).slice(0, need || out.length);
    };
    const hero = fill('hero', p.groups.hero.slice(0, 2), 2);
    if (hero) said.push(`Your cards ${hero.map(E.cardText).join(' ')}`);
    let board = null;
    const flop = fill('flop', p.groups.flop.slice(0, 3), 3), turn = fill('turn', p.groups.turn.slice(0, 1), 1), river = fill('river', p.groups.river.slice(0, 1), 1);
    if (flop || turn || river) {
      // a later street keeps the earlier board as it is on the table (fixed or as dealt)
      const runout = (ctx.runout || []).slice();
      const keep = i => { const c = runout[i]; if (c === undefined || used.has(c)) { const pool = [...Array(52).keys()].filter(x => !used.has(x)); return take(pool[rnd(pool.length)]); } return take(c); };
      const f = flop || [0, 1, 2].map(keep);
      const t = turn ? turn[0] : river ? keep(3) : null;
      board = f.concat(t !== null ? [t] : [], river ? [river[0]] : []);
      said.push(`Board ${board.map(E.cardText).join(' ')}`);
    }
    if (p.opponents) said.push(`${p.opponents + 1} players`);
    if (p.position) said.push(`You on the ${p.position}`);
    return { hero: hero ? hero.map(E.codeOf) : null, board: board ? board.map(E.codeOf) : null, position: p.position, opponents: p.opponents, errors, said };
  }

  // True when the words say something the parser turned into an edit (cards, board, seats).
  const understood = p => !!(p.groups.hero.length || p.groups.flop.length || p.groups.turn.length || p.groups.river.length || p.position || p.opponents);

  return { parse, resolve, understood, tokenize };
});
