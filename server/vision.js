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
  type: 'object', additionalProperties: false, required: ['board', 'hero', 'unsure'],
  properties: {
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
const BETTING_SCHEMA = { ...SCHEMA, required: SCHEMA.required.concat(['betting']), properties: { ...SCHEMA.properties, betting: BETTING } };
const DEFAULT_PLAYER = 'the two face-up cards at the bottom centre of the picture, nearest the camera (in the Hand Walkthrough app they sit above the label "You")';

function prompt(player, betting) {
  const lines = [
    'You read playing cards in a photo of a poker table. It may be a real table or a screen showing a poker app; deck designs, colours and table layouts vary.',
    'Report board: the face-up community cards in the middle of the table, left to right as they lie (the first three are the flop, then the turn, then the river).',
    `Report hero: the hole cards of the player the camera follows: ${player}.`,
    'Card codes are rank then suit: ranks A K Q J T 9 8 7 6 5 4 3 2 (ten is T), suits s h d c. Read each card from its corner index or pips; some decks colour diamonds blue and clubs green.',
    'Ignore face-down cards, chips, buttons, menus, charts, and small card images in side panels or lists.',
    'Never guess. If you cannot read every card of the board with confidence, return the board empty; the same for hero. Say why in unsure.',
    'Never list a card twice.',
  ];
  if (betting) lines.push(
    'Also report betting for the current street. For every seat dealt in (the followed player too): its position (BTN, SB, BB, UTG, UTG+1, UTG+2, LJ, HJ, CO; shown on each player\'s badge, or work it out from the dealer button), whether it has folded, the chips it has put in on this street (the bet in front of it), and its latest action on this street.',
    'to_act is the seat whose turn it is. Amounts are numbers as shown, without currency symbols.',
    'Set readable to false if you cannot see all of this clearly; never guess the betting.');
  return lines.join('\n');
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
  return { board, hero: hero && hero.length ? hero : null, betting: normalizeBetting(raw && raw.betting, unsure), unsure };
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

function createVision(config, openai) {
  const v = config.vision || {}, a = config.agent || {};
  const provider = v.provider || (a.anthropicKey ? 'anthropic' : openai.configured ? 'openai' : '');
  if (provider === 'anthropic' && a.anthropicKey) {
    const client = new Anthropic({ apiKey: a.anthropicKey, timeout: v.timeoutMs || 20000, maxRetries: 1, ...(a.anthropicBaseUrl ? { baseURL: a.anthropicBaseUrl } : {}) });
    const model = v.anthropicModel || 'claude-haiku-5-5';
    // Haiku has no server-side refusal fallback; the larger models get it (the API retries a declined request on another model).
    const fallback = /opus|sonnet|fable/.test(model);
    return {
      name: 'anthropic', model,
      async read({ data, mime, player, betting }) {
        const params = {
          model, max_tokens: 4000, system: prompt(player || DEFAULT_PLAYER, betting),
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data } },
            { type: 'text', text: 'Read the board and the player\'s cards.' },
          ] }],
          output_config: { effort: 'low', format: { type: 'json_schema', schema: betting ? BETTING_SCHEMA : SCHEMA } },
        };
        let msg;
        try {
          msg = fallback ? await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }) : await client.messages.create(params);
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
        const text = msg.content.filter(b => b.type === 'text').map(b => b.text).join('');
        try { return JSON.parse(text); } catch (e) { throw new HttpError(502, 'llm_bad_json', 'The model returned malformed JSON.'); }
      },
    };
  }
  if (provider === 'openai' && openai.configured) {
    const model = v.openaiModel || (config.openai && config.openai.agentModel) || 'gpt-6-astra';
    return {
      name: 'openai', model,
      async read({ data, mime, player, betting }) {
        const res = await openai.responses({
          model,
          input: [
            { role: 'system', content: prompt(player || DEFAULT_PLAYER, betting) },
            { role: 'user', content: [{ type: 'input_text', text: 'Read the board and the player\'s cards.' }, { type: 'input_image', image_url: `data:${mime};base64,${data}`, detail: 'high' }] },
          ],
          text: { format: { type: 'json_schema', name: 'cards', strict: true, schema: betting ? BETTING_SCHEMA : SCHEMA } },
        });
        const text = typeof res.output_text === 'string' && res.output_text ? res.output_text
          : (res.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('');
        try { return JSON.parse(text); } catch (e) { throw new HttpError(502, 'openai_bad_json', 'OpenAI returned malformed JSON.'); }
      },
    };
  }
  return null;
}

module.exports = { createVision, normalize, CODES, SCHEMA, BETTING_SCHEMA, POSITIONS };
