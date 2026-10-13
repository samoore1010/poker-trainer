'use strict';
// The agent's tools. Each has a JSON schema (sent to the LLM) and runs against a working copy of the scenario.
// Edits go through the shared scenario module; numbers always come from the shared engine, never from the model.
const E = require('../../public/engine.js');
const S = require('../../public/scenario.js');

const CARD = { type: 'string', description: 'Card code: rank 2-9 T J Q K A + suit c d h s, e.g. "Ah", "Td", "9c".' };
const CARDS = n => ({ type: 'array', items: CARD, description: n });
const SEAT = { type: ['integer', 'string'], description: 'Seat number (1-8 = opponents, 0 = the user), a player name, or a position like BTN/SB/BB/UTG/HJ/CO.' };
const STREET = { type: 'string', enum: ['preflop', 'flop', 'turn', 'river'] };

const TABLE = { type: 'object', additionalProperties: false, properties: {
  opponents: { type: 'integer', minimum: 1, maximum: 8 },
  big_blind: { type: 'number', description: 'Big blind in chips. The small blind becomes half of it unless small_blind is given.' },
  small_blind: { type: 'number' },
  starting_stack: { type: 'number', description: 'Chips every player starts with.' },
  hero_position: { type: 'string', description: 'The user\'s position: BTN, SB, BB, UTG, UTG+1, UTG+2, LJ, HJ, CO (depends on table size).' },
} };
const OPPONENT = { type: 'object', additionalProperties: false, required: ['seat'], properties: {
  seat: SEAT,
  name: { type: 'string' },
  stack: { type: 'number' },
  cards: { type: ['array', 'null'], items: CARD, description: 'Exactly 2 known cards, or null/[] to make them unknown again.' },
  style: { type: 'string', enum: Object.keys(E.STYLES).concat(['']), description: 'Playing style; sets a default range when no range is given.' },
  range: { type: 'string', description: 'Hand range, e.g. "QQ+, AKs, AQo+, A5s-A2s, KT+, 76s, 22-55, AhKh, top 15%". Empty string clears it.' },
  note: { type: 'string' },
} };
const ACTION = { type: 'object', additionalProperties: false, required: ['street'], properties: {
  street: STREET,
  aggressor: { type: ['integer', 'string', 'null'], description: 'Who bets or raises: seat number, name, position, 0/"hero" for the user, or null/"none" for checked/limped.' },
  amount: { type: 'number', description: 'Bet size in chips (preflop: raise-to total).' },
  folds: { type: 'array', items: SEAT, description: 'Opponents who fold on this street (replaces the list).' },
} };

const MOVE = { type: 'object', additionalProperties: false, required: ['action'], properties: {
  seat: SEAT,
  action: { type: 'string', enum: ['fold', 'check', 'call', 'bet', 'raise', 'allin', 'small', 'big'], description: 'small/big = the app\'s light (½ pot, or 2.5× raise) and heavy (pot) sizes.' },
  amount: { type: 'number', description: 'For bet/raise: the total the player puts in on this street.' },
} };

