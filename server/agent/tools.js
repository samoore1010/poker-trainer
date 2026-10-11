'use strict';
// The agent's tools. Each has a JSON schema (sent to the LLM) and runs against a working copy of the scenario.
// Edits go through the shared scenario module; numbers always come from the shared engine, never from the model.
const E = require('../../public/engine.js');
const S = require('../../public/scenario.js');

const CARD = { type: 'string', description: 'Card code: rank 2-9 T J Q K A + suit c d h s, e.g. "Ah", "Td", "9c".' };
const CARDS = n => ({ type: 'array', items: CARD, description: n });
const SEAT = { type: ['integer', 'string'], description: 'Seat number (1-8 = opponents, 0 = the user), a player name, or a position like BTN/SB/BB/UTG/HJ/CO.' };
const STREET = { type: 'string', enum: ['preflop', 'flop', 'turn', 'river'] };

const DEFS = [
  {
    name: 'setup_table',
    description: 'Set up the table. Use reset:true to start a brand-new scenario (clears cards, ranges, action). Also sets number of opponents, blinds, starting stacks, and the user\'s position.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      reset: { type: 'boolean', description: 'Start a fresh table first.' },
      opponents: { type: 'integer', minimum: 1, maximum: 8 },
      big_blind: { type: 'number' },
      starting_stack: { type: 'number', description: 'Chips every player starts with.' },
      hero_position: { type: 'string', description: 'The user\'s seat position: BTN, SB, BB, UTG, UTG+1, UTG+2, LJ, HJ, CO (depends on table size).' },
    } },
  },
  {
    name: 'set_hero_cards',
    description: 'Set the user\'s two hole cards. Empty list = random.',
    parameters: { type: 'object', additionalProperties: false, required: ['cards'], properties: { cards: CARDS('Exactly 2 cards, or [] for random.') } },
  },
  {
    name: 'set_board',
    description: 'Set the community cards in deal order: 3 = flop, 4 = flop+turn, 5 = full board, [] = none fixed (dealt at random). The table moves to that street.',
    parameters: { type: 'object', additionalProperties: false, required: ['cards'], properties: { cards: CARDS('0, 3, 4 or 5 cards.'), show: { type: 'boolean', description: 'Move the table to that street (default true).' } } },
  },
  {
    name: 'set_opponent',
    description: 'Change one opponent: name, stack, known cards, playing style, hand range, or a note. A range or known cards make the stats run against that player\'s likely hands instead of a random hand.',
    parameters: { type: 'object', additionalProperties: false, required: ['seat'], properties: {
      seat: SEAT,
      name: { type: 'string' },
      stack: { type: 'number' },
      cards: { type: ['array', 'null'], items: CARD, description: 'Exactly 2 known cards, or null/[] to make them unknown again.' },
      style: { type: 'string', enum: Object.keys(E.STYLES).concat(['']), description: 'Playing style; sets a default range (share of best starting hands) when no range is given.' },
      range: { type: 'string', description: 'Hand range: comma-separated, e.g. "QQ+, AKs, AQo+, A5s-A2s, KT+, 76s, 22-55, AhKh, top 15%". Empty string clears it.' },
      note: { type: 'string' },
    } },
  },
  {
    name: 'set_action',
    description: 'Set the betting on one street. Everyone not folding calls the bet; the user faces the bet unless the user is the aggressor. Preflop the amount is the raise-to size (or the big blind for a limped pot).',
    parameters: { type: 'object', additionalProperties: false, required: ['street'], properties: {
      street: STREET,
      aggressor: { type: ['integer', 'string', 'null'], description: 'Who bets or raises: seat number, name, position, 0/"hero" for the user, or null/"none" for checked/limped.' },
      amount: { type: 'number', description: 'Bet size in chips (preflop: raise-to total).' },
      folds: { type: 'array', items: SEAT, description: 'Opponents who fold on this street (replaces the list).' },
      show: { type: 'boolean', description: 'Move the table to this street (default true).' },
    } },
  },
  {
    name: 'show_street',
    description: 'Move the table to a street. Board cards not fixed are dealt at random.',
    parameters: { type: 'object', additionalProperties: false, required: ['street'], properties: { street: { type: 'string', enum: ['preflop', 'flop', 'turn', 'river', 'showdown'] } } },
  },
  {
    name: 'new_hand',
    description: 'Deal a fresh random hand at the same table (same players, blinds and stacks).',
    parameters: { type: 'object', additionalProperties: false, properties: { keep_ranges: { type: 'boolean', description: 'Keep opponents\' ranges and styles (default false).' } } },
  },
  {
    name: 'get_table',
    description: 'Read the current table: seats, positions, ranges, known cards, board and the action on each street.',
    parameters: { type: 'object', additionalProperties: false, properties: {} },
  },
  {
    name: 'calculate',
    description: 'Run the poker engine on the table as it is: the user\'s hand, chance to win against the live opponents\' ranges, how the hand can improve, what beats it now, and pot odds. Use these numbers in your answer; never estimate them yourself.',
    parameters: { type: 'object', additionalProperties: false, properties: { street: STREET } },
  },
  {
    name: 'what_if',
    description: 'Run the engine on a variation WITHOUT changing the table: different hole cards, board, or opponent ranges/cards. Use it to compare options ("what if he only has QQ+", "what if the turn is a heart").',
    parameters: { type: 'object', additionalProperties: false, properties: {
      hero_cards: CARDS('2 cards'),
      board: CARDS('0, 3, 4 or 5 cards'),
      opponents: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['seat'], properties: { seat: SEAT, range: { type: 'string' }, cards: { type: ['array', 'null'], items: CARD }, folds: { type: 'boolean', description: 'Treat this opponent as folded.' } } } },
      street: STREET,
    } },
  },
];

