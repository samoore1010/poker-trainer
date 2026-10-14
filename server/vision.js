'use strict';
// Reads the cards in one camera frame with a vision model and returns them as card codes.
// Claude (official SDK) when ANTHROPIC_API_KEY is set, otherwise OpenAI; VISION_PROVIDER forces one.
// The phone only asks when its own camera reading notices a change, so this runs a few times per hand.
const Anthropic = require('@anthropic-ai/sdk').default;
const { HttpError } = require('./http');

const CODES = [];
for (const r of 'AKQJT98765432') for (const s of 'shdc') CODES.push(r + s);
const CARD = { type: 'string', enum: CODES };
const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['rotate', 'board', 'hero', 'unsure'],
  properties: {
    rotate: { type: 'integer', enum: [0, 90, 180, 270], description: 'How many degrees this picture must be turned clockwise for the table (its text and cards) to read upright. 0 if it already does.' },
    board: { type: 'array', items: CARD, description: 'Face-up community cards in the middle of the table, left to right. Empty if none.' },
    hero: { type: 'array', items: CARD, description: 'The followed player\'s two face-up hole cards, left to right. Empty if not visible.' },
    unsure: { type: 'array', items: { type: 'string' }, description: 'Short notes on anything you could not read with confidence.' },
  },
};
// Optional: the betting on the current street, seat by seat (positions as the table shows them).
const POSITIONS = ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'UTG+2', 'LJ', 'HJ', 'CO'];
const BETTING = {
  type: 'object', additionalProperties: false, required: ['readable', 'players', 'hero_position', 'to_act', 'unit', 'seats'],
  properties: {
    readable: { type: 'boolean', description: 'true only if you can clearly see every seat\'s position, whether it folded, and the chips it has put in on this street.' },
    players: { type: 'integer', description: 'Seats dealt into this hand, including the followed player.' },
    hero_position: { type: 'string', enum: POSITIONS, description: 'The followed player\'s position.' },
    to_act: { type: 'string', enum: POSITIONS.concat(['none']), description: 'Whose turn it is (the highlighted seat, "To act"), or none.' },
    unit: { type: 'string', enum: ['chips', 'big blinds'], description: 'What the amounts on the table are shown in.' },
    seats: { type: 'array', description: 'Every seat dealt in, the followed player included.', items: {
      type: 'object', additionalProperties: false, required: ['position', 'folded', 'in_front', 'last_action'],
      properties: {
        position: { type: 'string', enum: POSITIONS },
        folded: { type: 'boolean', description: 'Out of the hand (folded now or earlier).' },
        in_front: { type: 'number', description: 'Chips this seat has put in on the current street (its bet in front of it, blinds included); 0 if none.' },
        last_action: { type: 'string', enum: ['none', 'post', 'check', 'call', 'bet', 'raise', 'all-in', 'fold'], description: 'Its latest action on this street; post = only its blind so far; none = not acted on this street yet.' },
      },
    } },
  },
};
// Sync table: one careful read of the whole table, seat by seat, with what could and couldn't be read.
const SEAT = {
  type: 'object', additionalProperties: false, required: ['name', 'stack', 'dealer', 'folded', 'in_front', 'last_action'],
  properties: {
    name: { type: 'string', description: 'The name shown for this seat, exactly as written; empty if none can be read.' },
    stack: { type: 'number', description: 'The chips this player has left behind (not counting chips in front of them); -1 if it cannot be read.' },
    dealer: { type: 'boolean', description: 'The dealer button (D) is at this seat.' },
    folded: { type: 'boolean', description: 'Out of this hand (folded, or not dealt in).' },
    in_front: { type: 'number', description: 'Chips this seat has put in on the current street (bet in front of it, blinds included); 0 if none.' },
    last_action: { type: 'string', enum: ['none', 'post', 'check', 'call', 'bet', 'raise', 'all-in', 'fold'], description: 'Its latest action on this street; post = only its blind so far; none = not acted on this street yet.' },
  },
};
const TABLE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['rotate', 'readable', 'problems', 'unit', 'small_blind', 'big_blind', 'pot', 'seats', 'to_act', 'board', 'hero'],
  properties: {
    readable: { type: 'object', additionalProperties: false, required: ['cards', 'seats', 'names', 'stacks', 'betting'], description: 'true only for what you can read with confidence.', properties: {
      cards: { type: 'boolean', description: 'Every face-up card (board and the followed player).' },
      seats: { type: 'boolean', description: 'How many players are seated, in order, and where the dealer button is.' },
      names: { type: 'boolean', description: 'Every seated player\'s name.' },
      stacks: { type: 'boolean', description: 'Every seated player\'s stack.' },
      betting: { type: 'boolean', description: 'Who folded, the chips in front of each seat and whose turn it is.' },
    } },
    rotate: { type: 'integer', enum: [0, 90, 180, 270], description: 'How many degrees this picture must be turned clockwise for the table (its text and cards) to read upright. 0 if it already does.' },
    problems: { type: 'array', items: { type: 'string' }, description: 'Short reasons for anything not readable, e.g. "left seat cut off", "stacks too small to read".' },
    unit: { type: 'string', enum: ['chips', 'big blinds'], description: 'What the amounts on the table are shown in.' },
    small_blind: { type: 'number', description: 'Small blind if shown on the table (e.g. "$0.50/$1"), else 0.' },
    big_blind: { type: 'number', description: 'Big blind if shown, else 0.' },
    pot: { type: 'number', description: 'The total pot as the table shows it, or 0 if not shown.' },
    seats: { type: 'array', items: SEAT, description: 'Every occupied seat, starting with the followed player and going clockwise (on the picture: from the bottom up the left side, across the top, down the right side). Leave out empty seats.' },
    to_act: { type: 'integer', description: 'Index in seats of the player whose turn it is (highlighted, timer bar), or -1.' },
    board: { type: 'array', items: CARD, description: 'Face-up community cards, left to right. Empty if none.' },
    hero: { type: 'array', items: CARD, description: 'The followed player\'s two face-up hole cards. Empty if not visible.' },
    table_box: { type: 'array', items: { type: 'number' }, description: 'Where the table is in this picture, everything needed to follow the hand (all seats, bets, pot, board): [left, top, right, bottom] as fractions of the picture width and height, 0 to 1.' },
  },
};
// Following live: only what changes during a hand, as short arrays (a short answer is a fast answer). Seats are in the
// same order as the full reading: the followed player first, then clockwise.
const LIVE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['rotate', 'ok', 'cards_ok', 'bets', 'folded', 'to_act', 'pot', 'board', 'hero'],
  properties: {
    rotate: { type: 'integer', enum: [0, 90, 180, 270], description: 'Degrees to turn the picture clockwise to make the table upright; 0 if it is.' },
    ok: { type: 'boolean', description: 'true only if every seat\'s bet and folded state and whose turn it is are clearly readable.' },
    cards_ok: { type: 'boolean', description: 'true only if every face-up card is clearly readable.' },
    bets: { type: 'array', items: { type: 'number' }, description: 'Chips in front of each seat on this street (blinds included), followed player first, then clockwise. 0 if none.' },
    folded: { type: 'array', items: { type: 'boolean' }, description: 'Per seat, same order: out of the hand.' },
    to_act: { type: 'integer', description: 'Index (same order) of the seat whose turn it is, or -1.' },
    pot: { type: 'number', description: 'Total pot as shown, or 0.' },
    board: { type: 'array', items: CARD, description: 'Face-up community cards, left to right.' },
    hero: { type: 'array', items: CARD, description: 'The followed player\'s face-up hole cards.' },
  },
};
const BETTING_SCHEMA = { ...SCHEMA, required: SCHEMA.required.concat(['betting']), properties: { ...SCHEMA.properties, betting: BETTING } };
const DEFAULT_PLAYER = 'the two face-up cards at the bottom centre of the picture, nearest the camera (in the Hand Walkthrough app they sit beside the name plate "You")';

