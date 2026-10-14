// The scenario: one JSON record describing a hand — table, players, positions, stacks, known cards, ranges,
// the action on each street, and which street is on screen. The table, the stats and the agent all read and write it.
// Shared by the browser (window.PokerScenario) and the server (require). Cards are codes like "Ah", "Tc".
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./engine.js') : root.PokerEngine, node ? require('./strategy.js') : root.PokerStrategy, node ? require('./ranges.js') : root.PokerRanges, node ? require('./ev.js') : root.PokerEV);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PokerScenario = api;
})(typeof self !== 'undefined' ? self : this, function (E, PS, RG, EV) {
  'use strict';

  const STREETS = ['preflop', 'flop', 'turn', 'river', 'showdown'];
  const BOARD_N = [0, 3, 4, 5, 5];
  const NAMES = ['Marisol', 'Dev', 'Tucker', 'Yuki', 'Lena', 'Omar', 'Priya', 'Hank', 'Sofia', 'Jonas', 'Ravi', 'Greta'];
  // Position names by distance from the button, for 2–9 players.
  const POS = {
    2: ['BTN', 'BB'], 3: ['BTN', 'SB', 'BB'], 4: ['BTN', 'SB', 'BB', 'UTG'], 5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
    6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'], 7: ['BTN', 'SB', 'BB', 'UTG', 'LJ', 'HJ', 'CO'],
    8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'LJ', 'HJ', 'CO'], 9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'],
  };
  const POS_NAMES = { BTN: 'button', SB: 'small blind', BB: 'big blind', UTG: 'under the gun', 'UTG+1': 'UTG+1', 'UTG+2': 'UTG+2', LJ: 'lojack', HJ: 'hijack', CO: 'cutoff' };
  const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
  const num = (x, def) => (typeof x === 'number' && isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && isFinite(+x) ? +x : def);
  const clone = o => JSON.parse(JSON.stringify(o));
  const normCard = c => { const i = E.cardFromCode(c); return i < 0 ? null : E.codeOf(i); };
  const pretty = c => E.cardText(E.cardFromCode(c));
  const prettyList = cs => (cs && cs.length ? cs.map(pretty).join(' ') : '—');
  const round = x => Math.round(x * 100) / 100;
  // Chip amounts are shown in dollars or in big blinds (a display setting; the scenario always stores chips).
  let unit = '$';
  const setUnit = u => { unit = u === 'bb' ? 'bb' : '$'; return unit; };
  const getUnit = () => unit;
  function fmt(sc, x) {
    if (unit === 'bb') return `${Math.round(x / sc.bigBlind * 10) / 10} BB`;
    return '$' + round(x).toLocaleString('en-US');
  }

  // Each street is an ordered list of actions: {seat, type: fold|check|call|bet|raise, to}. `to` is the seat's total
  // chips in on that street after the action (bets and raises); replay() turns the list into the whole hand state.
  function blankStreet() { return { actions: [] }; }
  function defaultOpponent(i, stack) { return { name: NAMES[i % NAMES.length], stack, cards: null, range: '', style: '', note: '' }; }

  // A fresh table. Hero is seat 0; opponents are seats 1..n in clockwise order. Hero starts in the big blind.
  // Nobody has acted yet: the first player to act preflop is highlighted and the user (or auto-play) decides.
  function create(opts = {}) {
    const n = clamp(Math.round(num(opts.opponents, 5)), 1, 8), stack = Math.max(1, num(opts.stack, 200)), bb = Math.max(0.02, num(opts.bigBlind, 2));
    const names = E.shuffle(NAMES.slice());
    return {
      v: 2, bigBlind: bb, smallBlind: opts.smallBlind != null ? clamp(num(opts.smallBlind, bb / 2), 0, bb) : bb / 2, button: n - 1, street: 0, deal: Math.floor(Math.random() * 1e9), handNo: 1, heroHidden: false,
      hero: { name: 'You', stack, cards: [] },
      opponents: Array.from({ length: n }, (_, i) => ({ ...defaultOpponent(i, stack), name: names[i], stack: opts.randomStacks === false ? stack : stack - 50 + E.rnd(11) * 10 })),
      board: [],
      streets: [blankStreet(), blankStreet(), blankStreet(), blankStreet()],
      note: '',
    };
  }

  // Cleans any incoming object (from the agent or the browser) into a valid scenario, with notes on what was fixed.
  function normalize(input) {
    const fixes = [];
    const src = input && typeof input === 'object' ? input : {};
    const opps = Array.isArray(src.opponents) && src.opponents.length ? src.opponents.slice(0, 8) : create().opponents;
    const n = opps.length;
    const bb = Math.max(0.02, num(src.bigBlind, 2));
    const sc = {
      v: 2, bigBlind: bb, smallBlind: clamp(num(src.smallBlind, bb / 2), 0, bb), button: ((Math.round(num(src.button, n - 1)) % (n + 1)) + n + 1) % (n + 1),
      street: clamp(Math.round(num(src.street, 0)), 0, 4), deal: Math.round(num(src.deal, 0)),
      handNo: Math.max(1, Math.round(num(src.handNo, 1))), heroHidden: !!src.heroHidden,
      hero: { name: 'You', stack: Math.max(0, num(src.hero && src.hero.stack, 200)), cards: [] },
      opponents: [], board: [], streets: [], note: typeof src.note === 'string' ? src.note.slice(0, 500) : '',
    };
    const used = new Set();
    const take = (list, what, max) => {
      const out = [];
      for (const raw of Array.isArray(list) ? list : []) {
        const c = normCard(raw);
        if (!c) { fixes.push(`${what}: "${raw}" is not a card`); continue; }
        if (used.has(c)) { fixes.push(`${what}: ${pretty(c)} is already in use`); continue; }
        if (out.length >= max) break;
        used.add(c); out.push(c);
      }
      return out;
    };
    const hc = take(src.hero && src.hero.cards, 'your cards', 2);
    sc.hero.cards = hc.length === 2 ? hc : (hc.forEach(c => used.delete(c)), []);
    let board = take(src.board, 'board', 5);
    if (board.length === 1 || board.length === 2) { fixes.push('board needs at least the three flop cards'); board.forEach(c => used.delete(c)); board = []; }
    sc.board = board;
    opps.forEach((o, i) => {
      o = o && typeof o === 'object' ? o : {};
      const cards = o.cards ? take(o.cards, `seat ${i + 1} cards`, 2) : [];
      if (cards.length === 1) used.delete(cards[0]);
      const range = typeof o.range === 'string' ? o.range.slice(0, 300).trim() : '';
      if (range) { const r = E.rangeOf(range); if (r.errors.length) fixes.push(`seat ${i + 1} range: ${r.errors.join('; ')}`); }
      sc.opponents.push({
        name: (typeof o.name === 'string' && o.name.trim() ? o.name.trim() : NAMES[i % NAMES.length]).slice(0, 24),
        stack: Math.max(0, num(o.stack, 200)), cards: cards.length === 2 ? cards : null, range,
        style: typeof o.style === 'string' ? o.style.slice(0, 40).trim().toLowerCase() : '', note: typeof o.note === 'string' ? o.note.slice(0, 200) : '',
        ...(o.styleBy === 'stats' || o.styleBy === 'you' ? { styleBy: o.styleBy } : {}),
      });
    });
    const streets = Array.isArray(src.streets) ? src.streets : [];
    const TYPES = ['fold', 'check', 'call', 'bet', 'raise'];
    sc.streets = [0, 1, 2, 3].map(s => {
      const st = streets[s] && typeof streets[s] === 'object' ? streets[s] : {};
      const actions = (Array.isArray(st.actions) ? st.actions : []).filter(a => a && TYPES.includes(a.type)).map(a => ({ seat: Math.round(num(a.seat, -1)), type: a.type, to: Math.max(0, num(a.to, 0)), ...(a.auto ? { auto: true } : {}), ...(a.filled ? { filled: true } : {}) })).filter(a => a.seat >= 0 && a.seat <= n);
      const plan = st.plan && Array.isArray(st.plan.folds) ? { folds: st.plan.folds.map(x => Math.round(num(x, -1))).filter(x => x >= 1 && x <= n) } : undefined;
      return plan ? { actions, plan } : { actions };
    });
    // Older saves described a street as {aggressor, amount, folds}: rebuild those as action sequences.
    if (streets.some(st => st && !Array.isArray(st.actions) && ('aggressor' in st || 'folds' in st))) {
      for (let s = 0; s < 4; s++) {
        const st = streets[s] || {};
        if (s > 0 && st.aggressor == null && !(st.folds || []).length && sc.street < s) break;
        scriptStreet(sc, s, { aggressor: st.aggressor == null ? null : num(st.aggressor, null), amount: num(st.amount, 0), folds: st.folds || [] }, { heroCalls: s < sc.street });
      }
    }
    sc.street = Math.min(sc.street, viewLimit(sc));
    return { scenario: sc, fixes };
  }

  // ----- derived facts -----
  function positions(sc) {
    const players = sc.opponents.length + 1, names = POS[players];
    return Array.from({ length: players }, (_, seat) => names[(seat - sc.button + players) % players]);
  }
  const seatOfPosition = (sc, pos) => positions(sc).indexOf(pos);
  const sbOf = sc => (sc.smallBlind == null ? sc.bigBlind / 2 : sc.smallBlind);
  function blindOf(sc, seat) { const p = positions(sc)[seat]; return p === 'BB' ? sc.bigBlind : p === 'SB' || (p === 'BTN' && sc.opponents.length === 1) ? sbOf(sc) : 0; }
  const effRange = o => o.range || (o.style && E.STYLES[o.style] !== undefined ? o.style : '') || '';
  function rangeLabel(o) {
    if (o.cards) return `known: ${prettyList(o.cards)}`;
    const r = effRange(o); if (!r) return 'random hand';
    const pr = E.rangeOf(r); return `${o.range ? o.range : o.style} (${round(pr.pct)}% of hands)`;
  }

  // ----- what each opponent's preflop actions say about their hand -----
  // An opener holds an opening range for their seat, a caller a calling range, a 3-bettor a 3-bet range, and so on
  // (charts in strategy.js). Used for the odds whenever you haven't given that player cards, a range or a style.
  // Returns one entry per seat: {kind, label, range, pct} or null (hasn't acted voluntarily yet).
  function inferredRanges(sc, m) {
    m = m || money(sc);
    const players = sc.opponents.length + 1, pos = positions(sc), { pre } = orders(sc), snap = m.street[0];
    const out = new Array(players).fill(null);
    if (!snap) return out;
    const behind = seat => players - 1 - pre.indexOf(seat);
    const setPct = seat => { if (seat <= 0) return null; const r = effRange(sc.opponents[seat - 1]); return r ? E.rangeOf(r).pct : null; };
    let raises = 0, first = null;
    for (const a of snap.actions) {
      const p = pos[a.seat], group = p === 'BB' ? 'BB' : p === 'SB' ? 'SB' : 'IP';
      const vsFirst = { group, raiserBehind: first === null ? 0 : behind(first), raiserPct: setPct(first) };
      let ev = null;
      if (a.type === 'raise' || a.type === 'bet') {
        ev = raises === 0 ? { kind: 'open', behind: behind(a.seat), players } : raises === 1 ? { kind: '3bet', ...vsFirst } : { kind: '4bet' };
        raises++; if (first === null) first = a.seat;
      } else if (a.type === 'call') {
        ev = raises === 0 ? { kind: p === 'SB' ? 'sb-complete' : 'limp' } : raises === 1 ? { kind: 'call-open', ...vsFirst } : { kind: raises === 2 ? 'call-3bet' : 'call-4bet' };
      } else if (a.type === 'check') ev = { kind: 'bb-check' };
      if (ev && a.seat > 0) { const r = PS.rangeFor(ev); out[a.seat] = r.range ? { kind: ev.kind, label: r.label, range: r.range, pct: PS.pctOf(r.range) } : null; }
    }
    return out;
  }
  // The hands an opponent is treated as holding: known cards (null here), your range or style, or what their actions imply.
  function likelyRange(sc, seat, inf) {
    const o = sc.opponents[seat - 1];
    if (o.cards) return null;
    if (effRange(o)) return effRange(o);
    const x = (inf || inferredRanges(sc))[seat];
    return x ? x.range : '';
  }
  function seatRangeLabel(sc, seat, s) {
    const o = sc.opponents[seat - 1];
    if (o.cards) return rangeLabel(o);
    const r = readOf(sc, seat, s === undefined ? Math.min(sc.street, 3) : s);
    return r.summary;
  }

  // ----- your read on an opponent -----
  // The hands you should put them on from what you can see: their seat, the style you gave them, what they did on
  // each street, the board, and your own cards (card removal). Their hidden cards are never looked at.
  // Preflop the charts give a starting range; after the flop each possible holding is weighted by how likely it is to
  // have taken the actions you saw (ranges.js). A range you typed is used as it is (only card removal applies).
  // → {kind: known|range|model, combos: [[a,b,w]], n (weighted hands), pct, steps: [{text, n}], groups, summary}
  const readMemo = new Map();
  const ALL = E.rangeOf('').combos;
  const cap1s = x => x.charAt(0).toUpperCase() + x.slice(1);
  function readOf(sc, seat, s) {
    s = Math.max(0, Math.min(3, s === undefined ? sc.street : s));
    const key = JSON.stringify([sc.streets, sc.board, sc.heroHidden ? [] : sc.hero.cards, sc.opponents, sc.button, sc.bigBlind, sc.smallBlind, sc.hero.stack, seat, s]);
    const hit = readMemo.get(key); if (hit) return hit;
    const r = buildRead(sc, seat, s);
    if (readMemo.size > 80) readMemo.clear();
    readMemo.set(key, r); return r;
  }
  function buildRead(sc, seat, s) {
    const o = sc.opponents[seat - 1], m = money(sc), pos = positions(sc), board = sc.board.slice(0, BOARD_N[s]).map(E.cardFromCode);
    if (o.cards) { const cs = o.cards.map(E.cardFromCode); return { kind: 'known', combos: [[cs[0], cs[1], 1]], n: 1, pct: 100 / 1326, steps: [{ text: `You set their cards: ${prettyList(o.cards)}.`, n: 1 }], groups: [], summary: `known: ${prettyList(o.cards)}` }; }
    // cards you can see: yours, the board, anyone's known cards
    const dead = new Set(board);
    if (!sc.heroHidden) sc.hero.cards.forEach(c => dead.add(E.cardFromCode(c))); // face-down cards you haven't seen tell you nothing
    sc.opponents.forEach((x, i) => { if (i !== seat - 1 && x.cards) x.cards.forEach(c => dead.add(E.cardFromCode(c))); });
    const w = new Map(); // a*52+b → weight
    const steps = [], total = () => { let t = 0; w.forEach((x, k) => { if (!dead.has(Math.floor(k / 52)) && !dead.has(k % 52)) t += x; }); return t; };
    const set = (text, list, weightOf) => { list.forEach(([a, b]) => w.set(a * 52 + b, weightOf ? weightOf(a, b) : 1)); };
    const mods = RG.modsFor(o.style);
    let kind = 'model';
    if (o.range) {
      kind = 'range';
      set('', E.rangeOf(o.range).combos);
      steps.push({ text: `Using the range you set: ${o.range}. It isn't narrowed further by their betting.`, n: total() });
    } else {
      const inf = inferredRanges(sc, m)[seat], styleR = effRange(o);
      const width = styleR ? E.rangeOf(styleR).pct : 25, f = Math.max(0.3, width / 25);
      if (!inf) {
        set('', styleR ? E.rangeOf(styleR).combos : ALL);
        steps.push({ text: styleR ? `Hasn't put money in voluntarily yet. As a${/^[aeiou]/.test(o.style) ? 'n' : ''} ${o.style} player they play about ${Math.round(width)}% of hands.` : `Hasn't put money in voluntarily yet: any two cards.`, n: total() });
      } else if (inf.kind === 'bb-check') {
        const iso = E.rangeOf(PS.ISO_BB).combos.map(([a, b]) => a * 52 + b);
        set('', ALL); iso.forEach(k => w.set(k, 0.25));
        steps.push({ text: 'Checked the big blind: any hand, though strong ones would usually have raised.', n: total() });
      } else {
        const chart = E.rangeOf(inf.range), inChart = new Set(chart.combos.map(([a, b]) => a * 52 + b)), pct = chart.pct;
        set('', ALL, (a, b) => {
          const k = a * 52 + b, top = E.PCT[E.handLabel(a, b)];
          if (inChart.has(k)) return f < 1 && !styleR ? 1 : f < 1 && top > pct * f ? 0.2 : 1;
          return f > 1 && top <= pct * f ? 0.7 : 0;
        });
        steps.push({ text: `${cap1s(inf.label)} from ${pos[seat]}: a solid player does that with about ${Math.round(pct)}% of hands${f > 1.05 ? `; as a${/^[aeiou]/.test(o.style) ? 'n' : ''} ${o.style} player, wider` : f < 0.95 ? `; as a ${o.style} player, tighter` : ''}.`, n: total() });
      }
      if (mods.text) steps.push({ text: mods.text, n: null });
      // after the flop: every action they took, in order
      const pfr = m.street[0] ? m.street[0].lastAgg : null;
      for (let k = 1; k <= s; k++) {
        const snap = m.street[k]; if (!snap) break;
        if (!snap.actions.some(a => a.seat === seat)) continue;
        if (sc.board.length < BOARD_N[k]) { steps.push({ text: `The ${STREETS[k]} cards aren't set, so their ${STREETS[k]} action can't be read.`, n: null }); continue; }
        const bd = sc.board.slice(0, BOARD_N[k]).map(E.cardFromCode), cls = new Map();
        const contrib = new Array(sc.opponents.length + 1).fill(0), gone = new Set(); let max = 0, firstIn = true, called = 0;
        for (const a of snap.actions) {
          const owe = max - contrib[a.seat], potBefore = snap.start + contrib.reduce((x, y) => x + y, 0);
          if (a.seat === seat && a.type !== 'fold') {
            const others = Math.max(0, m.live[k].filter(x => !gone.has(x)).length - 2);
            const facing = owe > 0, sit = { facing, price: facing ? owe / (potBefore + owe) : 0, river: k === 3, cbet: k === 1 && pfr === seat && firstIn, mods, others, callers: facing ? called : 0 };
            const bet = a.to - contrib[a.seat], frac = bet / Math.max(potBefore, 1e-9);
            const act = facing ? (a.type === 'call' ? 'call' : 'raise') : a.type === 'check' ? 'check' : frac > 0.6 ? 'big' : 'small';
            w.forEach((x, key) => {
              if (!x) return;
              const c1 = Math.floor(key / 52), c2 = key % 52;
              if (bd.includes(c1) || bd.includes(c2)) { w.set(key, 0); return; }
              let c = cls.get(key); if (!c) { c = RG.classify([c1, c2], bd); cls.set(key, c); }
              w.set(key, x * RG.freqs(c.key, sit)[act]);
            });
            let top = 0; w.forEach(x => { if (x > top) top = x; });
            if (top > 0) w.forEach((x, key) => w.set(key, x / top)); // the likeliest holdings count fully; the rest relative to them
            const what = act === 'check' ? 'Checked' : act === 'call' ? `Called ${fmt(sc, owe)}` : act === 'raise' ? `Raised to ${fmt(sc, a.to)}` : `Bet ${fmt(sc, bet)} (${Math.round(frac * 100)}% of the pot)`;
            steps.push({ text: `${what} on the ${STREETS[k]}: ${RG.SAYS[act]}.`, n: total() });
          }
          if (a.type === 'fold') { gone.add(a.seat); if (a.seat === seat) steps.push({ text: `Folded on the ${STREETS[k]}.`, n: null }); }
          else if (a.type !== 'check') { contrib[a.seat] = Math.max(contrib[a.seat], a.to); max = Math.max(max, a.to); }
          if (a.type === 'bet' || a.type === 'raise') { firstIn = false; called = 0; } else if (a.type === 'call') called++;
          if (a.seat === seat) firstIn = false;
        }
      }
    }
    // what's left, grouped by what it is on the board you're looking at
    const combos = []; let n = 0;
    w.forEach((x, key) => { const a = Math.floor(key / 52), b = key % 52; if (x > 0.01 && !dead.has(a) && !dead.has(b)) { combos.push([a, b, x]); n += x; } });
    const groups = new Map();
    for (const h of combos) {
      let g, ord;
      if (board.length >= 3) { const c = RG.classify([h[0], h[1]], board); g = c.group; ord = RG.groupOrd(g); }
      else { const pg = preflopGroup(h[0], h[1]); g = pg[0]; ord = pg[1]; }
      if (!groups.has(g)) groups.set(g, { key: g, name: board.length >= 3 ? RG.groupName(g) : g, ord, n: 0, combos: [] });
      const G = groups.get(g); G.n += h[2]; G.combos.push(h);
    }
    // likeliest kind of hand first; "nothing" always last
    const list = [...groups.values()].sort((x, y) => (x.key === 'air') - (y.key === 'air') || y.n - x.n || x.ord - y.ord);
    list.forEach(G => { G.combos.sort((x, y) => y[2] - x[2] || Math.max(y[0], y[1]) - Math.max(x[0], x[1]) || Math.min(y[0], y[1]) - Math.min(x[0], x[1])); G.hands = handClasses(G.combos, board); });
    const pct = n / 1326 * 100;
    const summary = kind === 'range' ? `your range: ${o.range} (about ${round(pct)}% of hands)` : `about ${pct >= 10 ? Math.round(pct) : Math.round(pct * 10) / 10}% of hands (${Math.round(n)} combos)`;
    return { kind, combos, n, pct, steps, groups: list, summary, mods: mods.text };
  }
  // Combos merged into hands as a player would name them: "A6" (or "A6s" / "A6o" before the flop). A suit is shown only
  // where it matters: the card helps make or draw to a flush on this board (e.g. "A♥6" when the board has three hearts).
  // → [{ranks: [hi, lo], suits: [suit|null, suit|null], tag: 's'|'o'|'', count, w (average weight), total}], likeliest first
  function handClasses(combos, board) {
    const onBoard = [0, 0, 0, 0]; board.forEach(c => onBoard[E.suitOf(c)]++);
    const need = board.length >= 5 ? 5 : 4; // a flush, or a flush draw with cards to come
    const out = new Map();
    for (const [a, b, w] of combos) {
      const [hi, lo] = E.rankOf(a) > E.rankOf(b) || (E.rankOf(a) === E.rankOf(b) && E.suitOf(a) > E.suitOf(b)) ? [a, b] : [b, a];
      const mine = s => (E.suitOf(hi) === s) + (E.suitOf(lo) === s);
      const suit = c => (board.length >= 3 && onBoard[E.suitOf(c)] + mine(E.suitOf(c)) >= need ? E.suitOf(c) : null);
      const ranks = [E.rankOf(hi), E.rankOf(lo)], pair = ranks[0] === ranks[1];
      let suits = board.length >= 3 ? [suit(hi), suit(lo)] : [null, null];
      if (pair && suits[0] === null && suits[1] !== null) suits = [suits[1], null]; // 6♥6, not 66♥
      const tag = board.length >= 3 || pair ? '' : E.suitOf(hi) === E.suitOf(lo) ? 's' : 'o';
      const key = `${ranks.join(',')}|${suits.join(',')}|${tag}`;
      if (!out.has(key)) out.set(key, { ranks, suits, tag, count: 0, total: 0 });
      const H = out.get(key); H.count++; H.total += w;
    }
    return [...out.values()].map(H => ({ ...H, w: H.total / H.count })).sort((x, y) => y.total - x.total || y.ranks[0] - x.ranks[0] || y.ranks[1] - x.ranks[1]);
  }
  function preflopGroup(a, b) {
    let r1 = E.rankOf(a), r2 = E.rankOf(b); if (r1 < r2) [r1, r2] = [r2, r1];
    const suited = E.suitOf(a) === E.suitOf(b);
    if (r1 === r2) return [r1 >= 10 ? 'Big pairs (QQ+)' : r1 >= 6 ? 'Middle pairs (88–JJ)' : 'Small pairs (22–77)', r1 >= 10 ? 1 : r1 >= 6 ? 2 : 3];
    if (r1 === 12) return r2 >= 8 ? ['Big aces (AT+)', 4] : [suited ? 'Suited aces' : 'Offsuit aces', suited ? 5 : 8];
    if (r2 >= 8) return ['Broadway cards', 6];
    if (suited) return r1 - r2 <= 2 ? ['Suited connectors', 7] : ['Other suited hands', 9];
    return ['Other offsuit hands', 10];
  }

  // ----- betting: replay the action lists in table order -----
  // preflop: UTG first … BB last (heads-up: the button/small blind first); postflop: SB first … button last.
  function orders(sc) {
    const players = sc.opponents.length + 1;
    const pre = players === 2 ? [sc.button, (sc.button + 1) % 2] : Array.from({ length: players }, (_, i) => (sc.button + 3 + i) % players);
    const post = players === 2 ? [(sc.button + 1) % 2, sc.button] : Array.from({ length: players }, (_, i) => (sc.button + 1 + i) % players);
    return { pre, post };
  }
  const stackOf = (sc, seat) => (seat === 0 ? sc.hero.stack : sc.opponents[seat - 1].stack);

  // The whole hand from the action lists. Illegal or out-of-turn actions are dropped (with everything after them).
  // Returns {streets: [snapshot per street reached], frontier, ended, foldedAt, total, potFinal}. A snapshot:
  // {start, pot, contrib[], max, lastRaise, lastAgg, acted, actions (applied, with text), next, complete, liveAfter, allIn}.
  function replay(sc) {
    const players = sc.opponents.length + 1, bb = sc.bigBlind, { pre, post } = orders(sc), pos = positions(sc);
    const foldedAt = new Array(players).fill(null), total = new Array(players).fill(0);
    const left = seat => stackOf(sc, seat) - total[seat];
    const streets = []; let pot = 0, ended = null, dropped = 0;
    for (let s = 0; s < 4; s++) {
      const contrib = new Array(players).fill(0), acted = new Set();
      const snap = { start: pot, contrib, max: 0, lastRaise: bb, lastAgg: null, acted, actions: [], next: null, complete: false };
      const put = (seat, to) => { const add = Math.max(0, Math.min(to - contrib[seat], left(seat))); contrib[seat] += add; total[seat] += add; return contrib[seat]; };
      if (s === 0) {
        const sbSeat = players === 2 ? sc.button : (sc.button + 1) % players, bbSeat = players === 2 ? (sc.button + 1) % 2 : (sc.button + 2) % players;
        put(sbSeat, sbOf(sc)); put(bbSeat, bb); snap.max = bb;
      }
      const order = s === 0 ? pre : post;
      const inHand = seat => foldedAt[seat] === null;
      const canAct = seat => inHand(seat) && left(seat) > 0;
      const needs = seat => canAct(seat) && (contrib[seat] < snap.max || !acted.has(seat));
      const live = () => order.filter(inHand);
      const nextAfter = idx => { for (let k = 1; k <= players; k++) { const seat = order[(idx + k + players) % players]; if (needs(seat)) return seat; } return null; };
      const settle = () => {
        if (live().length <= 1) { snap.next = null; snap.complete = true; return; }
        const open = order.filter(needs);
        // only one player can still act and nobody is owed a call: the round is over (everyone else is all-in)
        if (!open.length || (open.length === 1 && order.filter(canAct).length === 1 && contrib[open[0]] >= snap.max)) { snap.next = null; snap.complete = true; return; }
        const lastIdx = snap.actions.length ? order.indexOf(snap.actions[snap.actions.length - 1].seat) : -1;
        snap.next = nextAfter(lastIdx);
        snap.complete = snap.next === null;
      };
      settle();
      for (const a of sc.streets[s].actions) {
        if (snap.complete || a.seat !== snap.next) { dropped++; break; }
        const seat = a.seat, owe = snap.max - contrib[seat];
        let type = a.type;
        if (type === 'check' && owe > 0) type = 'call';
        if (type === 'call' && owe <= 0) type = 'check';
        if (type === 'bet' && snap.max > 0) type = 'raise';
        if (type === 'raise' && snap.max === 0) type = 'bet';
        let to = contrib[seat];
        if (type === 'fold') foldedAt[seat] = s;
        else if (type === 'call') to = put(seat, snap.max);
        else if (type === 'bet' || type === 'raise') {
          const minTo = snap.max + Math.max(snap.lastRaise, bb);
          const target = Math.max(a.to || 0, minTo);
          to = put(seat, target);
          if (to <= snap.max) type = 'call'; // short all-in that can't raise
          else { if (to - snap.max >= snap.lastRaise) snap.lastRaise = to - snap.max; snap.max = to; snap.lastAgg = seat; acted.clear(); }
        }
        acted.add(seat);
        const allIn = type !== 'fold' && type !== 'check' && left(seat) <= 0;
        snap.actions.push({ seat, type, to, allIn, text: actionText(sc, seat, type, to, allIn, s) });
        settle();
      }
      snap.pot = pot + contrib.reduce((x, y) => x + y, 0);
      snap.liveAfter = order.filter(inHand).sort((x, y) => x - y);
      snap.allIn = Array.from({ length: players }, (_, i) => inHand(i) && left(i) <= 0);
      streets.push(snap);
      pot = snap.pot;
      if (snap.liveAfter.length <= 1) { ended = { by: 'fold', winner: snap.liveAfter[0], street: s }; break; }
      if (!snap.complete) break;
    }
    const last = streets[streets.length - 1];
    const frontier = ended ? ended.street : last.complete ? 4 : streets.length - 1;
    return { streets, frontier, ended, foldedAt, total, potFinal: pot, dropped, pos };
  }
  function actionText(sc, seat, type, to, allIn, s) {
    const m = x => fmt(sc, x);
    if (allIn) return `All-in ${m(to)}`;
    if (seat === 0) return { fold: 'Fold', check: 'Check', call: `Call ${m(to)}`, bet: `Bet ${m(to)}`, raise: `Raise to ${m(to)}` }[type];
    return { fold: 'Folds', check: 'Checks', call: `Calls ${m(to)}`, bet: `Bets ${m(to)}`, raise: `Raises to ${m(to)}` }[type];
  }
  // Furthest street the table can show: up to the street being bet, or showdown once betting is done.
  function viewLimit(sc) { const r = replay(sc); return r.ended ? Math.max(r.ended.street, BOARD_N.indexOf(Math.max(...BOARD_N.filter(x => x <= sc.board.length)))) : r.frontier; }

  // Money view used by the table, the stats and the agent (built from replay()).
  // Per street s (0 preflop … 3 river): potStart, potShow (pot including bets so far), level (highest bet), toCall (for you),
  // live (in at the start), liveAfter (still in), contribAt (cumulative chips per seat at the end), street (snapshot).
  function money(sc) {
    const r = replay(sc), players = sc.opponents.length + 1;
    const out = { potStart: [], potShow: [], level: [], toCall: [], live: [], liveAfter: [], contribAt: [], street: [], potFinal: r.potFinal, foldedAt: r.foldedAt, contrib: r.total, frontier: r.frontier, ended: r.ended, next: null };
    let cum = new Array(players).fill(0), prevLive = Array.from({ length: players }, (_, i) => i);
    for (let s = 0; s < 4; s++) {
      const snap = r.streets[s] || null;
      out.street.push(snap);
      out.live.push(prevLive);
      if (snap) {
        cum = cum.map((x, i) => x + snap.contrib[i]);
        out.potStart.push(snap.start); out.potShow.push(snap.pot); out.level.push(snap.max);
        const heroIn = r.foldedAt[0] === null || r.foldedAt[0] > s;
        out.toCall.push(heroIn && !snap.complete ? Math.max(0, Math.min(snap.max - snap.contrib[0], stackOf(sc, 0) - (cum[0]))) : 0);
        out.liveAfter.push(snap.liveAfter); prevLive = snap.liveAfter;
      } else {
        out.potStart.push(r.potFinal); out.potShow.push(r.potFinal); out.level.push(0); out.toCall.push(0); out.liveAfter.push(prevLive);
      }
      out.contribAt.push(cum.slice());
    }
    out.contribAt[-1] = new Array(players).fill(0);
    const f = r.streets[r.frontier];
    out.next = f && !f.complete ? f.next : null;
    return out;
  }
  // Opponents still in at street s (0..4) — the ones the equity runs against.
  function liveOpponents(sc, s) { const m = money(sc); return m.liveAfter[Math.min(s, 3)].filter(x => x > 0); }

  // Chip sizes for the four choices of the player to act (or a given seat): call/check, a light and a heavy bet or raise.
  function choices(sc, seat) {
    const m = money(sc), snap = m.street[m.frontier], bb = sc.bigBlind;
    if (!snap || snap.complete) return null;
    seat = seat === undefined ? snap.next : seat;
    const leftNow = stackOf(sc, seat) - m.contrib[seat], mine = snap.contrib[seat], owe = Math.max(0, snap.max - mine);
    const cap = mine + leftNow, r1 = x => Math.max(bb, bb >= 2 ? Math.round(x) : Math.round(x * 2) / 2);
    const minTo = snap.max + Math.max(snap.lastRaise, bb);
    let small, big;
    if (snap.max === 0) { small = r1(snap.pot * 0.5); big = r1(snap.pot); }
    else { small = r1(snap.max * 2.5); big = r1(snap.max + snap.pot + owe); }
    small = Math.min(cap, Math.max(small, minTo)); big = Math.min(cap, Math.max(big, small + bb));
    const kind = snap.max === 0 ? 'bet' : 'raise';
    return {
      seat, street: m.frontier, owe: Math.min(owe, leftNow), canCheck: owe <= 0, pot: snap.pot,
      callAllIn: owe >= leftNow, canRaise: leftNow > owe, kind,
      small: { to: small, allIn: small >= cap }, big: { to: big, allIn: big >= cap, same: big <= small },
      facing: snap.max, minTo: Math.min(cap, minTo), maxTo: cap,
    };
  }

  // ----- edits (the agent's tools call these; so can the UI) -----
  // Each returns {ok, summary} or {ok:false, error}; they change sc in place.
  const SEAT_HELP = 'seat number 1–8 (opponent), or 0 / "hero" / "me" for you';
  function seatFrom(sc, x) {
    if (x === 0 || /^(0|hero|me|you|player|myself)$/i.test(String(x))) return 0;
    const n = Math.round(num(x, NaN));
    if (n >= 1 && n <= sc.opponents.length) return n;
    const byName = sc.opponents.findIndex(o => o.name.toLowerCase() === String(x).toLowerCase());
    if (byName >= 0) return byName + 1;
    const pos = String(x).toUpperCase(); const p = positions(sc).indexOf(pos); if (p >= 0) return p;
    return -1;
  }
  const streetFrom = x => { const i = typeof x === 'number' ? x : STREETS.indexOf(String(x || '').toLowerCase()); return i >= 0 && i <= 4 ? i : -1; };
  function cardsInUse(sc, except) {
    const s = new Set();
    if (except !== 'hero') sc.hero.cards.forEach(c => s.add(c));
    if (except !== 'board') sc.board.forEach(c => s.add(c));
    sc.opponents.forEach((o, i) => { if (except !== 'opp' + (i + 1) && o.cards) o.cards.forEach(c => s.add(c)); });
    return s;
  }
  function parseCards(list, n, sc, except) {
    const arr = Array.isArray(list) ? list : String(list || '').split(/[\s,]+/).filter(Boolean);
    const out = [], inUse = cardsInUse(sc, except);
    for (const raw of arr) {
      const c = normCard(raw);
      if (!c) return { error: `"${raw}" is not a card. Use codes like Ah, Td, 9c.` };
      if (out.includes(c)) return { error: `${pretty(c)} is listed twice.` };
      if (inUse.has(c)) return { error: `${pretty(c)} is already used elsewhere in this hand.` };
      out.push(c);
    }
    if (n && !n.includes(out.length)) return { error: `Expected ${n.join(' or ')} cards, got ${out.length}.` };
    return { cards: out };
  }
  // Drop anyone else's copy of these cards so a new assignment always wins.
  function claim(sc, cards, owner) {
    const set = new Set(cards); const freed = [];
    if (owner !== 'hero' && sc.hero.cards.some(c => set.has(c))) { sc.hero.cards = []; freed.push('your cards'); }
    if (owner !== 'board' && sc.board.some(c => set.has(c))) { sc.board = []; freed.push('the board'); }
    sc.opponents.forEach((o, i) => { if (owner !== 'opp' + (i + 1) && o.cards && o.cards.some(c => set.has(c))) { o.cards = null; freed.push(`seat ${i + 1}'s cards`); } });
    return freed;
  }

  const cap1 = x => x.charAt(0).toUpperCase() + x.slice(1);
  const seatName = (sc, seat) => (seat === 0 ? 'You' : seat === null || seat === undefined ? 'nobody' : sc.opponents[seat - 1].name);
  function resetAction(sc) { sc.streets = [blankStreet(), blankStreet(), blankStreet(), blankStreet()]; sc.street = 0; }
  // Finishes a street's betting the passive way: everyone still to act checks or calls (used when the table moves on).
  function completeStreet(sc, s) {
    for (let guard = 0; guard < 40; guard++) {
      const m = money(sc); if (m.ended || m.frontier !== s) return;
      const snap = m.street[s]; if (!snap || snap.complete) return;
      sc.streets[s].actions.push({ seat: snap.next, type: snap.max > snap.contrib[snap.next] ? 'call' : 'check', to: 0, filled: true }); // filled in, not seen
    }
  }
  function scriptStreet(sc, s, { aggressor, amount, folds }, opts = {}) {
    for (let k = s; k < 4; k++) sc.streets[k] = blankStreet();
    folds = folds.map(x => Math.round(num(x, -1)));
    let betDone = false;
    for (let guard = 0; guard < 60; guard++) {
      const m = money(sc); if (m.ended || m.frontier !== s) return;
      const snap = m.street[s]; if (!snap || snap.complete) return;
      const seat = snap.next, owe = snap.max - snap.contrib[seat];
      let act;
      if (seat === aggressor && !betDone) { act = { type: snap.max > 0 ? 'raise' : 'bet', to: amount }; betDone = true; }
      else if (owe > 0) {
        if (folds.includes(seat)) act = { type: 'fold' };
        else if (seat === 0 && !opts.heroCalls && (betDone || aggressor === null)) { sc.streets[s].plan = { folds }; return; } // your decision; the rest plays out after it
        else act = { type: 'call' };
      } else act = { type: 'check' };
      if (seat === aggressor && !(amount > snap.max)) act = { type: owe > 0 ? 'call' : 'check' };
      sc.streets[s].actions.push({ seat, type: act.type, to: act.to || 0 });
    }
  }

  // Takes the betting on street s to `seat`'s turn: back to it if they already acted, otherwise the players in between
  // fold when they face a bet or it's preflop (how = 'call' makes them call instead), and check when they can.
  function moveActionTo(sc, s, seat, how = 'fold') {
    const saved = clone(sc.streets[s]), log = [];
    delete sc.streets[s].plan;
    let m = money(sc), snap = m.street[s];
    if (snap.next === seat) return { ok: true, log };
    for (let guard = 0; guard < 40; guard++) {
      m = money(sc); snap = m.street[s];
      if (m.ended || m.frontier !== s || !snap || snap.complete) break;
      if (snap.next === seat) return { ok: true, log };
      const owe = snap.max - snap.contrib[snap.next], type = owe > 0 ? how : 'check';
      sc.streets[s].actions.push({ seat: snap.next, type, to: 0 });
      log.push(`${seatName(sc, snap.next)} ${type === 'fold' ? 'folds' : type === 'call' ? 'calls' : 'checks'}`);
    }
    // they won't get to act again going forward: take the betting back to their last turn instead
    sc.streets[s] = clone(saved); delete sc.streets[s].plan;
    const idx = money(sc).street[s].actions.map(x => x.seat).lastIndexOf(seat);
    if (idx >= 0) {
      sc.streets[s].actions = sc.streets[s].actions.slice(0, idx);
      m = money(sc);
      if (m.frontier === s && m.street[s].next === seat) return { ok: true, log: ['taken back to their turn'] };
    }
    sc.streets[s] = saved;
    return { ok: false, error: `${seatName(sc, seat)} can't get the action on the ${STREETS[s]} from here${how === 'fold' ? ': everyone before them would fold and end the hand' : ''}.` };
  }

  // A simple computer player for auto-play: plays its actual cards with its style, plus a little randomness.
  // hole/board are card ints. Returns {action: fold|check|call|small|big}.
  function autoAction(sc, seat, hole, board) {
    const m = money(sc), snap = m.street[m.frontier];
    const o = seat > 0 ? sc.opponents[seat - 1] : null;
    const owe = snap.max - snap.contrib[seat], pot = snap.pot, rnd = Math.random();
    const style = (o && o.style) || '', aggro = /maniac|lag|aggressive/.test(style);
    if (m.frontier === 0) {
      // Preflop the computer plays the same charts as the advice (raise or fold, rarely limp), loosened or tightened
      // by its style: stations and fish call more, maniacs and LAGs raise more, nits and tight players fold more.
      const c = preflopCtx(sc, seat, hole, m), d = PS.preflop(c), top = E.PCT[c.label];
      const width = o && effRange(o) ? E.rangeOf(effRange(o)).pct : 25, f = Math.max(0.3, width / 25);
      const passive = /station|fish/.test(style);
      let act = d.action;
      if (act === 'fold' && f > 1 && top <= d.cont * f) act = aggro && rnd < 0.5 ? 'raise' : 'call';
      else if ((act === 'call' || act === 'raise') && f < 1 && !(o && o.range) && top > d.cont * f) act = 'fold';
      if (act === 'call' && aggro && rnd < 0.3) act = 'raise';
      if (act === 'raise' && passive && top > 3 && rnd < 0.5) act = 'call';
      if (act === 'wait') act = 'call';
      if (owe <= 0 && (act === 'fold' || act === 'call')) act = 'check';
      if (act === 'raise') return d.to && d.to > snap.max ? { action: 'raise', amount: d.to } : { action: 'small' };
      return { action: act };
    }
    // After the flop: the same frequencies your read assumes (ranges.js), played with its actual cards.
    const c = RG.classify(hole, board), facing = owe > 0;
    const lastBet = snap.actions.map(x => x.type).lastIndexOf('raise') >= 0 || snap.actions.some(x => x.type === 'bet') ? Math.max(snap.actions.map(x => x.type).lastIndexOf('raise'), snap.actions.map(x => x.type).lastIndexOf('bet')) : -1;
    const f = RG.freqs(c.key, { facing, others: Math.max(0, snap.liveAfter.length - 2), callers: facing ? snap.actions.slice(lastBet + 1).filter(x => x.type === 'call').length : 0, price: facing ? owe / (pot + owe) : 0, river: board.length >= 5, cbet: m.frontier === 1 && m.street[0] && m.street[0].lastAgg === seat && !snap.actions.some(a => a.type === 'bet' || a.type === 'raise' || a.seat === seat), mods: RG.modsFor(style) });
    if (!facing) return { action: rnd < f.big ? 'big' : rnd < f.big + f.small ? 'small' : 'check' };
    if (rnd < f.raise) return { action: c.key === 'S' && Math.random() < 0.3 ? 'big' : 'small' };
    return { action: rnd < f.raise + f.call ? 'call' : 'fold' };
  }

  const ops = {
    setup_table(sc, a) {
      const out = [];
      if (a.reset) {
        const fresh = create({ opponents: a.opponents ?? sc.opponents.length, stack: a.starting_stack ?? sc.hero.stack, bigBlind: a.big_blind ?? sc.bigBlind, randomStacks: a.starting_stack == null });
        Object.assign(sc, fresh); out.push('new table');
      }
      if (a.opponents != null) {
        const heroPos = positions(sc)[0];
        const n = clamp(Math.round(num(a.opponents, sc.opponents.length)), 1, 8), stack = sc.hero.stack;
        while (sc.opponents.length < n) {
          const taken = new Set(sc.opponents.map(o => o.name));
          const name = NAMES.find(x => !taken.has(x)) || `Player ${sc.opponents.length + 1}`;
          sc.opponents.push({ ...defaultOpponent(0, stack), name });
        }
        if (sc.opponents.length > n) sc.opponents.length = n;
        resetAction(sc);
        const off = POS[n + 1].indexOf(heroPos === 'BTN' && n === 1 ? 'BTN' : heroPos);
        sc.button = off >= 0 ? (n + 1 - off) % (n + 1) : n - 1 >= 0 ? (n + 1 - POS[n + 1].indexOf('BB')) % (n + 1) : 0;
        out.push(`${n} opponent${n > 1 ? 's' : ''}`);
      }
      if (a.big_blind != null || a.small_blind != null) {
        if (a.big_blind != null) sc.bigBlind = Math.max(0.02, num(a.big_blind, sc.bigBlind));
        sc.smallBlind = a.small_blind != null ? clamp(num(a.small_blind, sc.bigBlind / 2), 0, sc.bigBlind) : sc.bigBlind / 2;
        resetAction(sc); out.push(`blinds ${round(sc.smallBlind)}/${round(sc.bigBlind)}`);
      }
      if (a.starting_stack != null) { const st = Math.max(1, num(a.starting_stack, 200)); sc.hero.stack = st; sc.opponents.forEach(o => o.stack = st); out.push(`stacks ${st}`); }
      if (a.hero_position) {
        const pos = String(a.hero_position).toUpperCase().replace(/\s+/g, '');
        const names = POS[sc.opponents.length + 1], off = names.indexOf(pos === 'BUTTON' ? 'BTN' : pos === 'CUTOFF' ? 'CO' : pos);
        if (off < 0) return { ok: false, error: `Position must be one of ${names.join(', ')} at this table size.` };
        const btn = (sc.opponents.length + 1 - off) % (sc.opponents.length + 1);
        if (btn !== sc.button) { sc.button = btn; resetAction(sc); }
        out.push(`you on the ${POS_NAMES[names[off]]}`);
      }
      return { ok: true, summary: `Table: ${out.join(', ') || 'unchanged'}` };
    },
    set_hero_cards(sc, a) {
      sc.heroHidden = false;
      if (!a.cards || !a.cards.length) { sc.hero.cards = []; return { ok: true, summary: 'Your cards: random' }; }
      const p = parseCards(a.cards, [2], { hero: { cards: [] }, board: [], opponents: [] });
      if (p.error) return { ok: false, error: p.error };
      const freed = claim(sc, p.cards, 'hero'); sc.hero.cards = p.cards;
      return { ok: true, summary: `Your cards: ${prettyList(sc.hero.cards)}${freed.length ? ` (cleared ${freed.join(', ')}, which used the same card)` : ''}` };
    },
    set_board(sc, a) {
      const p = parseCards(a.cards || [], [0, 3, 4, 5], { hero: { cards: [] }, board: [], opponents: [] });
      if (p.error) return { ok: false, error: p.error + ' A board is 0, 3 (flop), 4 (turn) or 5 (river) cards in deal order.' };
      const freed = claim(sc, p.cards, 'board'); sc.board = p.cards;
      const target = BOARD_N.indexOf(p.cards.length);
      if (a.show !== false && sc.street < target) {
        // the flop/turn/river can only be on the table once the betting before it is finished
        for (let k = 0; k < target; k++) { if (replay(sc).ended) break; completeStreet(sc, k); }
        sc.street = Math.min(target, viewLimit(sc));
      }
      return { ok: true, summary: `Board: ${prettyList(sc.board)}${freed.length ? ` (cleared ${freed.join(', ')})` : ''}` };
    },
    set_opponent(sc, a) {
      const seat = seatFrom(sc, a.seat); if (seat < 1) return { ok: false, error: `Unknown opponent "${a.seat}". Use a ${SEAT_HELP}, a name, or a position.` };
      const o = sc.opponents[seat - 1], out = [];
      if (a.name) { o.name = String(a.name).slice(0, 24); out.push(`name ${o.name}`); }
      if (a.stack != null) { o.stack = Math.max(0, num(a.stack, o.stack)); out.push(`stack ${o.stack}`); }
      if (a.cards !== undefined) {
        if (!a.cards || !a.cards.length) { o.cards = null; out.push('cards unknown'); }
        else { const p = parseCards(a.cards, [2], { hero: { cards: [] }, board: [], opponents: [] }); if (p.error) return { ok: false, error: p.error }; claim(sc, p.cards, 'opp' + seat); o.cards = p.cards; out.push(`cards ${prettyList(p.cards)}`); }
      }
      if (a.style !== undefined) { const st = String(a.style || '').toLowerCase().trim(); if (st && E.STYLES[st] === undefined) return { ok: false, error: `Style must be one of: ${Object.keys(E.STYLES).join(', ')}.` }; o.style = st; o.styleBy = a.by === 'stats' ? 'stats' : 'you'; out.push(st ? `style ${st}` : 'no style'); }
      if (a.range !== undefined) {
        const r = String(a.range || '').trim();
        if (r) { const pr = E.parseRange(r); if (pr.errors.length) return { ok: false, error: `Range problem: ${pr.errors.join('; ')}. Use notation like "QQ+, AKs, AQo+, A5s-A2s, 76s, top 15%".` }; out.push(`range ${r} (${round(pr.pct)}% of hands)`); }
        else out.push('range cleared');
        o.range = r;
      }
      if (a.note !== undefined) { o.note = String(a.note || '').slice(0, 200); }
      return { ok: true, summary: `Seat ${seat} ${o.name}: ${out.join(', ') || 'unchanged'}` };
    },
    // Scripts a whole street from "who bets, who folds": players check or call around the bet in turn order,
    // the listed seats fold when facing it, and it stops when it's your turn to answer a bet.
    set_action(sc, a) {
      const s = streetFrom(a.street); if (s < 0 || s > 3) return { ok: false, error: 'street must be preflop, flop, turn or river.' };
      let aggressor = null;
      if (a.aggressor !== undefined && a.aggressor !== null && !/^(none|nobody|check|checks|limp|limps)$/i.test(String(a.aggressor))) {
        aggressor = seatFrom(sc, a.aggressor); if (aggressor < 0) return { ok: false, error: `Unknown player "${a.aggressor}". Use a ${SEAT_HELP}.` };
      }
      const amount = a.amount == null ? null : num(a.amount, NaN);
      if (amount !== null && !(amount >= 0)) return { ok: false, error: 'amount must be a number of chips (the total bet or raise-to size on this street).' };
      if (aggressor !== null && !amount) return { ok: false, error: 'Give the bet size (amount) for the player who bets.' };
      const folds = (Array.isArray(a.folds) ? a.folds : a.folds == null ? [] : [a.folds]).filter(x => x !== null && x !== '').map(x => seatFrom(sc, x));
      if (folds.some(x => x < 1)) return { ok: false, error: 'folds must list opponent seats (1–8); use the act tool for your own fold.' };
      for (let k = 0; k < s; k++) completeStreet(sc, k);
      const r0 = replay(sc);
      if (r0.ended && r0.ended.street < s) return { ok: false, error: 'The hand is already over: everyone else folded earlier.' };
      scriptStreet(sc, s, { aggressor, amount, folds });
      if (a.show !== false) sc.street = Math.max(sc.street, s);
      sc.street = Math.min(sc.street, viewLimit(sc));
      const m = money(sc), snap = m.street[s];
      const log = snap ? snap.actions.map(x => `${seatName(sc, x.seat)} ${x.text.toLowerCase()}`).join(', ') : '';
      return { ok: true, summary: `${cap1(STREETS[s])}: ${log || 'no action yet'}; pot ${round(m.potShow[s])}${m.next === 0 ? `; you to act${m.toCall[s] ? `, facing ${round(m.toCall[s])}` : ''}` : ''}` };
    },
    // One action by the player whose turn it is: fold, check, call, bet, raise or allin (amount = bet/raise-to total).
    act(sc, a) {
      const m = money(sc), s = m.frontier, snap = m.street[s];
      if (!snap || snap.complete) return { ok: false, error: m.ended ? 'The hand is over.' : 'Betting on this street is finished; move to the next street.' };
      const seat = a.seat === undefined || a.seat === null ? snap.next : seatFrom(sc, a.seat);
      if (seat !== snap.next) return { ok: false, error: `It's ${seatName(sc, snap.next)}'s turn, not ${seat < 0 ? a.seat : seatName(sc, seat)}'s.` };
      let type = String(a.action || a.type || '').toLowerCase();
      const ch = choices(sc, seat);
      let to = num(a.amount, 0);
      if (type === 'allin' || type === 'all-in') { type = snap.max > 0 ? 'raise' : 'bet'; to = snap.contrib[seat] + stackOf(sc, seat) - m.contrib[seat]; }
      else if (type === 'small' || type === 'big') { to = ch[type].to; type = snap.max > 0 ? 'raise' : 'bet'; }
      if (!['fold', 'check', 'call', 'bet', 'raise'].includes(type)) return { ok: false, error: 'action must be fold, check, call, bet, raise or allin.' };
      if ((type === 'bet' || type === 'raise') && !to) to = ch.small.to;
      sc.streets[s].actions.push({ seat, type, to, ...(a.auto ? { auto: true } : {}) }); // auto: played by the computer, not seen at a table
      const after = replay(sc);
      if (after.dropped) { sc.streets[s].actions.pop(); return { ok: false, error: 'That action is not possible here.' }; }
      sc.street = s;
      const last = after.streets[s].actions[after.streets[s].actions.length - 1];
      // A scripted street ("UTG raises, SB folds…") continues once you've answered: listed players fold, the rest call.
      const plan = sc.streets[s].plan;
      if (plan && seat !== 0) delete sc.streets[s].plan; // you took over an opponent: drop the script
      else if (plan) {
        for (let guard = 0; guard < 20; guard++) {
          const mm = money(sc), sn = mm.street[s];
          if (mm.frontier !== s || !sn || sn.complete || sn.next === 0) break;
          const owe = sn.max - sn.contrib[sn.next];
          sc.streets[s].actions.push({ seat: sn.next, type: owe > 0 ? (plan.folds.includes(sn.next) ? 'fold' : 'call') : 'check', to: 0 });
        }
        if (money(sc).street[s] && money(sc).street[s].complete) delete sc.streets[s].plan;
      }
      return { ok: true, summary: `${cap1(STREETS[s])}: ${seatName(sc, seat)} ${last.text.toLowerCase()}` };
    },
    // Moves the dealer button to a seat (positions follow); the betting starts over.
    set_button(sc, a) {
      const seat = seatFrom(sc, a.seat); if (seat < 0) return { ok: false, error: `Unknown player "${a.seat}". Use a ${SEAT_HELP}, a name, or a position.` };
      if (seat !== sc.button) { sc.button = seat; resetAction(sc); }
      return { ok: true, summary: `Dealer button on ${seat === 0 ? 'you' : sc.opponents[seat - 1].name}; you're ${POS_NAMES[positions(sc)[0]] === 'button' ? 'on the button' : `in the ${POS_NAMES[positions(sc)[0]]}`}` };
    },
    // Puts the action on a player on the street being bet: if they already acted, it goes back to their turn;
    // otherwise everyone before them folds (preflop, or facing a bet) or checks.
    action_to(sc, a) {
      const seat = seatFrom(sc, a.seat); if (seat < 0) return { ok: false, error: `Unknown player "${a.seat}". Use a ${SEAT_HELP}, a name, or a position.` };
      const m = money(sc), s = m.frontier;
      if (m.ended || s > 3) return { ok: false, error: 'The hand is over; deal a new one first.' };
      if (m.foldedAt[seat] !== null) return { ok: false, error: `${seatName(sc, seat)} has already folded.` };
      const r = moveActionTo(sc, s, seat, a.passive ? 'call' : 'fold');
      if (!r.ok) return r;
      sc.street = s;
      return { ok: true, summary: `${cap1(STREETS[s])}: action on ${seat === 0 ? 'you' : seatName(sc, seat)}${r.log.length ? ` (${r.log.join(', ')})` : ''}` };
    },
    show_street(sc, a) {
      const s = streetFrom(a.street); if (s < 0) return { ok: false, error: 'street must be preflop, flop, turn, river or showdown.' };
      for (let k = 0; k < Math.min(s, 4); k++) { if (replay(sc).ended) break; completeStreet(sc, k); }
      sc.street = Math.min(s, viewLimit(sc)); return { ok: true, summary: `Showing the ${STREETS[sc.street]}` };
    },
    new_hand(sc, a) {
      sc.hero.cards = []; sc.board = []; sc.opponents.forEach(o => { o.cards = null; });
      if (!a.keep_ranges) sc.opponents.forEach(o => { o.range = ''; o.style = ''; o.note = ''; });
      resetAction(sc); sc.deal = Math.floor(Math.random() * 1e9); sc.heroHidden = false;
      return { ok: true, summary: `New hand${a.keep_ranges ? ' (players kept)' : ''}` };
    },
    // The next hand at the same table: stacks as the last hand left them (stacks: [you, seat 1 …], e.g. from
    // settleHand), anyone at zero rebuys for 100 big blinds, the button moves one seat on, players keep their names,
    // styles and notes. Your cards start face down (hidden) until they're set, unless deal_cards.
    next_hand(sc, a) {
      const n = sc.opponents.length, players = [sc.hero].concat(sc.opponents), rebuys = [];
      if (Array.isArray(a.stacks) && a.stacks.length === n + 1) players.forEach((p, i) => { p.stack = Math.max(0, round(num(a.stacks[i], p.stack))); });
      players.forEach(p => { if (!(p.stack > 0)) { p.stack = 100 * sc.bigBlind; rebuys.push(p.name); } });
      sc.button = (sc.button + 1) % (n + 1);
      ops.new_hand(sc, { keep_ranges: true });
      sc.heroHidden = !a.deal_cards; sc.handNo = (sc.handNo || 1) + 1;
      return { ok: true, summary: `Hand ${sc.handNo}: dealer on ${sc.button === 0 ? 'you' : sc.opponents[sc.button - 1].name}${rebuys.length ? `; ${rebuys.join(', ')} rebought for ${round(100 * sc.bigBlind)}` : ''}` };
    },
  };
  // ----- between hands -----
  // Plays out what's left of a hand (opponents with the computer player, you check/call unless you've folded), then pays
  // the pot, side pots included, to the best hands still in. cards: {hero, opps, board (all 5)} as card ints.
  // → {stacks: [you, seat 1 …] after the hand, won: [chips each seat takes], showdown, winners: [seats], played: [text]}
  function settleHand(sc, cards) {
    const w = clone(sc), players = w.opponents.length + 1, played = [];
    for (let guard = 0; guard < 200; guard++) {
      const m = money(w); if (m.ended || m.next === null) break;
      const seat = m.next, snap = m.street[m.frontier];
      const a = seat === 0 ? { action: snap.max > snap.contrib[0] ? 'call' : 'check' } : autoAction(w, seat, cards.opps[seat - 1], cards.board.slice(0, BOARD_N[m.frontier]));
      const r = apply(w, 'act', { seat, action: a.action, amount: a.amount });
      if (!r.ok) break; played.push(r.summary);
    }
    const m = money(w), contrib = m.contrib, won = new Array(players).fill(0);
    const inHand = contrib.map((_, i) => i).filter(i => m.foldedAt[i] === null);
    const hole = i => (i === 0 ? cards.hero : cards.opps[i - 1]);
    let winners = inHand;
    if (inHand.length === 1) won[inHand[0]] = m.potFinal;
    else {
      const val = inHand.map(i => E.evalHand(hole(i).concat(cards.board))), valOf = i => val[inHand.indexOf(i)];
      winners = [];
      const levels = [...new Set(contrib.filter(x => x > 0))].sort((x, y) => x - y);
      let prev = 0;
      for (const L of levels) {
        const part = contrib.reduce((t, x) => t + Math.max(0, Math.min(x, L) - prev), 0);
        const elig = inHand.filter(i => contrib[i] >= L), pool = elig.length ? elig : inHand;
        const best = Math.max(...pool.map(valOf)), top = pool.filter(i => valOf(i) === best);
        top.forEach(i => { won[i] += part / top.length; if (!winners.includes(i)) winners.push(i); });
        prev = L;
      }
    }
    const stacks = contrib.map((c, i) => Math.max(0, round(stackOf(w, i) - c + won[i])));
    return { stacks, won: won.map(round), showdown: inHand.length > 1, winners, played };
  }

  // ----- player stats, hand after hand -----
  // What each player did this hand, from the actions seen or entered (moves the computer made for them don't count).
  // → {name: {name, hands, vpip, pfr, agg (bets and raises after the flop), calls (calls after the flop)}} for players who
  //   made a preflop decision of their own (a fold counts: folding is a decision)
  function handStats(sc) {
    const out = {}, m = money(sc);
    sc.opponents.forEach((o, i) => {
      const seat = i + 1, pre = (sc.streets[0].actions || []).filter(a => a.seat === seat);
      if (!pre.length || pre.some(a => a.auto)) return;
      const post = sc.streets.slice(1).flatMap(st => st.actions.filter(a => a.seat === seat && !a.auto));
      const snap = m.street[0], applied = snap ? snap.actions.filter(a => a.seat === seat) : [];
      out[o.name.toLowerCase()] = {
        name: o.name, hands: 1,
        vpip: applied.some(a => a.type === 'call' || a.type === 'raise' || a.type === 'bet') ? 1 : 0,
        pfr: applied.some(a => a.type === 'raise' || a.type === 'bet') ? 1 : 0,
        agg: post.filter(a => a.type === 'bet' || a.type === 'raise').length, calls: post.filter(a => a.type === 'call').length,
      };
    });
    return out;
  }
  function addStats(book, hs) {
    for (const [k, x] of Object.entries(hs)) {
      const b = book[k] || (book[k] = { name: x.name, hands: 0, vpip: 0, pfr: 0, agg: 0, calls: 0 });
      ['hands', 'vpip', 'pfr', 'agg', 'calls'].forEach(f => { b[f] += x[f]; }); b.name = x.name;
    }
    return book;
  }
  const STATS_MIN = 12; // hands before a style is read from the stats
  // The style the numbers point to (one of the seat editor's styles), or null with too few hands.
  // vpip/pfr: how often they put money in / raise before the flop; af: bets and raises after the flop per call.
  function styleFromStats(b) {
    if (!b || b.hands < STATS_MIN) return null;
    const vpip = b.vpip / b.hands * 100, pfr = b.pfr / b.hands * 100, af = b.agg / Math.max(1, b.calls);
    if (vpip < 15) return 'nit';
    if (vpip >= 45 && pfr >= 25) return 'maniac';
    if (vpip >= 35 && pfr < 12 && af < 1.2) return 'calling station';
    if (vpip <= 24) return 'tight';
    if (vpip >= 32) return pfr >= 20 ? 'maniac' : 'loose';
    return 'regular';
  }
  function statsLine(b) {
    if (!b || !b.hands) return '';
    const p = x => Math.round(x / b.hands * 100);
    return `${b.hands} hand${b.hands > 1 ? 's' : ''} · plays ${p(b.vpip)}% · raises ${p(b.pfr)}% preflop${b.agg + b.calls ? ` · aggression ${(b.agg / Math.max(1, b.calls)).toFixed(1)}` : ''}`;
  }
  // Sets each opponent's style from their stats, unless you set it yourself. → [text] of what changed
  function applyStats(sc, book) {
    const done = [];
    sc.opponents.forEach(o => {
      if (o.styleBy === 'you' || o.range) return;
      const st = styleFromStats(book[o.name.toLowerCase()]);
      if (st && st !== o.style) { o.style = st; o.styleBy = 'stats'; done.push(`${o.name}: ${st}`); }
    });
    return done;
  }

  // ----- matching the table on camera ("Sync table") -----
  // T = a whole-table reading (server normalizeTable): seats from you, clockwise, the same order as this table's seats.
  // Only the parts read clearly are offered. → [{id, text}] of what would change on this table.
  function syncPlan(sc, T) {
    const out = [];
    if (!T || !T.readable || !T.readable.seats) return out;
    const n = T.seats.length - 1, same = n === sc.opponents.length, m = money(sc), r = x => fmt(sc, x);
    const bb = T.readable.stacks && T.blinds ? T.blinds.big : sc.bigBlind, k = T.unit === 'bb' ? bb : 1;
    const nameAt = i => (i === 0 ? 'You' : (T.readable.names && T.seats[i].name) || (same ? sc.opponents[i - 1].name : `seat ${i}`));
    if (T.blinds && (Math.abs(T.blinds.small - sbOf(sc)) > 1e-9 || Math.abs(T.blinds.big - sc.bigBlind) > 1e-9)) out.push({ id: 'blinds', text: `Blinds ${round(sbOf(sc))}/${round(sc.bigBlind)} → ${round(T.blinds.small)}/${round(T.blinds.big)}` });
    if (!same) out.push({ id: 'players', text: `Players: ${sc.opponents.length + 1} → ${n + 1}` });
    if (T.readable.names) for (let i = 1; i <= n; i++) {
      const now = same || i <= sc.opponents.length ? sc.opponents[i - 1].name : '';
      if (T.seats[i].name && T.seats[i].name !== now) out.push({ id: `name:${i}`, text: now ? `Seat ${i}: ${now} → ${T.seats[i].name}` : `Seat ${i}: ${T.seats[i].name}` });
    }
    const d = T.seats.findIndex(x => x.dealer);
    if (d >= 0 && (d !== sc.button || !same)) out.push({ id: 'dealer', text: `Dealer button: ${d === 0 ? 'you' : nameAt(d)}` });
    if (T.readable.stacks) for (let i = 0; i <= n; i++) {
      // the stack at the start of this hand = what's left behind + what this player has put in (as this table has it,
      // or the chips in front of them when the seats are new)
      const start = round(T.seats[i].stack * k + (same ? m.contrib[i] : T.seats[i].bet * k)), was = same ? stackOf(sc, i) : null;
      if (was === null || Math.abs(start - was) > 0.005) out.push({ id: `stack:${i}`, text: `${nameAt(i)}: stack ${was === null ? '' : `${r(was)} → `}${r(start)}` });
    }
    return out;
  }
  // Applies the picked lines of syncPlan (ids). Players whose names match keep their style, range and notes.
  function applySync(sc, T, ids) {
    const pick = new Set(ids), n = T.seats.length - 1, done = [];
    const bb = T.readable.stacks && T.blinds ? T.blinds.big : sc.bigBlind, k = T.unit === 'bb' ? bb : 1;
    if (pick.has('blinds')) { apply(sc, 'setup_table', { small_blind: T.blinds.small, big_blind: T.blinds.big }); done.push('blinds'); }
    const before = money(sc), same = n === sc.opponents.length;
    if (pick.has('players')) {
      const old = sc.opponents.slice();
      apply(sc, 'setup_table', { opponents: n });
      for (let i = 1; i <= n; i++) {
        const nm = T.readable.names && T.seats[i].name, match = nm && old.find(o => o.name.toLowerCase() === nm.toLowerCase());
        if (match) sc.opponents[i - 1] = { ...match, cards: null };
      }
      done.push(`${n + 1} players`);
    }
    for (let i = 1; i <= n; i++) {
      if (!pick.has(`name:${i}`)) continue;
      const nm = T.seats[i].name, o = sc.opponents[i - 1];
      const j = sc.opponents.findIndex(x => x !== o && x.name.toLowerCase() === nm.toLowerCase());
      if (j >= 0) { const q = sc.opponents[j]; sc.opponents[i - 1] = { ...q, stack: o.stack }; sc.opponents[j] = { ...o, stack: q.stack }; } // a known player in another seat: their notes and style move with them (stacks are read seat by seat)
      sc.opponents[i - 1].name = nm.slice(0, 24); done.push(`seat ${i} ${nm}`);
    }
    // names must stay unique
    const seen = new Set(); sc.opponents.forEach((o, i) => { o.name = o.name.trim(); if (seen.has(o.name.toLowerCase())) o.name = `${o.name} ${i + 1}`; seen.add(o.name.toLowerCase()); });
    if (pick.has('dealer')) { const d = T.seats.findIndex(x => x.dealer); apply(sc, 'set_button', { seat: d }); done.push('dealer'); }
    for (let i = 0; i <= n; i++) {
      if (!pick.has(`stack:${i}`)) continue;
      const v = round(T.seats[i].stack * k + (same && !pick.has('players') ? before.contrib[i] : T.seats[i].bet * k));
      if (i === 0) sc.hero.stack = v; else sc.opponents[i - 1].stack = v;
      done.push(`${i === 0 ? 'your' : sc.opponents[i - 1].name + "'s"} stack`);
    }
    return done;
  }
  // The betting part of a whole-table reading in the form followBetting reads, using this table's positions.
  function syncBetting(sc, T) {
    if (!T.readable.betting || T.seats.length !== sc.opponents.length + 1) return null;
    const pos = positions(sc), seats = {};
    T.seats.forEach((x, i) => { seats[pos[i]] = { folded: x.folded, bet: x.bet, last: x.last }; });
    return { players: pos.length, heroPosition: pos[0], toAct: T.toAct === null ? null : pos[T.toAct], unit: T.unit, seats };
  }

  // ----- following the table live (the camera's whole-table readings) -----
  // T: a whole-table reading (seats from you, clockwise; bet in front, folded, latest action, whose turn). street: the
  // street the picture shows. On a copy: players who were filled in as calling an earlier street but are shown folded
  // become folds; earlier streets are finished (folded players fold, the rest check or call); then on this street each
  // player goes to the chips in front of them, in turn order, until it's the shown player's turn. A seat whose chips
  // don't add up stops the replay there (what came before is kept). → {ok, sc, log, partial} or {ok: false, error}
  function trackTable(sc, T, street) {
    const w = clone(sc), players = w.opponents.length + 1, log = [];
    if (!T || !T.seats || T.seats.length !== players) return { ok: false, error: `the camera shows ${T && T.seats ? T.seats.length : 0} players, this table has ${players}` };
    const k = T.unit === 'bb' ? w.bigBlind : 1, seen = T.seats.map(x => ({ ...x, bet: x.bet * k }));
    const near = (a, b) => Math.abs(a - b) < 0.01 * Math.max(1, w.bigBlind) + 1e-9;
    // folds the camera saw that the table filled in as calls
    let repaired = false;
    seen.forEach((x, seat) => {
      if (!x.folded) return;
      const m0 = money(w); if (m0.foldedAt[seat] !== null) return;
      for (let s = 0; s < Math.min(street, 4); s++) {
        const acts = w.streets[s].actions, mine = acts.filter(a => a.seat === seat);
        if (!mine.length || !mine.every(a => a.filled)) continue;
        const i = acts.indexOf(mine[0]); acts[i] = { seat, type: 'fold', to: 0 };
        for (let j = acts.length - 1; j > i; j--) if (acts[j].seat === seat) acts.splice(j, 1);
        for (let t = s + 1; t < 4; t++) w.streets[t].actions = w.streets[t].actions.filter(a => a.seat !== seat);
        repaired = true; log.push(`${seatName(w, seat)} folded on the ${STREETS[s]}`); break;
      }
    });
    if (repaired && replay(w).dropped) return { ok: false, error: 'the earlier betting no longer adds up' };
    const act = (seat, action, amount) => { const r = apply(w, 'act', { seat, action, amount }); if (r.ok) log.push(r.summary.replace(/^\w+: /, '')); return r.ok; };
    let partial = false;
    for (let guard = 0; guard < 80; guard++) {
      const m = money(w);
      if (m.ended || m.frontier > street || m.next === null) break;
      const s = m.frontier, snap = m.street[s], seat = m.next, x = seen[seat];
      if (s < street) { if (!act(seat, x.folded ? 'fold' : snap.max > snap.contrib[seat] ? 'call' : 'check')) { partial = true; break; } continue; }
      if (T.toAct === seat) break; // their turn now
      if (T.toAct === null && (x.last === 'none' || x.last === 'post') && !x.folded) break; // not acted yet
      if (x.folded) { if (!act(seat, 'fold')) { partial = true; break; } continue; }
      if (x.bet > snap.max && !near(x.bet, snap.max)) { if (!act(seat, snap.max > 0 ? 'raise' : 'bet', x.bet)) { partial = true; break; } continue; }
      if (near(x.bet, snap.max) || (x.stack === 0 && x.bet > snap.contrib[seat])) { if (!act(seat, snap.max > snap.contrib[seat] ? 'call' : 'check')) { partial = true; break; } continue; }
      partial = true; break; // fewer chips in than the bet and not all-in: not acted yet, or a misread; stop here
    }
    // the result must agree with the picture where both say something
    const m = money(w);
    if (!m.ended && m.frontier === street && !partial) {
      const snap = m.street[street];
      for (let seat = 0; seat < players; seat++) {
        const x = seen[seat];
        if (x.folded && m.foldedAt[seat] === null) return { ok: false, error: `${seatName(w, seat)} is shown folded but works out still in` };
        if (!x.folded && m.foldedAt[seat] !== null && m.foldedAt[seat] <= street) return { ok: false, error: `${seatName(w, seat)} is shown in the hand but works out folded` };
        // everyone who has acted on this street shows the chips this table has them putting in
        if (!x.folded && snap.actions.some(a => a.seat === seat) && !near(snap.contrib[seat], x.bet) && !(x.stack === 0)) return { ok: false, error: `${seatName(w, seat)} shows ${round(x.bet)} in front, this table has ${round(snap.contrib[seat])}` };
      }
      if (T.toAct !== null && m.next !== null && m.next !== T.toAct) return { ok: false, error: `it should be ${seatName(w, T.toAct)}'s turn but works out to ${seatName(w, m.next)}'s` };
    }
    return { ok: true, sc: w, log, partial, repaired };
  }
  // When the camera and this table disagree, the camera wins: the street on the picture is rebuilt from the picture
  // alone (its actions are dropped and replayed from the chips, folds and whose turn); if that still doesn't fit, the
  // whole hand is rebuilt (earlier streets: folded players fold, the rest call), but only when the pot then matches.
  // → {ok, sc, log, scope: 'street'|'hand'} or {ok: false, error}
  function rebuildFrom(sc, T, street) {
    const tryFrom = from => {
      const w = clone(sc);
      for (let s = from; s < 4; s++) w.streets[s] = blankStreet();
      w.street = Math.min(w.street, from);
      return trackTable(w, T, street);
    };
    const a = tryFrom(street);
    if (a.ok && !a.partial) return { ...a, scope: 'street' };
    if (street > 0) {
      const b = tryFrom(0);
      const k = T.unit === 'bb' ? sc.bigBlind : 1;
      if (b.ok && T.pot && Math.abs(money(b.sc).potShow[Math.min(street, 3)] - T.pot * k) < 0.01 * Math.max(1, sc.bigBlind) + 1e-9) return { ...b, scope: 'hand' };
    }
    if (a.ok) return { ...a, scope: 'street' };
    return { ok: false, error: a.error };
  }

  // ----- following the betting a camera saw -----
  // seen: {players, heroPosition, toAct, unit, seats: {POS: {folded, bet (chips in on this street), last}}}; street = the
  // street the picture shows (0 preflop … 3 river). On a copy, plays the actions this table is missing, in turn order:
  // earlier streets are finished first (anyone shown folded folds, the rest check or call), then on this street each
  // player goes to the chips in front of them (fold / check / call / bet or raise) until it's the shown player's turn.
  // The copy is kept only if it matches the picture: each seat's latest action and whose turn it is.
  // → {ok: true, sc, log: [text]} or {ok: false, error}
  function followBetting(sc, seen, street) {
    const w = clone(sc), pos = positions(w), players = pos.length, log = [];
    if (!seen || !seen.seats) return { ok: false, error: 'no betting in the reading' };
    if (seen.players !== players || seen.heroPosition !== pos[0]) return { ok: false, error: `the table on camera has ${seen.players} players with you in ${seen.heroPosition}; this one has ${players} with you in ${pos[0]}` };
    const k = seen.unit === 'bb' ? w.bigBlind : 1, info = seat => { const x = seen.seats[pos[seat]]; return x && { ...x, bet: x.bet * k }; };
    const near = (a, b) => Math.abs(a - b) < 0.01 * Math.max(1, w.bigBlind);
    const act = (seat, action, amount) => { const r = apply(w, 'act', { seat, action, amount }); if (r.ok) log.push(r.summary.replace(/^\w+: /, '')); return r.ok; };
    const stuck = seat => ({ ok: false, error: `couldn't play ${pos[seat]}'s action` });
    for (let guard = 0; guard < 80; guard++) {
      const m = money(w);
      if (m.ended || m.frontier > street || m.next === null) break;
      const s = m.frontier, snap = m.street[s], seat = m.next, x = info(seat);
      if (!x) return { ok: false, error: `no reading for ${pos[seat]}` };
      if (s < street) { if (!act(seat, x.folded ? 'fold' : snap.max > snap.contrib[seat] ? 'call' : 'check')) return stuck(seat); continue; }
      if (pos[seat] === seen.toAct || x.last === 'none' || x.last === 'post') break; // their turn, or they haven't acted yet
      if (x.folded || x.last === 'fold') { if (!act(seat, 'fold')) return stuck(seat); continue; }
      if (x.bet > snap.max && !near(x.bet, snap.max)) { if (!act(seat, snap.max > 0 ? 'raise' : 'bet', x.bet)) return stuck(seat); continue; }
      if (near(x.bet, snap.max) || x.last === 'all-in') { if (!act(seat, snap.max > snap.contrib[seat] ? 'call' : 'check')) return stuck(seat); continue; }
      return { ok: false, error: `${pos[seat]} shows ${round(x.bet)} in, less than the ${round(snap.max)} to call` };
    }
    // check the result against the picture
    const m = money(w);
    if (!m.ended && m.frontier === street) {
      const snap = m.street[street];
      for (let seat = 0; seat < players; seat++) {
        const x = info(seat); if (!x) continue;
        const shown = x.last === 'bet' ? 'raise' : x.last;
        if (shown === 'fold') { if (m.foldedAt[seat] === null) return { ok: false, error: `${pos[seat]} is shown folded but works out still in` }; continue; }
        if (!['check', 'call', 'raise'].includes(shown)) continue;
        const mine = snap.actions.filter(a => a.seat === seat).pop(), t = mine ? (mine.type === 'bet' ? 'raise' : mine.type) : null;
        if (t !== shown && !(mine && mine.allIn)) return { ok: false, error: `${pos[seat]} shows "${x.last}" but the betting works out to ${t ? `"${t}"` : 'nothing yet'}` };
      }
      if (seen.toAct && m.next !== pos.indexOf(seen.toAct)) return { ok: false, error: `it should be ${seen.toAct}'s turn but works out to ${m.next === null ? 'nobody' : pos[m.next]}'s` };
    }
    return { ok: true, sc: w, log };
  }

  function apply(sc, name, args) {
    if (!ops[name]) return { ok: false, error: `Unknown action ${name}` };
    try { return ops[name](sc, args || {}); } catch (e) { return { ok: false, error: e.message }; }
  }

  // ----- reading a scenario -----
  // The live opponents at street s as engine inputs.
  // The live opponents at street s as engine inputs: known cards, or your read on them (weighted hands).
  function engineOpponent(sc, seat, s) {
    const o = sc.opponents[seat - 1];
    return o.cards ? { cards: o.cards.map(E.cardFromCode) } : { combos: readOf(sc, seat, s).combos };
  }
  function engineOpponents(sc, s) {
    const m = money(sc);
    return m.liveAfter[Math.min(s, 3)].filter(x => x > 0).map(seat => engineOpponent(sc, seat, s));
  }
  // Plain-text description for the agent (and for debugging). Only what you'd know at the table: no hidden cards.
  function summary(sc) {
    const pos = positions(sc), m = money(sc), view = Math.min(sc.street, 3), inf = inferredRanges(sc, m);
    const behind = seat => round(stackOf(sc, seat) - m.contrib[seat]);
    const lines = [];
    lines.push(`Blinds ${round(sbOf(sc))}/${round(sc.bigBlind)}. ${sc.opponents.length} opponents. Dealer button: ${sc.button === 0 ? 'you' : `seat ${sc.button}`}. Showing: ${STREETS[sc.street]}.`);
    lines.push(`Seat 0 You (${pos[0]}): cards ${sc.heroHidden ? 'not known yet (face down until the camera reads them or the user picks them)' : sc.hero.cards.length ? sc.hero.cards.join(' ') : 'not chosen (random)'}, ${behind(0)} behind${m.foldedAt[0] !== null ? `, FOLDED on the ${STREETS[m.foldedAt[0]]}` : ''}.`);
    sc.opponents.forEach((o, i) => {
      const seat = i + 1, f = m.foldedAt[seat];
      lines.push(`Seat ${seat} ${o.name} (${pos[seat]}): ${seatRangeLabel(sc, seat, inf)}${o.style && o.range ? `, style ${o.style}` : ''}, ${behind(seat)} behind${f !== null ? `, FOLDED on the ${STREETS[f]}` : ''}${o.note ? `. Note: ${o.note}` : ''}.`);
    });
    lines.push(`Board known: ${sc.board.length ? sc.board.join(' ') : 'none yet'}${sc.board.length < BOARD_N[sc.street] ? ` (the rest of the ${STREETS[sc.street]} board is dealt at random)` : ''}.`);
    for (let k = 0; k <= 3; k++) {
      const snap = m.street[k]; if (!snap) break;
      const log = snap.actions.map(x => `${x.seat === 0 ? 'You' : `seat ${x.seat} ${sc.opponents[x.seat - 1].name}`} ${x.text.toLowerCase()}`).join('; ');
      lines.push(`${STREETS[k]} (pot ${round(snap.start)} at start): ${log || 'no action yet'}${snap.complete ? '' : '. Betting still open'}.`);
    }
    if (m.ended) lines.push(`Hand over: everyone else folded; ${m.ended.winner === 0 ? 'you win' : `${sc.opponents[m.ended.winner - 1].name} wins`} the pot of ${round(m.potFinal)}.`);
    else if (m.next !== null) lines.push(`Now: ${m.next === 0 ? 'YOUR turn' : `seat ${m.next} ${sc.opponents[m.next - 1].name}'s turn`} on the ${STREETS[m.frontier]}; pot ${round(m.potShow[m.frontier])}${m.next === 0 ? `, you face ${round(m.toCall[m.frontier])}` : ''}.`);
    else lines.push(m.frontier === 4 ? 'All betting is done: showdown.' : `Betting on the ${STREETS[m.frontier]} is done.`);
    return lines.join('\n');
  }

  // What the preflop charts need to know about the spot for `seat` (hole = card ints): raises so far, limpers, callers,
  // who raised and from where, the price and the stack.
  function preflopCtx(sc, seat, hole, m) {
    m = m || money(sc);
    const snap = m.street[0], players = sc.opponents.length + 1, pos = positions(sc), { pre, post } = orders(sc);
    let raises = 0, first = null, last = null, limpers = 0, callers = 0, sbIn = false;
    for (const a of snap.actions) {
      if (a.type === 'raise' || a.type === 'bet') { raises++; if (first === null) first = a.seat; last = a.seat; callers = 0; }
      else if (a.type === 'call') { if (raises === 0) { limpers++; if (pos[a.seat] === 'SB') sbIn = true; } else if (a.seat !== seat) callers++; }
    }
    const info = x => {
      if (x === null) return null;
      const r = x > 0 ? effRange(sc.opponents[x - 1]) : '';
      return { seat: x, behind: players - 1 - pre.indexOf(x), pct: r ? E.rangeOf(r).pct : null, name: seatName(sc, x), pos: pos[x], blind: pos[x] === 'SB' || pos[x] === 'BB' };
    };
    return {
      label: E.handLabel(hole[0], hole[1]), players, pos: pos[seat], behind: players - 1 - pre.indexOf(seat), bb: sc.bigBlind,
      raises, max: snap.max, toCall: Math.max(0, snap.max - snap.contrib[seat]), stackLeft: Math.max(0, stackOf(sc, seat) - m.contrib[seat]),
      heroRaisedLast: last === seat && !snap.complete && snap.next !== seat, heroOpened: first === seat, limpers, callers, sbIn,
      raiser: info(last), inPositionVsRaiser: last !== null && post.indexOf(seat) > post.indexOf(last), fmt: x => fmt(sc, x),
    };
  }

  // "What you should do" for you at street s. hero/board are card ints (board = cards visible at s); eq = the engine's
  // equity for the same spot. On your turn it's the advice for this decision; before your turn it's a preview of the
  // likely decisions ("if it folds to you…", "if someone raises…").
  function recommendation(sc, s, hero, board, eq) {
    const m = money(sc);
    if (m.foldedAt[0] !== null) return { action: 'wait', label: 'You folded', gauge: 0, reasons: ['You are out of this hand. Deal the next hand, or use Undo to take the fold back.'], note: '' };
    if (s === m.frontier && s < 4 && !m.ended && m.next !== null && m.next !== 0) return preview(sc, s, hero, board, eq, m);
    return advise(sc, s, hero, board, eq, m);
  }
  function advise(sc, s, hero, board, eq, m) {
    const pos = positions(sc), players = sc.opponents.length + 1, { pre, post } = orders(sc), s3 = Math.min(s, 3);
    const snap = m.street[s3], inf = inferredRanges(sc, m);
    const live = m.liveAfter[s3].filter(x => x > 0);
    const inPosition = live.every(x => post.indexOf(0) > post.indexOf(x));
    const lastAgg = snap ? snap.lastAgg : null;
    let agg = lastAgg === null ? 'none' : lastAgg === 0 ? 'hero' : 'opp';
    if (agg === 'hero' && snap && snap.complete) agg = 'none'; // "your bet stands" only while others still have to answer it
    const set = live.filter(x => { const o = sc.opponents[x - 1]; return o.cards || effRange(o); }).length;
    const guessed = live.filter(x => !sc.opponents[x - 1].cards && !effRange(sc.opponents[x - 1]) && inf[x]).length;
    const ctx = {
      street: s3, hero, board, eq, live: live.length, players, position: pos[0], behind: players - 1 - pre.indexOf(0), inPosition,
      toCall: m.toCall[s3], pot: m.potShow[s3], bb: sc.bigBlind, aggressor: agg, bet: snap ? snap.max : 0,
      station: live.some(x => /station|fish/.test(sc.opponents[x - 1].style || '')),
      rangesSet: set + guessed > 0, fmt: x => fmt(sc, x),
      note: set + guessed === 0 ? 'Opponents are treated as random hands. Give them a range or style for sharper advice.'
        : '',
    };
    if (s3 === 0 && snap) ctx.pre = PS.preflop(preflopCtx(sc, 0, hero, m));
    if (s3 > 0 && snap && !snap.complete && agg !== 'hero' && EV && board.length >= 3) ctx.ev = evFor(sc, s3, hero, board, m, live, post);
    return E.recommend(ctx);
  }
  // What each choice is worth for you now (ev.js), against each live opponent's read and style. Memoized: the panel
  // redraws often, and the same spot always gives the same numbers (the sampling is seeded by the spot).
  const evMemo = new Map();
  function evFor(sc, s, hero, board, m, live, post) {
    const snap = m.street[s], key = JSON.stringify([sc.streets, sc.opponents.map(o => [o.style, o.range, o.cards, o.stack]), sc.hero.stack, sc.button, sc.bigBlind, hero, board, s]);
    if (evMemo.has(key)) return evMemo.get(key);
    const ch = choices(sc, 0), unit = sc.bigBlind >= 2 ? 1 : sbOf(sc) < 0.5 ? 0.25 : 0.5;
    let seed = 7; for (let i = 0; i < key.length; i++) seed = (Math.imul(seed, 31) + key.charCodeAt(i)) | 0;
    const res = EV.evaluate({
      hero, board, street: s, pot: m.potShow[s], toCall: m.toCall[s], max: snap.max, heroIn: snap.contrib[0], heroBehind: Math.max(0, stackOf(sc, 0) - m.contrib[0]),
      minTo: ch ? ch.minTo : snap.max * 2, maxTo: ch ? ch.maxTo : Infinity, unit, inPosition: live.every(x => post.indexOf(0) > post.indexOf(x)),
      opps: live.map(seat => ({ ...engineOpponent(sc, seat, s), mods: RG.modsFor(sc.opponents[seat - 1].style), in: snap.contrib[seat], behind: Math.max(0, stackOf(sc, seat) - m.contrib[seat]), after: post.indexOf(seat) > post.indexOf(0) })),
      samples: 2500, seed,
    });
    if (evMemo.size > 200) evMemo.clear();
    evMemo.set(key, res);
    return res;
  }
  function preview(sc, s, hero, board, eq, m) {
    const snap = m.street[s], next = m.next, items = [];
    const heroActed = snap.actions.some(a => a.seat === 0), heroBet = snap.lastAgg === 0;
    const isBB = s === 0 && positions(sc)[0] === 'BB';
    const tryIt = (when, prep) => {
      const w = clone(sc);
      if (!prep(w)) return;
      const mm = money(w);
      if (mm.ended || mm.frontier !== s || mm.next !== 0) return;
      items.push({ when: typeof when === 'function' ? when(w, mm) : when, ...advise(w, s, hero, board, eq, mm) });
    };
    // 1) the players before you fold (or, in the big blind, just call) or check
    if (!heroActed) {
      const passive = isBB && snap.lastAgg === null;
      tryIt(passive ? 'If everyone just calls' : s > 0 && snap.max === 0 ? 'If it\'s checked to you' : snap.lastAgg === null ? 'If it folds to you' : 'If the rest fold to you',
        w => moveActionTo(w, s, 0, passive ? 'call' : 'fold').ok);
    }
    // 2) the next player bets or raises and the rest fold to you
    tryIt((w, mm) => { const a = mm.street[s].actions.find(x => x.seat === next && (x.type === 'bet' || x.type === 'raise')); return `If ${seatName(sc, next)} ${a ? a.text.toLowerCase() : 'bets'}`; },
      w => apply(w, 'act', { seat: next, action: 'small' }).ok && moveActionTo(w, s, 0, 'fold').ok);
    const main = items[0];
    const line = it => `${it.when}: ${it.label}${it.sizeText ? ' ' + it.sizeText : ''}${it.close ? ' (close)' : ''}.`;
    const reasons = [];
    if (heroBet) reasons.push(`You ${snap.actions.filter(a => a.seat === 0).pop().text.toLowerCase()}; ${seatName(sc, next)} is next to act.`);
    else reasons.push(`It's ${seatName(sc, next)}'s turn. Here's what to do when the action reaches you:`);
    items.forEach(it => reasons.push(line(it)));
    return {
      action: 'wait', label: heroBet ? 'Your bet stands' : 'Not your turn yet', size: null, sizeText: '', close: false,
      gauge: main ? main.gauge : 50, reasons, note: main ? main.note : '',
      preview: items.map(it => ({ when: it.when, action: it.action, label: it.label, size: it.size, sizeText: it.sizeText, close: it.close, gauge: it.gauge, reasons: it.reasons })),
    };
  }

  return { STREETS, BOARD_N, NAMES, POS, POS_NAMES, create, normalize, positions, seatOfPosition, blindOf, money, replay, choices, orders, viewLimit, completeStreet, autoAction, liveOpponents, engineOpponents, effRange, rangeLabel, inferredRanges, likelyRange, seatRangeLabel, readOf, engineOpponent, preflopCtx, apply, ops: Object.keys(ops), summary, clone, prettyList, seatFrom, seatName, recommendation, followBetting, trackTable, rebuildFrom, settleHand, syncPlan, applySync, syncBetting, handStats, addStats, styleFromStats, statsLine, applyStats, STATS_MIN, setUnit, getUnit, fmt };
});
