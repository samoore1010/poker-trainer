// The scenario: one JSON record describing a hand — table, players, positions, stacks, known cards, ranges,
// the action on each street, and which street is on screen. The table, the stats and the agent all read and write it.
// Shared by the browser (window.PokerScenario) and the server (require). Cards are codes like "Ah", "Tc".
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('./engine.js') : root.PokerEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PokerScenario = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
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

  // auto: true marks action the app made up (re-rolled when earlier streets change); edits make it false.
  function blankStreet(auto = true) { return { aggressor: null, amount: 0, folds: [], auto }; }
  function defaultOpponent(i, stack) { return { name: NAMES[i % NAMES.length], stack, cards: null, range: '', style: '', note: '' }; }

  // A fresh table. Hero is seat 0; opponents are seats 1..n in clockwise order. Hero starts in the big blind.
  function create(opts = {}) {
    const n = clamp(Math.round(num(opts.opponents, 5)), 1, 8), stack = Math.max(1, num(opts.stack, 200)), bb = Math.max(0.02, num(opts.bigBlind, 2));
    const names = E.shuffle(NAMES.slice());
    const sc = {
      v: 1, bigBlind: bb, button: n - 1, street: 0, deal: Math.floor(Math.random() * 1e9),
      hero: { name: 'You', stack, cards: [] },
      opponents: Array.from({ length: n }, (_, i) => ({ ...defaultOpponent(i, stack), name: names[i], stack: opts.randomStacks === false ? stack : stack - 50 + E.rnd(11) * 10 })),
      board: [],
      streets: [blankStreet(), blankStreet(), blankStreet(), blankStreet()],
      note: '',
    };
    sc.streets[0].amount = bb; sc.streets[0].auto = false;
    randomizeAction(sc);
    return sc;
  }

  // Default action like a home game: everyone limps, then on each street one opponent bets 1/3–full pot and the rest call.
  function randomizeAction(sc, from = 1) {
    for (let s = from; s <= 3; s++) {
      if (sc.streets[s].auto === false) continue;
      const m = money(sc);
      const live = m.liveAfter[s - 1].filter(x => x > 0);
      const behind = seat => (seat === 0 ? sc.hero.stack : sc.opponents[seat - 1].stack) - m.contribAt[s - 1][seat];
      const cap = Math.min(behind(0), ...m.liveAfter[s - 1].map(behind));
      if (!live.length || cap < 1) { sc.streets[s] = blankStreet(); continue; }
      const who = live[E.rnd(live.length)];
      sc.streets[s] = { aggressor: who, amount: Math.max(1, Math.min(cap, Math.round(m.potStart[s] * [0.33, 0.5, 0.66, 1][E.rnd(4)]))), folds: [], auto: true };
    }
    return sc;
  }

  // Cleans any incoming object (from the agent or the browser) into a valid scenario, with notes on what was fixed.
  function normalize(input) {
    const fixes = [];
    const src = input && typeof input === 'object' ? input : {};
    const opps = Array.isArray(src.opponents) && src.opponents.length ? src.opponents.slice(0, 8) : create().opponents;
    const n = opps.length;
    const bb = Math.max(0.02, num(src.bigBlind, 2));
    const sc = {
      v: 1, bigBlind: bb, button: ((Math.round(num(src.button, n - 1)) % (n + 1)) + n + 1) % (n + 1),
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
    for (let s = 0; s < 4; s++) {
      const st = streets[s] && typeof streets[s] === 'object' ? streets[s] : {};
      const ag = st.aggressor === null || st.aggressor === undefined ? null : Math.round(num(st.aggressor, -1));
      sc.streets.push({
        aggressor: ag !== null && ag >= 0 && ag <= n ? ag : null,
        amount: Math.max(0, num(st.amount, s === 0 ? bb : 0)),
        folds: [...new Set((Array.isArray(st.folds) ? st.folds : []).map(x => Math.round(num(x, -1))).filter(x => x >= 1 && x <= n))],
        auto: st.auto !== false,
      });
    }
    return { scenario: sc, fixes };
  }

  // ----- derived facts -----
  function positions(sc) {
    const players = sc.opponents.length + 1, names = POS[players];
    return Array.from({ length: players }, (_, seat) => names[(seat - sc.button + players) % players]);
  }
  const seatOfPosition = (sc, pos) => positions(sc).indexOf(pos);
  function blindOf(sc, seat) { const p = positions(sc)[seat]; return p === 'BB' ? sc.bigBlind : p === 'SB' || (p === 'BTN' && sc.opponents.length === 1) ? sc.bigBlind / 2 : 0; }
  const effRange = o => o.range || (o.style && E.STYLES[o.style] !== undefined ? o.style : '') || '';
  function rangeLabel(o) {
    if (o.cards) return `known: ${prettyList(o.cards)}`;
    const r = effRange(o); if (!r) return 'random hand';
    const pr = E.rangeOf(r); return `${o.range ? o.range : o.style} (${round(pr.pct)}% of hands)`;
  }

  // Money through every street. Opponents who don't fold call the street's bet; you call each bet you face.
  // Returns per street s (0 preflop … 3 river): potStart, potShow (after opponents act, before you), level, toCall,
  // live seat lists; plus potFinal, contrib (per seat), foldedAt (per seat).
  function money(sc) {
    const n = sc.opponents.length, players = n + 1;
    const stacks = [sc.hero.stack].concat(sc.opponents.map(o => o.stack));
    const contrib = new Array(players).fill(0), foldedAt = new Array(players).fill(null);
    const potStart = [], potShow = [], level = [], toCall = [], live = [], liveAfter = [], contribAt = [];
    let pot = 0;
    const put = (seat, amt) => { const a = Math.max(0, Math.min(amt, stacks[seat] - contrib[seat])); contrib[seat] += a; return a; };
    for (let s = 0; s < 4; s++) {
      const st = sc.streets[s];
      const inHand = Array.from({ length: players }, (_, i) => i).filter(i => foldedAt[i] === null);
      live.push(inHand);
      const lv = s === 0 ? Math.max(sc.bigBlind, st.amount || sc.bigBlind) : (st.aggressor === null ? 0 : st.amount || 0);
      level.push(lv); potStart.push(pot);
      const folds = st.folds.filter(x => inHand.includes(x) && x !== st.aggressor);
      let oppsPut = 0, heroPut = 0;
      const startC = contrib.slice();
      for (const seat of inHand) {
        if (seat === 0) continue;
        const target = folds.includes(seat) ? (s === 0 ? blindOf(sc, seat) : 0) : lv;
        oppsPut += put(seat, target - (contrib[seat] - startC[seat]));
      }
      const heroBlind = s === 0 ? blindOf(sc, 0) : 0;
      heroPut = put(0, lv);
      potShow.push(pot + oppsPut + (st.aggressor === 0 ? heroPut : heroBlind));
      toCall.push(st.aggressor === 0 ? 0 : Math.max(0, lv - heroBlind));
      pot += oppsPut + heroPut;
      folds.forEach(x => foldedAt[x] = s);
      liveAfter.push(inHand.filter(i => !folds.includes(i)));
      contribAt.push(contrib.slice());
    }
    contribAt[-1] = new Array(players).fill(0);
    return { potStart, potShow, potFinal: pot, level, toCall, live, liveAfter, contrib, contribAt, foldedAt };
  }
  // Opponents still in at street s (0..4) — the ones the equity runs against.
  function liveOpponents(sc, s) { const m = money(sc); return m.liveAfter[Math.min(s, 3)].filter(x => x > 0); }

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
        sc.streets.forEach(st => { st.folds = st.folds.filter(x => x <= n); if (st.aggressor > n) { st.aggressor = null; st.amount = 0; } });
        const off = POS[n + 1].indexOf(heroPos === 'BTN' && n === 1 ? 'BTN' : heroPos);
        sc.button = off >= 0 ? (n + 1 - off) % (n + 1) : n - 1 >= 0 ? (n + 1 - POS[n + 1].indexOf('BB')) % (n + 1) : 0;
        out.push(`${n} opponent${n > 1 ? 's' : ''}`);
      }
      if (a.big_blind != null) { sc.bigBlind = Math.max(0.02, num(a.big_blind, sc.bigBlind)); if (sc.streets[0].amount < sc.bigBlind) sc.streets[0].amount = sc.bigBlind; out.push(`blinds ${sc.bigBlind / 2}/${sc.bigBlind}`); }
      if (a.starting_stack != null) { const st = Math.max(1, num(a.starting_stack, 200)); sc.hero.stack = st; sc.opponents.forEach(o => o.stack = st); out.push(`stacks ${st}`); }
      if (a.hero_position) {
        const pos = String(a.hero_position).toUpperCase().replace(/\s+/g, '');
        const names = POS[sc.opponents.length + 1], off = names.indexOf(pos === 'BUTTON' ? 'BTN' : pos === 'CUTOFF' ? 'CO' : pos);
        if (off < 0) return { ok: false, error: `Position must be one of ${names.join(', ')} at this table size.` };
        sc.button = (sc.opponents.length + 1 - off) % (sc.opponents.length + 1); out.push(`you on the ${POS_NAMES[names[off]]}`);
      }
      randomizeAction(sc);
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
      if (a.show !== false && sc.street < BOARD_N.indexOf(p.cards.length)) sc.street = BOARD_N.indexOf(p.cards.length);
      return { ok: true, summary: `Board: ${prettyList(sc.board)}${freed.length ? ` (cleared ${freed.join(', ')})` : ''}` };
    },
    set_opponent(sc, a) {
      const seat = seatFrom(sc, a.seat); if (seat < 1) return { ok: false, error: `Unknown opponent "${a.seat}". Use a ${SEAT_HELP}, a name, or a position.` };
      const o = sc.opponents[seat - 1], out = [];
      if (a.name) { o.name = String(a.name).slice(0, 24); out.push(`name ${o.name}`); }
      if (a.stack != null) { o.stack = Math.max(0, num(a.stack, o.stack)); out.push(`stack ${o.stack}`); randomizeAction(sc); }
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
    set_action(sc, a) {
      const s = streetFrom(a.street); if (s < 0 || s > 3) return { ok: false, error: 'street must be preflop, flop, turn or river.' };
      const st = sc.streets[s];
      if (a.aggressor !== undefined) {
        if (a.aggressor === null || /^(none|nobody|check|checks|limp|limps)$/i.test(String(a.aggressor))) { st.aggressor = null; st.amount = s === 0 ? sc.bigBlind : 0; }
        else { const seat = seatFrom(sc, a.aggressor); if (seat < 0) return { ok: false, error: `Unknown player "${a.aggressor}". Use a ${SEAT_HELP}.` }; st.aggressor = seat; }
      }
      if (a.amount != null) {
        const amt = num(a.amount, NaN); if (!(amt >= 0)) return { ok: false, error: 'amount must be a number of chips (the total bet or raise-to size on this street).' };
        if (st.aggressor === null && s > 0 && amt > 0) return { ok: false, error: 'Say who bets (aggressor) as well as the amount.' };
        st.amount = s === 0 ? Math.max(sc.bigBlind, amt) : amt;
      }
      if (a.folds !== undefined) {
        const seats = (Array.isArray(a.folds) ? a.folds : [a.folds]).filter(x => x !== null && x !== '').map(x => seatFrom(sc, x));
        if (seats.some(x => x < 1)) return { ok: false, error: 'folds must list opponent seats (1–8); you cannot fold here.' };
        st.folds = [...new Set(seats)].filter(x => x !== st.aggressor);
      }
      st.auto = false;
      randomizeAction(sc, s + 1);
      if (a.show !== false && sc.street < s) sc.street = s;
      const m = money(sc), hero = st.aggressor === 0, who = st.aggressor === null ? null : hero ? 'You' : sc.opponents[st.aggressor - 1].name;
      const what = s === 0 ? (who ? `${who} ${hero ? 'raise' : 'raises'} to ${m.level[0]}` : `limped pot (${sc.bigBlind})`) : (who ? `${who} ${hero ? 'bet' : 'bets'} ${m.level[s]}` : 'checked through');
      const folds = st.folds.length ? `; folding: ${st.folds.map(x => sc.opponents[x - 1].name).join(', ')}` : '';
      return { ok: true, summary: `${STREETS[s][0].toUpperCase() + STREETS[s].slice(1)}: ${what}${folds}; pot ${round(m.potShow[s])}` };
    },
    show_street(sc, a) {
      const s = streetFrom(a.street); if (s < 0) return { ok: false, error: 'street must be preflop, flop, turn, river or showdown.' };
      sc.street = s; return { ok: true, summary: `Showing the ${STREETS[s]}` };
    },
    new_hand(sc, a) {
      sc.hero.cards = []; sc.board = []; sc.opponents.forEach(o => { o.cards = null; });
      if (!a.keep_ranges) sc.opponents.forEach(o => { o.range = ''; o.style = ''; o.note = ''; });
      sc.streets = [blankStreet(), blankStreet(), blankStreet(), blankStreet()]; sc.streets[0].amount = sc.bigBlind; sc.streets[0].auto = false;
      randomizeAction(sc); sc.street = 0; sc.deal = Math.floor(Math.random() * 1e9);
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
    return liveOpponents(sc, s).map(seat => { const o = sc.opponents[seat - 1]; return o.cards ? { cards: o.cards.map(E.cardFromCode) } : { range: effRange(o) }; });
  }
  // Plain-text description for the agent (and for debugging). Only what you'd know at the table: no hidden cards.
  function summary(sc) {
    const pos = positions(sc), m = money(sc), s = Math.min(sc.street, 3), before = m.contribAt[s - 1] || m.contribAt[-1];
    const lines = [];
    lines.push(`Blinds ${sc.bigBlind / 2}/${sc.bigBlind}. ${sc.opponents.length} opponents. Showing: ${STREETS[sc.street]}.`);
    lines.push(`Seat 0 You (${pos[0]}): cards ${sc.hero.cards.length ? sc.hero.cards.join(' ') : 'not chosen (random)'}, stack ${round(sc.hero.stack - before[0])} at the start of this street.`);
    sc.opponents.forEach((o, i) => {
      const seat = i + 1, f = m.foldedAt[seat];
      lines.push(`Seat ${seat} ${o.name} (${pos[seat]}): ${rangeLabel(o)}${o.style && o.range ? `, style ${o.style}` : ''}, stack ${round(o.stack - before[seat])}${f !== null ? `, FOLDED on the ${STREETS[f]}` : ''}${o.note ? `. Note: ${o.note}` : ''}.`);
    });
    lines.push(`Board known: ${sc.board.length ? sc.board.join(' ') : 'none yet'}${sc.board.length < BOARD_N[sc.street] ? ` (the rest of the ${STREETS[sc.street]} board will be dealt at random)` : ''}.`);
    for (let k = 0; k <= Math.min(3, Math.max(s, 0)); k++) {
      const st = sc.streets[k], who = st.aggressor === null ? null : st.aggressor === 0 ? 'You' : `seat ${st.aggressor} ${sc.opponents[st.aggressor - 1].name}`;
      const act = k === 0 ? (who ? `${who} raised to ${m.level[0]}, others call` : 'limped') : (who ? `${who} bet ${m.level[k]}, others call` : 'checked');
      lines.push(`${STREETS[k]}: pot ${round(m.potStart[k])} at start; ${act}${st.folds.length ? `; folded: ${st.folds.map(x => `seat ${x}`).join(', ')}` : ''}; pot ${round(m.potShow[k])} before you act; you face ${round(m.toCall[k])}.`);
    }
    return lines.join('\n');
  }

  return { STREETS, BOARD_N, NAMES, POS, POS_NAMES, create, normalize, randomizeAction, positions, seatOfPosition, blindOf, money, liveOpponents, engineOpponents, effRange, rangeLabel, apply, ops: Object.keys(ops), summary, clone, prettyList, seatFrom };
});