// How to tell the parts of any poker table apart (a real one or any app), so a card next to a player is never taken
// for the board, or the board for a player's cards. General on purpose: it holds whatever the layout.
const READING_GUIDE = [
  'How to read any poker table:',
  '- The board (community cards) is one row of face-up cards near the middle of the table, usually next to the pot. It has 0, 3, 4 or 5 cards, never 1 or 2, and it belongs to no player.',
  '- A player\'s own cards lie beside that player\'s avatar or name plate, not in the middle row. The followed player\'s two cards are often larger, tilted, or set off the felt at the bottom edge next to their plate. Cards beside a player belong to that player, even if they are near the middle.',
  '- Face-down cards (card backs) beside an avatar are that player\'s hidden cards: never board cards.',
  '- A bet is a chip stack or amount lying between a player and the middle: it belongs to the nearest player. The pot is the amount labelled as the pot (e.g. "Total pot", "Pot").',
  '- A label or bubble over a player ("Fold", "Call 2", "Raise", "Raises to 15", "All-in") is that player\'s latest action. The player whose turn it is is highlighted (a glow, a timer bar, "To act", "Your turn").',
  '- Logos, table text (game name, blinds), menus and buttons are not cards or bets.',
  '- If you cannot tell whether a card is on the board or in a player\'s hand, leave it out and say so.',
].join('\n');