const DEFS = [
  {
    name: 'update_table',
    description: 'Make ALL changes to the table in this one call, then it returns the fresh stats and the app\'s recommendation. Fields are applied in this order: new_table (fresh scenario) or new_hand, table, dealer, hero_cards, opponents, board, actions, action_to, moves, show_street. Leave out anything that should stay as it is.',
    parameters: { type: 'object', additionalProperties: false, properties: {
      new_table: { ...TABLE, description: 'Start a brand-new scenario (clears cards, ranges and action) with these settings.' },
      new_hand: { type: 'object', additionalProperties: false, properties: { keep_ranges: { type: 'boolean' } }, description: 'Deal a fresh random hand at the same table.' },
      table: { ...TABLE, description: 'Change table settings without clearing anything.' },
      dealer: { ...SEAT, description: 'Move the dealer button to this player (positions follow; the betting starts over). Seat number, name, or 0 for the user.' },
      hero_cards: CARDS('The user\'s 2 hole cards, or [] for random.'),
      opponents: { type: 'array', items: OPPONENT, description: 'Changes to individual opponents.' },
      board: CARDS('Community cards in deal order: 0, 3 (flop), 4 (turn) or 5 (river). The table moves to that street.'),
      actions: { type: 'array', items: ACTION, description: 'Script a street: who bets (and how much) and who folds; everyone else calls in turn order. It stops at the user\'s decision when they face a bet; the rest of the street plays out after the user acts.' },
      action_to: { ...SEAT, description: 'Put the action on this player on the street being bet: players before them fold (preflop, or facing a bet) or check; if they already acted, it goes back to their turn. Applied after actions, before moves.' },
      moves: { type: 'array', items: MOVE, description: 'Exact actions in turn order on the street being played, starting with whoever is to act now (including the user, seat 0). Applied after actions.' },
      show_street: { type: 'string', enum: ['preflop', 'flop', 'turn', 'river', 'showdown'], description: 'Street to show at the end.' },
    } },
  },
  {
    name: 'calculate',
    description: 'Run the poker engine on the table at a given street (the current street\'s numbers are already in the message and in update_table results).',
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
// The biggest parts of your read on a player ("Top pair, good kicker 35%"), for the model to explain.
function readTop(sc, seat, s) {
  if (sc.opponents[seat - 1].cards) return undefined;
  const r = S.readOf(sc, seat, s);
  return r.groups.slice().sort((a, b) => b.n - a.n).slice(0, 5).map(g => `${g.name} ${Math.round(g.n / r.n * 100)}%`);
}

// The engine's read of a scenario at a street. Returns a compact object for the model (and the browser).
function calculate(sc, street, exclude = new Set()) {
  const s = street === undefined || street === null ? Math.min(sc.street, 3) : street;
  if (sc.hero.cards.length !== 2 || sc.heroHidden) return { error: 'The user\'s cards are not set (they are random on the table). Set them with set_hero_cards, or ask the user.' };
  const hero = sc.hero.cards.map(E.cardFromCode), want = S.BOARD_N[s];
  const board = sc.board.slice(0, want).map(E.cardFromCode);
  const m = S.money(sc);
  const live = S.liveOpponents(sc, s).filter(seat => !exclude.has(seat));
  const opps = live.map(seat => S.engineOpponent(sc, seat, s));
  const r = E.equity({ hero, board, opps, trials: 6000 });
  const d = board.length ? E.describe(hero, board) : null;
  const out = {
    street: S.STREETS[s],
    board: board.map(E.codeOf),
    board_note: board.length < want ? `Only ${board.length} board cards are fixed; the rest of the ${S.STREETS[s]} is unknown, so this is computed before those cards come.` : undefined,
    hand: d ? d.text.replace(/<[^>]+>/g, '') : `${E.preflopShort(hero)} (top ${Math.round(E.PCT[E.handLabel(hero[0], hero[1])])}% of starting hands)`,
    win_pct: pct(r.chance),
    method: r.exact ? 'exact (every outcome)' : `simulated (${Math.round(r.trials)} deals)`,
    against: live.map(seat => ({ seat, name: sc.opponents[seat - 1].name, holding: S.seatRangeLabel(sc, seat, s), read: sc.opponents[seat - 1].cards ? undefined : S.readOf(sc, seat, s).steps.map(x => x.text), likely: readTop(sc, seat, s) })),
    improves_to: r.list.filter(g => g.river / r.trials >= 0.01).slice(0, 5).map(g => ({ hand: g.label, by_river_pct: pct(g.river / r.trials * 100), wins_when_made_pct: pct(g.win / g.river * 100) })),
    pot: Math.round(m.potShow[s] * 100) / 100,
    to_call: Math.round(m.toCall[s] * 100) / 100,
  };
  if (r.warnings.length) out.warnings = r.warnings;
  const rec = S.recommendation(sc, s, hero, board, r);
  out.recommendation = { action: rec.label, size: rec.sizeText || undefined, close_call: rec.close || undefined, reasons: rec.reasons };
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
  const w = S.clone(sc), notes = [], folded = new Set();
  const run = (name, args) => { const res = S.apply(w, name, args); if (!res.ok) notes.push(res.error); };
  if (a.hero_cards) run('set_hero_cards', { cards: a.hero_cards });
  if (a.board) run('set_board', { cards: a.board, show: false });
  for (const o of a.opponents || []) {
    const args = { seat: o.seat };
    if (o.range !== undefined) args.range = o.range;
    if (o.cards !== undefined) args.cards = o.cards;
    if (Object.keys(args).length > 1) run('set_opponent', args);
    if (o.folds) { const seat = S.seatFrom(w, o.seat); if (seat > 0) folded.add(seat); else notes.push(`Unknown player "${o.seat}"`); }
  }
  const street = a.street ? S.STREETS.indexOf(a.street) : a.board ? S.BOARD_N.indexOf(w.board.length) : undefined;
  const out = calculate(w, street, folded);
  if (notes.length) out.problems = notes;
  return out;
}

// All edits in one call, in a fixed order; returns what changed, what failed, and the fresh numbers.
function updateTable(state, a) {
  const sc = state.scenario, done = [], errors = [];
  const run = (name, args) => { const r = S.apply(sc, name, args); if (r.ok) done.push(r.summary); else errors.push(`${name}: ${r.error}`); };
  if (a.new_table) run('setup_table', { ...a.new_table, reset: true });
  else if (a.new_hand) run('new_hand', a.new_hand);
  if (a.table && Object.keys(a.table).length) run('setup_table', a.table);
  if (a.dealer !== undefined && a.dealer !== null) run('set_button', { seat: a.dealer });
  if (a.hero_cards) run('set_hero_cards', { cards: a.hero_cards });
  for (const o of a.opponents || []) run('set_opponent', o);
  if (a.board) run('set_board', { cards: a.board });
  for (const act of (a.actions || []).slice().sort((x, y) => S.STREETS.indexOf(x.street) - S.STREETS.indexOf(y.street))) run('set_action', act);
  if (a.action_to !== undefined && a.action_to !== null) run('action_to', { seat: a.action_to });
  for (const mv of a.moves || []) run('act', mv);
  if (a.show_street) run('show_street', { street: a.show_street });
  state.changes.push(...done);
  if (done.length && state.emit) state.emit({ type: 'scenario', scenario: sc, changes: state.changes.slice() });
  const stats = calculate(sc);
  if (!stats.error) state.lastStats = stats;
  return { done, errors: errors.length ? errors : undefined, table: S.summary(sc), stats };
}

// Runs one tool call. Edits mutate `state.scenario`; everything returns a JSON-able result.
function execute(state, name, args) {
  args = args && typeof args === 'object' ? args : {};
  if (name === 'update_table') return updateTable(state, args);
  if (name === 'calculate') { const r = calculate(state.scenario, args.street ? S.STREETS.indexOf(args.street) : undefined); if (!r.error) state.lastStats = r; return r; }
  if (name === 'what_if') return whatIf(state.scenario, args);
  return { error: `Unknown tool ${name}` };
}

module.exports = { DEFS, execute, calculate };
