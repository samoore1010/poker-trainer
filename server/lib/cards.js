'use strict';
// Card codes shared by the API and the browser: rank (A K Q J T 9 … 2) + suit (s h d c), e.g. "As", "Th", "2c".

const RANKS = 'AKQJT98765432'.split('');
const SUITS = 'shdc'.split('');
const ALL_CARDS = RANKS.flatMap(r => SUITS.map(s => r + s));
const CARD_SET = new Set(ALL_CARDS);

// JSON schema for a dealt hand. Strict mode needs every property required and no extras.
const card = { type: 'string', enum: ALL_CARDS };
const DEAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['hero', 'flop', 'turn', 'river', 'unclear'],
  properties: {
    hero: { type: 'array', items: card, description: "The player's own two hole cards, in the order said." },
    flop: { type: 'array', items: card, description: 'Up to three flop cards. Empty if no flop was given.' },
    turn: { anyOf: [card, { type: 'null' }] },
    river: { anyOf: [card, { type: 'null' }] },
    unclear: { type: 'string', description: 'Short note on anything said that could not be turned into a specific card. Empty if all clear.' },
  },
};

// Validates and tidies a model's answer: known codes only, no card twice, at most 2/3/1/1.
function normalizeDeal(d) {
  const seen = new Set(), dropped = [];
  const keep = c => { if (typeof c !== 'string') return null; const code = c.length === 2 ? c[0].toUpperCase() + c[1].toLowerCase() : c; if (!CARD_SET.has(code) || seen.has(code)) { dropped.push(c); return null; } seen.add(code); return code; };
  const list = (a, n) => (Array.isArray(a) ? a : []).map(keep).filter(Boolean).slice(0, n);
  const hero = list(d.hero, 2), flop = list(d.flop, 3);
  const turn = flop.length === 3 && d.turn ? keep(d.turn) : null;
  const river = turn && d.river ? keep(d.river) : null;
  const notes = [d.unclear, dropped.length ? `ignored ${dropped.join(', ')}` : ''].filter(Boolean).join('; ');
  return { hero, flop, turn, river, unclear: notes };
}

module.exports = { RANKS, SUITS, ALL_CARDS, DEAL_SCHEMA, normalizeDeal };