function prompt(player, betting) {
  const lines = [
    'You read playing cards in a photo of a poker table. It may be a real table or a screen showing a poker app; deck designs, colours and table layouts vary.',
    'Report board: the face-up community cards in the middle of the table, left to right as they lie (the first three are the flop, then the turn, then the river).',
    `Report hero: the hole cards of the player the camera follows: ${player}.`,
    'Card codes are rank then suit: ranks A K Q J T 9 8 7 6 5 4 3 2 (ten is T), suits s h d c. Read each card from its corner index or pips; some decks colour diamonds blue and clubs green.',
    'Ignore face-down cards, chips, buttons, menus, charts, and small card images in side panels or lists.',
    'Never guess. If you cannot read every card of the board with confidence, return the board empty; the same for hero. Say why in unsure.',
    'Never list a card twice.',
    'The picture may be sideways or upside down (a phone filmed lying on its side): read it as it should be, and say in rotate how far to turn it clockwise to make it upright.',
    READING_GUIDE,
  ];
  if (betting) lines.push(
    'Also report betting for the current street. For every seat dealt in (the followed player too): its position (BTN, SB, BB, UTG, UTG+1, UTG+2, LJ, HJ, CO; shown on each player\'s badge, or work it out from the dealer button), whether it has folded, the chips it has put in on this street (the bet in front of it), and its latest action on this street.',
    'to_act is the seat whose turn it is. Amounts are numbers as shown, without currency symbols.',
    'Set readable to false if you cannot see all of this clearly; never guess the betting.');
  return lines.join('\n');
}

