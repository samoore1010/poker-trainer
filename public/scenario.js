// The scenario: one JSON record describing a hand — table, players, positions, stacks, known cards, ranges,
// the action on each street, and which street is on screen. The table, the stats and the agent all read and write it.
// Shared by the browser (window.PokerScenario) and the server (require). Cards are codes like "Ah", "Tc".
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const api = factory(node ? require('./engine.js') : root.PokerEngine, node ? require('./strategy.js') : root.PokerStrategy);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PokerScenario = api;
})(typeof self !== 'undefined' ? self : this, function (E, PS) {
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
      v: 2, bigBlind: bb, smallBlind: opts.smallBlind != null ? clamp(num(opts.smallBlind, bb / 2), 0, bb) : bb / 2, button: n - 1, street: 0, deal: Math.floor(Math.random() * 1e9),
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
      });
    });
    const streets = Array.isArray(src.streets) ? src.streets : [];
    const TYPES = ['fold', 'check', 'call', 'bet', 'raise'];
    sc.streets = [0, 1, 2, 3].map(s => {
      const st = streets[s] && typeof streets[s] === 'object' ? streets[s] : {};
      const actions = (Array.isArray(st.actions) ? st.actions : []).filter(a => a && TYPES.includes(a.type)).map(a => ({ seat: Math.round(num(a.seat, -1)), type: a.type, to: Math.max(0, num(a.to, 0)) })).filter(a => a.seat >= 0 && a.seat <= n);
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
  function seatRangeLabel(sc, seat, inf) {
    const o = sc.opponents[seat - 1];
    if (o.cards || effRange(o)) return rangeLabel(o);
    const x = (inf || inferredRanges(sc))[seat];
    return x ? `${x.label}: likely about ${Math.round(x.pct)}% of hands` : 'random hand';
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
      sc.streets[s].actions.push({ seat: snap.next, type: snap.max > snap.contrib[snap.next] ? 'call' : 'check', to: 0 });
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
    const style = (o && o.style) || '', loose = /station|fish|maniac|loose|lag/.test(style), aggro = /maniac|lag|aggressive/.test(style);
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
    const d = E.describe(hole, board), outs = E.drawOuts(hole, board).outs;
    const strong = !d.shared && d.c >= 3, medium = !d.shared && d.c >= 1 && !strong, drawing = outs >= 8;
    if (owe <= 0) {
      if (strong) return { action: rnd < 0.6 ? 'big' : 'small' };
      if (medium && rnd < (aggro ? 0.7 : 0.45)) return { action: 'small' };
      if (drawing && rnd < 0.35) return { action: 'small' };
      if (!medium && rnd < (aggro ? 0.25 : 0.08)) return { action: 'small' };
      return { action: 'check' };
    }
    const price = owe / (pot + owe);
    if (strong) return { action: rnd < 0.35 ? 'small' : 'call' };
    if (medium) return { action: price < (loose ? 0.45 : 0.33) || rnd < 0.25 ? 'call' : 'fold' };
    if (drawing) return { action: price < 0.3 ? 'call' : 'fold' };
    return { action: loose && rnd < 0.4 ? 'call' : aggro && rnd < 0.1 ? 'small' : 'fold' };
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
      if (a.style !== undefined) { const st = String(a.style || '').toLowerCase().trim(); if (st && E.STYLES[st] === undefined) return { ok: false, error: `Style must be one of: ${Object.keys(E.STYLES).join(', ')}.` }; o.style = st; out.push(st ? `style ${st}` : 'no style'); }
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
      sc.streets[s].actions.push({ seat, type, to });
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
      resetAction(sc); sc.deal = Math.floor(Math.random() * 1e9);
      return { ok: true, summary: `New hand${a.keep_ranges ? ' (players kept)' : ''}` };
    },
  };
  function apply(sc, name, args) {
    if (!ops[name]) return { ok: false, error: `Unknown action ${name}` };
    try { return ops[name](sc, args || {}); } catch (e) { return { ok: false, error: e.message }; }
  }

  // ----- reading a scenario -----
  // The live opponents at street s as engine inputs.
  function engineOpponents(sc, s) {
    const m = money(sc), inf = inferredRanges(sc, m);
    return m.liveAfter[Math.min(s, 3)].filter(x => x > 0).map(seat => { const o = sc.opponents[seat - 1]; return o.cards ? { cards: o.cards.map(E.cardFromCode) } : { range: likelyRange(sc, seat, inf) }; });
  }
  // Plain-text description for the agent (and for debugging). Only what you'd know at the table: no hidden cards.
  function summary(sc) {
    const pos = positions(sc), m = money(sc), view = Math.min(sc.street, 3), inf = inferredRanges(sc, m);
    const behind = seat => round(stackOf(sc, seat) - m.contrib[seat]);
    const lines = [];
    lines.push(`Blinds ${round(sbOf(sc))}/${round(sc.bigBlind)}. ${sc.opponents.length} opponents. Dealer button: ${sc.button === 0 ? 'you' : `seat ${sc.button}`}. Showing: ${STREETS[sc.street]}.`);
    lines.push(`Seat 0 You (${pos[0]}): cards ${sc.hero.cards.length ? sc.hero.cards.join(' ') : 'not chosen (random)'}, ${behind(0)} behind${m.foldedAt[0] !== null ? `, FOLDED on the ${STREETS[m.foldedAt[0]]}` : ''}.`);
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
    if (m.foldedAt[0] !== null) return { action: 'wait', label: 'You folded', gauge: 0, reasons: ['You are out of this hand. Deal a new one, or use Undo to take the fold back.'], note: '' };
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
        : guessed ? 'Opponents\' likely hands are estimated from their preflop actions. Set a range or style on a player to override.' : '',
    };
    if (s3 === 0 && snap) ctx.pre = PS.preflop(preflopCtx(sc, 0, hero, m));
    return E.recommend(ctx);
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

  return { STREETS, BOARD_N, NAMES, POS, POS_NAMES, create, normalize, positions, seatOfPosition, blindOf, money, replay, choices, orders, viewLimit, completeStreet, autoAction, liveOpponents, engineOpponents, effRange, rangeLabel, inferredRanges, likelyRange, seatRangeLabel, preflopCtx, apply, ops: Object.keys(ops), summary, clone, prettyList, seatFrom, seatName, recommendation, setUnit, getUnit, fmt };
});
