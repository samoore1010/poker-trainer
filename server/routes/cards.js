'use strict';
// Turns free-form speech ("pocket rockets, both black, flop is three hearts: king ten two") into exact cards.
const { HttpError, readJson } = require('../http');
const { DEAL_SCHEMA, normalizeDeal } = require('../lib/cards');

const SYSTEM = [
  'You convert a spoken or typed description of a Texas Hold\'em hand into exact cards.',
  'Card codes are rank + suit: ranks A K Q J T 9 8 7 6 5 4 3 2, suits s h d c (spades, hearts, diamonds, clubs). Ten is T.',
  'hero = the speaker\'s own two hole cards ("I have", "my hand", or the first cards said when no street is named).',
  'flop = up to three board cards, then turn, then river. Cards said without street words fill hero, flop, turn, river in that order.',
  'A suit said after several ranks applies to all of them ("ten nine two of clubs" = Tc 9c 2c).',
  'Fix obvious speech-recognition slips ("for"→four, "to"/"too"→two, "ate"→eight, "harts"→hearts).',
  'Never invent a card. If a rank has no suit, or slang does not pin down exact suits (e.g. "pocket aces" with no suits), leave it out and say so in unclear.',
  'Never repeat a card.',
].join(' ');

module.exports = function cardRoutes(router, { openai }) {
  // POST {text} → {hero:[..], flop:[..], turn, river, unclear}
  router.post('/api/cards/parse', { metered: true }, async (req, res, { send }) => {
    const { text } = await readJson(req);
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'text_required', 'Send {"text": "..."}');
    if (text.length > 2000) throw new HttpError(413, 'too_long', 'Text is over 2000 characters.');
    const started = Date.now();
    const raw = await openai.json({ system: SYSTEM, user: text.trim(), schema: DEAL_SCHEMA, name: 'deal' });
    send.json(200, { ...normalizeDeal(raw), model: openai.models.text, ms: Date.now() - started });
  });
};