function tablePrompt(player) {
  return [
    'You read a photo of a poker table, seat by seat. It may be a real table or a screen showing a poker app; layouts vary.',
    `The followed player is ${player}. List every occupied seat starting with the followed player, then clockwise (on the picture: from the bottom up the left side, across the top, down the right side).`,
    'For each seat: the name as written, the stack behind (chips left, not counting the bet in front), whether the dealer button is there, whether the player folded, the chips in front of them on this street, and their latest action on this street.',
    'Card codes are rank then suit: ranks A K Q J T 9 8 7 6 5 4 3 2, suits s h d c. Some decks colour diamonds blue and clubs green.',
    'Amounts are numbers as shown, without currency symbols. If the blinds are printed on the table (e.g. "$0.50/$1"), report them.',
    'The picture may be sideways or upside down (a phone filmed lying on its side): read it as it should be, and say in rotate how far to turn it clockwise to make it upright.',
    'Be strict in readable: mark a part false unless you can read all of it clearly, and say why in problems. Use "" or -1 for any single value you cannot read. Never guess.',
    READING_GUIDE,
  ].join('\n');
}
const TABLE_PLAYER = 'the player nearest the camera at the bottom centre (in the Hand Walkthrough app, the name plate "You")';
function livePrompt(player, seats, cards = true) {
  return [
    'You follow a poker hand in a photo of a table (a real table or a poker app on a screen), as fast as possible.',
    `Seats in order: the followed player (${player}) first, then clockwise (on the picture: up the left side, across the top, down the right side)${seats ? `; there should be ${seats} seats` : ''}.`,
    `Per seat: the chips in front of it on this street, and whether it has folded. Then whose turn it is (highlighted seat, timer bar)${cards ? ', the pot as shown, and the face-up cards (codes: rank then suit, e.g. Ah, Td)' : ' and the pot as shown. Leave board and hero empty and cards_ok false: the cards are read elsewhere'}.`,
    'The picture may be sideways: read it upright and say in rotate how far to turn it clockwise.',
    ...(cards ? ['board: the face-up row in the middle by the pot (0, 3, 4 or 5 cards). hero: the two face-up cards beside the followed player\'s plate, never cards from the middle row. Card backs are nobody\'s board.'] : []),
    'A bet is the chips or amount between a player and the middle, and belongs to the nearest player.',
    'Never guess: set ok or cards_ok to false if you cannot read that part clearly, or cannot tell board cards from the player\'s.',
  ].join('\n');
}
// → the same shape as normalizeTable (seats carry only bet and folded; names, stacks and the dealer come from the full read)
function normalizeLive(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const bets = Array.isArray(r.bets) ? r.bets.slice(0, 9) : [], folded = Array.isArray(r.folded) ? r.folded : [];
  const problems = [];
  let betting = !!r.ok && bets.length >= 2 && folded.length === bets.length && bets.every(x => Number.isFinite(+x) && +x >= 0);
  if (r.ok && !betting) problems.push('the seats didn\'t add up');
  const seats = bets.map((x, i) => ({ name: '', stack: null, dealer: false, folded: !!folded[i], bet: Number.isFinite(+x) && +x >= 0 ? +x : 0, last: 'none' }));
  const cards = normalize({ board: r.board, hero: r.hero, unsure: [] });
  const cardsOk = !!r.cards_ok && !cards.unsure.length;
  return {
    live: true, rotate: [90, 180, 270].includes(r.rotate) ? r.rotate : 0, pot: Number.isFinite(+r.pot) && +r.pot > 0 ? +r.pot : null,
    readable: { cards: cardsOk, seats: false, names: false, stacks: false, betting }, problems, unit: 'chips', blinds: null, seats,
    toAct: Number.isInteger(r.to_act) && r.to_act >= 0 && r.to_act < seats.length ? r.to_act : null,
    board: cardsOk ? cards.board : null, hero: cardsOk ? cards.hero : null,
  };
}
// → {readable: {cards, seats, names, stacks, betting}, problems, unit, blinds: {small, big}|null, seats: [{name, stack|null,
//    dealer, folded, bet, last}], toAct: index|null, board: [..]|null, hero: [..]|null}
function normalizeTable(raw) {
  const r = raw && typeof raw === 'object' ? raw : {}, rd = r.readable || {};
  const problems = Array.isArray(r.problems) ? r.problems.filter(x => typeof x === 'string').slice(0, 6) : [];
  const readable = { cards: !!rd.cards, seats: !!rd.seats, names: !!rd.names, stacks: !!rd.stacks, betting: !!rd.betting };
  const seats = (Array.isArray(r.seats) ? r.seats : []).slice(0, 9).map(x => ({
    name: typeof x.name === 'string' ? x.name.trim().slice(0, 24) : '',
    stack: Number.isFinite(+x.stack) && +x.stack >= 0 ? +x.stack : null,
    dealer: !!x.dealer, folded: !!x.folded, bet: Number.isFinite(+x.in_front) && +x.in_front >= 0 ? +x.in_front : 0,
    last: typeof x.last_action === 'string' ? x.last_action : 'none',
  }));
  if (seats.length < 2 || seats.filter(x => x.dealer).length !== 1) { if (readable.seats) problems.push(seats.length < 2 ? 'fewer than two seats seen' : 'the dealer button wasn\'t clear'); readable.seats = false; }
  if (!readable.seats) readable.betting = false;
  if (seats.some(x => !x.name)) readable.names = false;
  if (seats.some(x => x.stack === null)) readable.stacks = false;
  const cards = normalize({ board: r.board, hero: r.hero, unsure: [] });
  if (cards.unsure.length) { readable.cards = false; problems.push(...cards.unsure); }
  const sb = +r.small_blind, bb = +r.big_blind;
  return {
    rotate: [90, 180, 270].includes(r.rotate) ? r.rotate : 0, pot: Number.isFinite(+r.pot) && +r.pot > 0 ? +r.pot : null,
    readable, problems, unit: r.unit === 'big blinds' ? 'bb' : 'chips', blinds: bb > 0 && sb > 0 && sb <= bb ? { small: sb, big: bb } : null, seats,
    toAct: Number.isInteger(r.to_act) && r.to_act >= 0 && r.to_act < seats.length ? r.to_act : null,
    board: readable.cards ? cards.board : null, hero: readable.cards ? cards.hero : null,
    box: Array.isArray(r.table_box) && r.table_box.length === 4 && r.table_box.every(x => Number.isFinite(+x)) && r.table_box[2] > r.table_box[0] && r.table_box[3] > r.table_box[1]
      ? r.table_box.map(x => Math.max(0, Math.min(1, +x))) : null,
  };
}

