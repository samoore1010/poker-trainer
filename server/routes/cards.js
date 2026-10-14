'use strict';
// Turns free-form speech ("pocket rockets, both black, flop is three hearts: king ten two") into exact cards.
const { HttpError, readJson } = require('../http');
const { DEAL_SCHEMA, normalizeDeal } = require('../lib/cards');
const { normalize: normalizeVision, normalizeTable } = require('../vision');

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

module.exports = function cardRoutes(router, { openai, vision }) {
  // POST {text} → {hero:[..], flop:[..], turn, river, unclear}
  router.post('/api/cards/parse', { metered: true }, async (req, res, { send }) => {
    const { text } = await readJson(req);
    if (typeof text !== 'string' || !text.trim()) throw new HttpError(400, 'text_required', 'Send {"text": "..."}');
    if (text.length > 2000) throw new HttpError(413, 'too_long', 'Text is over 2000 characters.');
    const started = Date.now();
    const raw = await openai.json({ system: SYSTEM, user: text.trim(), schema: DEAL_SCHEMA, name: 'deal' });
    send.json(200, { ...normalizeDeal(raw), model: openai.models.text, ms: Date.now() - started });
  });

  // POST {image: "data:image/jpeg;base64,...", player?, betting?} → {board: [..]|null, hero: [..]|null, betting: {..}|null, unsure: [..]}
  // A camera frame read by a vision model. board null = couldn't read it; hero null = not seen or not readable.
  router.post('/api/cards/vision', { metered: 'camera' }, async (req, res, { send }) => {
    if (!vision) throw new HttpError(503, 'vision_not_configured', 'Camera reading needs ANTHROPIC_API_KEY or OPENAI_API_KEY on the server.');
    const { image, player, betting } = await readJson(req, 3 * 1024 * 1024);
    const m = typeof image === 'string' && image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new HttpError(400, 'image_required', 'Send {"image": "data:image/jpeg;base64,..."}.');
    const started = Date.now();
    const raw = await vision.read({ data: m[2], mime: m[1], player: typeof player === 'string' ? player.slice(0, 300) : '', betting: betting === true });
    send.json(200, { ...normalizeVision(raw), provider: vision.name, model: vision.model, ms: Date.now() - started });
  });

  // POST {image, player?, fast?} → the whole table, seat by seat (normalizeTable). fast: the live-tracking model (read
  // continuously while the table is followed); otherwise the careful Sync table model.
  router.post('/api/cards/table', { metered: 'camera' }, async (req, res, { send }) => {
    if (!vision) throw new HttpError(503, 'vision_not_configured', 'Camera reading needs ANTHROPIC_API_KEY or OPENAI_API_KEY on the server.');
    const { image, player, fast } = await readJson(req, 3 * 1024 * 1024);
    const m = typeof image === 'string' && image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) throw new HttpError(400, 'image_required', 'Send {"image": "data:image/jpeg;base64,..."}.');
    const started = Date.now();
    const raw = await vision.readTable({ data: m[2], mime: m[1], player: typeof player === 'string' ? player.slice(0, 300) : '', fast: fast === true });
    send.json(200, { ...normalizeTable(raw), provider: vision.name, model: fast === true ? vision.liveModel : vision.syncModel, ms: Date.now() - started });
  });
};