const pct = x => Math.round(x * 10) / 10;

// The engine's read of a scenario at a street. Returns a compact object for the model (and the browser).
function calculate(sc, street) {
  const s = street === undefined || street === null ? Math.min(sc.street, 3) : street;
  if (sc.hero.cards.length !== 2) return { error: 'The user\'s cards are not set (they are random on the table). Set them with set_hero_cards, or ask the user.' };
  const hero = sc.hero.cards.map(E.cardFromCode), want = S.BOARD_N[s];
  const board = sc.board.slice(0, want).map(E.cardFromCode);
  const live = S.liveOpponents(sc, s), opps = S.engineOpponents(sc, s), m = S.money(sc);
  const r = E.equity({ hero, board, opps, trials: 10000 });
  const d = board.length ? E.describe(hero, board) : null;
  const out = {
    street: S.STREETS[s],
    board: board.map(E.codeOf),
    board_note: board.length < want ? `Only ${board.length} board cards are fixed; the rest of the ${S.STREETS[s]} is unknown, so this is computed before those cards come.` : undefined,
    hand: d ? d.text.replace(/<[^>]+>/g, '') : `${E.preflopShort(hero)} (top ${Math.round(E.PCT[E.handLabel(hero[0], hero[1])])}% of starting hands)`,
    win_pct: pct(r.chance),
    method: r.exact ? `exact (all ${r.trials} outcomes)` : `simulated (${r.trials} deals)`,
    against: live.map(seat => ({ seat, name: sc.opponents[seat - 1].name, holding: S.rangeLabel(sc.opponents[seat - 1]) })),
    improves_to: r.list.filter(g => g.river / r.trials >= 0.01).slice(0, 5).map(g => ({ hand: g.label, by_river_pct: pct(g.river / r.trials * 100), wins_when_made_pct: pct(g.win / g.river * 100) })),
    pot: Math.round(m.potShow[s] * 100) / 100,
    to_call: Math.round(m.toCall[s] * 100) / 100,
  };
  if (r.warnings.length) out.warnings = r.warnings;
  if (out.to_call > 0) { out.pot_odds_need_pct = pct(out.to_call / (out.pot + out.to_call) * 100); out.call_beats_pot_odds = out.win_pct >= out.pot_odds_need_pct; }
  if (board.length >= 3) {
    const T = E.threatsNow(hero, board, opps);
    out.beaten_now_pct = pct(T.pAny);
    out.beaten_by = [...T.groups.values()].filter(g => g.pNow >= 0.5).sort((a, b) => b.pNow - a.pNow).slice(0, 5).map(g => ({ by: g.label, pct: pct(g.pNow), hands: g.desc }));
  }
  if (!live.length) out.note = 'Every opponent has folded; the user wins the pot.';
  return out;
}

function whatIf(sc, a) {
  const w = S.clone(sc), notes = [];
  const run = (name, args) => { const res = S.apply(w, name, args); if (!res.ok) notes.push(res.error); };
  if (a.hero_cards) run('set_hero_cards', { cards: a.hero_cards });
  if (a.board) run('set_board', { cards: a.board, show: false });
  for (const o of a.opponents || []) {
    const args = { seat: o.seat };
    if (o.range !== undefined) args.range = o.range;
    if (o.cards !== undefined) args.cards = o.cards;
    if (Object.keys(args).length > 1) run('set_opponent', args);
    if (o.folds) { const seat = S.seatFrom(w, o.seat); if (seat > 0) for (let s = 0; s < 4; s++) if (!w.streets[s].folds.includes(seat)) { w.streets[s].folds.push(seat); break; } }
  }
  const street = a.street ? S.STREETS.indexOf(a.street) : a.board ? S.BOARD_N.indexOf(w.board.length) : undefined;
  const out = calculate(w, street);
  if (notes.length) out.problems = notes;
  return out;
}

// Runs one tool call. Edits mutate `state.scenario`; everything returns a JSON-able result.
function execute(state, name, args) {
  args = args && typeof args === 'object' ? args : {};
  if (name === 'get_table') return { table: S.summary(state.scenario) };
  if (name === 'calculate') { const r = calculate(state.scenario, args.street ? S.STREETS.indexOf(args.street) : undefined); state.lastStats = r; return r; }
  if (name === 'what_if') return whatIf(state.scenario, args);
  if (!S.ops.includes(name)) return { error: `Unknown tool ${name}` };
  const res = S.apply(state.scenario, name, args);
  if (res.ok) state.changes.push(res.summary);
  return res.ok ? { ok: true, done: res.summary } : { ok: false, error: res.error };
}

module.exports = { DEFS, execute, calculate };