// Cleans the model's answer: valid codes, no repeats, a board of 0/3/4/5 cards and a hand of 0/2.
function normalize(raw) {
  const seen = new Set(), unsure = Array.isArray(raw && raw.unsure) ? raw.unsure.filter(x => typeof x === 'string').slice(0, 5) : [];
  const clean = (list, what) => {
    const out = [];
    for (const c of Array.isArray(list) ? list : []) {
      if (!CODES.includes(c)) { unsure.push(`${what}: "${c}" is not a card`); return null; }
      if (seen.has(c)) { unsure.push(`${c} was listed twice`); return null; }
      seen.add(c); out.push(c);
    }
    return out;
  };
  let board = clean(raw && raw.board, 'board'), hero = clean(raw && raw.hero, 'hero');
  if (board && ![0, 3, 4, 5].includes(board.length)) { unsure.push(`board had ${board.length} cards`); board = null; }
  if (hero && ![0, 2].includes(hero.length)) { unsure.push(`hand had ${hero.length} cards`); hero = null; }
  // board: null = couldn't be read (change nothing), [] = no board yet. hero: null = not seen or not readable.
  const rotate = raw && [90, 180, 270].includes(raw.rotate) ? raw.rotate : 0;
  return { board, hero: hero && hero.length ? hero : null, betting: normalizeBetting(raw && raw.betting, unsure), unsure, rotate };
}
// → {players, heroPosition, toAct, unit, seats: {POS: {folded, bet, last}}} or null when it isn't clear enough to use.
function normalizeBetting(b, unsure) {
  if (!b || typeof b !== 'object') return null;
  if (!b.readable) { unsure.push('betting not readable'); return null; }
  const seats = {};
  for (const x of Array.isArray(b.seats) ? b.seats : []) {
    if (!x || !POSITIONS.includes(x.position) || seats[x.position]) { unsure.push('betting: unclear seat positions'); return null; }
    const bet = Number(x.in_front);
    if (!(bet >= 0) || !isFinite(bet)) { unsure.push(`betting: odd amount for ${x.position}`); return null; }
    seats[x.position] = { folded: !!x.folded, bet, last: String(x.last_action || 'none') };
  }
  const n = Object.keys(seats).length;
  if (n < 2 || n > 9 || (b.players && b.players !== n) || !seats[b.hero_position]) { unsure.push('betting: seats don\'t add up'); return null; }
  if (b.to_act !== 'none' && !seats[b.to_act]) { unsure.push('betting: unclear whose turn it is'); return null; }
  return { players: n, heroPosition: b.hero_position, toAct: b.to_act === 'none' ? null : b.to_act, unit: b.unit === 'big blinds' ? 'bb' : 'chips', seats };
}

// The JSON object in a reply: as is, or the outermost {...} when something surrounds it (a code fence, a sentence).
function parseJson(text) {
  try { return JSON.parse(text); } catch (e) { /* fall through */ }
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  try { return JSON.parse(text.slice(a, b + 1)); } catch (e) { return null; }
}

function createVision(config, openai) {
  const v = config.vision || {}, a = config.agent || {};
  const provider = v.provider || (a.anthropicKey ? 'anthropic' : openai.configured ? 'openai' : '');
  if (provider === 'anthropic' && a.anthropicKey) {
    const client = new Anthropic({ apiKey: a.anthropicKey, timeout: v.timeoutMs || 20000, maxRetries: 1, ...(a.anthropicBaseUrl ? { baseURL: a.anthropicBaseUrl } : {}) });
    const model = v.anthropicModel || 'claude-haiku-5-5', syncModel = v.syncModel || model, liveModel = v.liveModel || model;
    return {
      name: 'anthropic', model,
      syncModel, liveModel,
      read({ data, mime, player, betting }) {
        return ask({ data, mime, model, system: prompt(player || DEFAULT_PLAYER, betting), schema: betting ? BETTING_SCHEMA : SCHEMA, text: 'Read the board and the player\'s cards.', effort: 'low' });
      },
      readTable({ data, mime, player, fast }) {
        return ask({ data, mime, model: fast ? liveModel : syncModel, system: tablePrompt(player || TABLE_PLAYER), schema: TABLE_SCHEMA, text: 'Read the whole table, seat by seat.', effort: fast ? 'low' : 'medium', quick: fast });
      },
      readLive({ data, mime, player, seats, cards }) {
        return ask({ data, mime, model: liveModel, system: livePrompt(player || TABLE_PLAYER, seats, cards), schema: LIVE_SCHEMA, text: 'Bets, folds, whose turn, pot, cards.', effort: 'low', quick: true });
      },
    };
    // Thinking counts against max_tokens: a tight cap ends the answer before the JSON is written. Live reads turn
    // thinking off where the model allows it (Haiku), for speed; everything else keeps a wide cap.
    async function ask({ data, mime, model, system, schema, text, effort, quick }) {
      const params = {
        model, max_tokens: quick ? 4000 : 16000, system,
        ...(quick && /haiku/.test(model) ? { thinking: { type: 'disabled' } } : {}),
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: mime, data } },
          { type: 'text', text },
        ] }],
        output_config: { effort, format: { type: 'json_schema', schema } },
      };
      let msg;
      try { // Haiku has no server-side refusal fallback; the larger models get it (a declined request is retried on another model)
        msg = /opus|sonnet|fable/.test(model) ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }) : await client.messages.create(params);
      } catch (e) {
        if (e instanceof Anthropic.AuthenticationError) throw new HttpError(502, 'llm_auth', 'Anthropic rejected the API key. Check ANTHROPIC_API_KEY.');
        if (e instanceof Anthropic.NotFoundError) throw new HttpError(502, 'llm_model', `Anthropic model problem: ${e.message}`);
        if (e instanceof Anthropic.RateLimitError) throw new HttpError(502, 'llm_rate_limited', 'Anthropic rate limit reached.');
        if (e instanceof Anthropic.BadRequestError) throw new HttpError(502, 'llm_error', `Anthropic rejected the request: ${e.message}`);
        if (e instanceof Anthropic.APIConnectionError) throw new HttpError(504, 'llm_unreachable', 'Could not reach Anthropic.');
        if (e instanceof Anthropic.APIError) throw new HttpError(502, 'llm_error', `Anthropic error ${e.status}: ${e.message}`);
        throw e;
      }
      if (msg.stop_reason === 'refusal') throw new HttpError(502, 'llm_refused', 'The model declined to read this picture.');
      const out = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
      const json = parseJson(out);
      if (json) return json;
      console.warn(JSON.stringify({ vision: 'bad_json', model, stop: msg.stop_reason, usage: msg.usage, text: out.slice(0, 300) }));
      if (msg.stop_reason === 'max_tokens') throw new HttpError(502, 'llm_truncated', 'The model ran out of room before finishing its answer.');
      throw new HttpError(502, 'llm_bad_json', `The model returned malformed JSON (stop: ${msg.stop_reason}).`);
    }
  }
  if (provider === 'openai' && openai.configured) {
    const model = v.openaiModel || (config.openai && config.openai.agentModel) || 'gpt-6-astra', syncModel = v.openaiSyncModel || model, liveModel = v.openaiLiveModel || model;
    return {
      name: 'openai', model, syncModel, liveModel,
      read({ data, mime, player, betting }) { return ask({ data, mime, model, system: prompt(player || DEFAULT_PLAYER, betting), schema: betting ? BETTING_SCHEMA : SCHEMA, name: 'cards', text: 'Read the board and the player\'s cards.' }); },
      readTable({ data, mime, player, fast }) { return ask({ data, mime, model: fast ? liveModel : syncModel, system: tablePrompt(player || TABLE_PLAYER), schema: TABLE_SCHEMA, name: 'table', text: 'Read the whole table, seat by seat.' }); },
      readLive({ data, mime, player, seats, cards }) { return ask({ data, mime, model: liveModel, system: livePrompt(player || TABLE_PLAYER, seats, cards), schema: LIVE_SCHEMA, name: 'live', text: 'Bets, folds, whose turn, pot, cards.' }); },
    };
    async function ask({ data, mime, model, system, schema, name, text: say }) {
      const res = await openai.responses({
        model,
        input: [
          { role: 'system', content: system },
          { role: 'user', content: [{ type: 'input_text', text: say }, { type: 'input_image', image_url: `data:${mime};base64,${data}`, detail: 'high' }] },
        ],
        text: { format: { type: 'json_schema', name, strict: true, schema } },
      });
      const text = typeof res.output_text === 'string' && res.output_text ? res.output_text
        : (res.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
      const json = parseJson(text);
      if (json) return json;
      throw new HttpError(502, 'openai_bad_json', 'OpenAI returned malformed JSON.');
    }
  }
  return null;
}

module.exports = { createVision, parseJson, normalize, normalizeTable, normalizeLive, CODES, SCHEMA, BETTING_SCHEMA, TABLE_SCHEMA, LIVE_SCHEMA, POSITIONS };
