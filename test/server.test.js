'use strict';
// Server tests against a fake OpenAI API. Run with: npm test
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../server/app');
const { normalizeDeal } = require('../server/lib/cards');

let mock, mockUrl, seen = [], nextReply = null;
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(`http://127.0.0.1:${srv.address().port}`)));

before(async () => {
  mock = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({ path: req.url, headers: req.headers, body });
      if (nextReply) { const r = nextReply; nextReply = null; res.writeHead(r.status, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(r.body)); }
      if (req.url === '/v1/audio/transcriptions') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ text: ' Ace king of spades. ' })); }
      if (req.url === '/v1/chat/completions') {
        const content = JSON.stringify({ hero: ['As', 'As', 'Kd'], flop: ['Tc', '9c', '2c'], turn: '8d', river: null, unclear: '' });
        res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ choices: [{ message: { content } }] }));
      }
      if (req.url === '/v1/audio/speech') { res.writeHead(200, { 'Content-Type': 'audio/mpeg' }); return res.end(Buffer.alloc(2048, 7)); }
      res.writeHead(404); res.end();
    });
  });
  mockUrl = await listen(mock);
});
after(() => mock.close());

function config(over = {}) {
  return {
    accessCode: '', rateLimitPerMin: 100, maxAudioBytes: 1024 * 1024, ...over,
    openai: { apiKey: 'sk-test', baseUrl: mockUrl + '/v1', timeoutMs: 5000, transcribeModel: 'tx-model', textModel: 'text-model', ttsModel: 'tts-model', ttsVoice: 'alloy', ttsInstructions: 'calm', ...(over.openai || {}) },
  };
}
async function withApp(cfg, fn) {
  const srv = http.createServer(createApp(cfg, { log: () => {} }));
  const url = await listen(srv);
  try { await fn(url); } finally { srv.close(); }
}
const audio = () => Buffer.alloc(4000, 1);

test('status reports features and never the key', () => withApp(config(), async url => {
  const r = await fetch(url + '/api/status'); const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.features, { transcribe: true, parseCards: true, speak: true, agent: true, vision: true });
  assert.deepEqual(j.agent, { provider: 'openai', model: 'gpt-6-astra' });
  assert.ok(!JSON.stringify(j).includes('sk-test'));
}));

test('without a key, voice routes answer 503 openai_not_configured', () => withApp(config({ openai: { apiKey: '' } }), async url => {
  const j = await (await fetch(url + '/api/status')).json();
  assert.equal(j.features.transcribe, false);
  const r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: audio() });
  assert.equal(r.status, 503);
  assert.equal((await r.json()).error.code, 'openai_not_configured');
}));

test('transcribe forwards audio as multipart with model, prompt and auth', () => withApp(config(), async url => {
  seen = [];
  const r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm;codecs=opus' }, body: audio() });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.text, 'Ace king of spades.');
  const up = seen[0];
  assert.equal(up.path, '/v1/audio/transcriptions');
  assert.equal(up.headers.authorization, 'Bearer sk-test');
  assert.match(up.headers['content-type'], /^multipart\/form-data/);
  const body = up.body.toString('latin1');
  assert.match(body, /name="model"\r\n\r\ntx-model/);
  assert.match(body, /filename="speech\.webm"/);
  assert.match(body, /name="prompt"\r\n\r\nPoker cards/);
  assert.match(body, /name="language"\r\n\r\nen/);
}));

test('transcribe rejects non-audio, empty and oversized bodies', () => withApp(config({ maxAudioBytes: 5000 }), async url => {
  let r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'hi' });
  assert.equal(r.status, 415);
  r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.alloc(10) });
  assert.equal((await r.json()).error.code, 'audio_empty');
  r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: Buffer.alloc(9000) });
  assert.equal(r.status, 413);
}));

test('card parsing uses strict JSON schema and cleans the answer', () => withApp(config(), async url => {
  seen = [];
  const r = await fetch(url + '/api/cards/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'pocket ace and king, flop ten nine deuce of clubs, turn eight of diamonds' }) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.deepEqual(j.hero, ['As', 'Kd']); // duplicate As dropped
  assert.deepEqual(j.flop, ['Tc', '9c', '2c']);
  assert.equal(j.turn, '8d'); assert.equal(j.river, null);
  assert.match(j.unclear, /ignored As/);
  const sent = JSON.parse(seen[0].body);
  assert.equal(sent.model, 'text-model');
  assert.equal(sent.response_format.type, 'json_schema');
  assert.equal(sent.response_format.json_schema.strict, true);
}));

test('speak streams audio back', () => withApp(config(), async url => {
  seen = [];
  const r = await fetch(url + '/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'Pair of aces.' }) });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'audio/mpeg');
  assert.equal((await r.arrayBuffer()).byteLength, 2048);
  const sent = JSON.parse(seen[0].body);
  assert.deepEqual([sent.model, sent.voice, sent.input, sent.instructions], ['tts-model', 'alloy', 'Pair of aces.', 'calm']);
  const bad = await fetch(url + '/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'x', voice: 'nope' }) });
  assert.equal(bad.status, 400);
}));

test('OpenAI errors map to clear codes', () => withApp(config(), async url => {
  nextReply = { status: 401, body: { error: { message: 'Incorrect API key provided' } } };
  let r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: audio() });
  assert.equal((await r.json()).error.code, 'openai_auth');
  nextReply = { status: 429, body: { error: { message: 'You exceeded your current quota, please check your plan and billing details.' } } };
  r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: audio() });
  assert.equal((await r.json()).error.code, 'openai_quota');
  nextReply = { status: 404, body: { error: { message: 'The model `x` does not exist' } } };
  r = await fetch(url + '/api/cards/parse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'ace' }) });
  assert.equal((await r.json()).error.code, 'openai_model');
}));

test('server errors from OpenAI are retried once', () => withApp(config(), async url => {
  seen = []; nextReply = { status: 500, body: { error: { message: 'boom' } } };
  const r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: audio() });
  assert.equal(r.status, 200);
  assert.equal(seen.length, 2);
}));

test('access code guards metered routes only', () => withApp(config({ accessCode: 'felt' }), async url => {
  assert.equal((await (await fetch(url + '/api/status')).json()).accessCodeRequired, true);
  let r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: audio() });
  assert.equal(r.status, 401); assert.equal((await r.json()).error.code, 'access_code_required');
  r = await fetch(url + '/api/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/webm', 'X-Access-Code': 'felt' }, body: audio() });
  assert.equal(r.status, 200);
}));

test('rate limit returns 429 with Retry-After', () => withApp(config({ rateLimitPerMin: 2 }), async url => {
  const call = () => fetch(url + '/api/cards/parse', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '9.9.9.9' }, body: JSON.stringify({ text: 'ace of spades' }) });
  assert.equal((await call()).status, 200);
  assert.equal((await call()).status, 200);
  const r = await call();
  assert.equal(r.status, 429); assert.ok(Number(r.headers.get('retry-after')) > 0);
}));

test('static files, headers, redirects and 404s', () => withApp(config(), async url => {
  let r = await fetch(url + '/');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('permissions-policy'), /microphone=\(self\)/);
  assert.match(await r.text(), /Hand Walkthrough/);
  r = await fetch(url + '/voice.js'); assert.equal(r.status, 200); assert.match(r.headers.get('content-type'), /javascript/);
  r = await fetch(url + '/..%2fpackage.json'); assert.equal(r.status, 404);
  r = await fetch(url + '/%2e%2e/server/config.js'); assert.equal(r.status, 404);
  r = await fetch(url + '/api/nope'); assert.equal(r.status, 404); assert.equal((await r.json()).error.code, 'not_found');
  r = await fetch(url + '/api/transcribe'); assert.equal(r.status, 405);
  r = await fetch(url + '/?x=1', { headers: { 'X-Forwarded-Proto': 'http' }, redirect: 'manual' });
  assert.equal(r.status, 308); assert.equal(r.headers.get('location'), url.replace('http:', 'https:') + '/?x=1');
  r = await fetch(url + '/health', { headers: { 'X-Forwarded-Proto': 'http' } }); assert.equal(r.status, 200);
}));

test('normalizeDeal enforces street order and valid codes', () => {
  const d = normalizeDeal({ hero: ['ah', 'Zz'], flop: ['Kd', 'Qd'], turn: 'Jd', river: '2c', unclear: '' });
  assert.deepEqual(d.hero, ['Ah']);
  assert.deepEqual(d.flop, ['Kd', 'Qd']);
  assert.equal(d.turn, null); assert.equal(d.river, null); // no turn without a full flop
  assert.match(d.unclear, /ignored Zz/);
});

// ----- camera card reading -----
const { normalize: normalizeVision } = require('../server/vision');
const PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

test('vision: a frame goes to the model with the image and a strict schema', () => withApp(config(), async url => {
  seen = [];
  nextReply = { status: 200, body: { output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify({ board: ['Kh', '7h', '2c'], hero: ['As', 'Ad'], unsure: [] }) }] }] } };
  const r = await fetch(url + '/api/cards/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: PIXEL }) });
  const j = await r.json();
  assert.equal(r.status, 200, JSON.stringify(j));
  assert.deepEqual(j.board, ['Kh', '7h', '2c']); assert.deepEqual(j.hero, ['As', 'Ad']);
  const sent = JSON.parse(seen.find(x => x.path === '/v1/responses').body.toString());
  assert.equal(sent.text.format.type, 'json_schema'); assert.equal(sent.text.format.strict, true);
  const img = sent.input[1].content.find(c => c.type === 'input_image');
  assert.ok(img.image_url.startsWith('data:image/png;base64,'));
}));

test('vision: rejects a missing image and answers 503 without any model', async () => {
  await withApp(config(), async url => {
    const r = await fetch(url + '/api/cards/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: 'hello' }) });
    assert.equal(r.status, 400);
  });
  await withApp(config({ openai: { apiKey: '' } }), async url => {
    const r = await fetch(url + '/api/cards/vision', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: PIXEL }) });
    assert.equal(r.status, 503); assert.equal((await r.json()).error.code, 'vision_not_configured');
  });
});

test('vision: answers are cleaned: no repeats, a board of 0/3/4/5 and a hand of 0/2', () => {
  assert.deepEqual(normalizeVision({ board: ['Kh', '7h', '2c', '9s'], hero: [], unsure: [] }), { board: ['Kh', '7h', '2c', '9s'], hero: null, betting: null, unsure: [], rotate: 0 });
  assert.equal(normalizeVision({ board: [], hero: [], unsure: [], rotate: 90 }).rotate, 90); // sideways: turn it a quarter clockwise
  assert.equal(normalizeVision({ board: [], hero: [], unsure: [], rotate: 45 }).rotate, 0);
  const twice = normalizeVision({ board: ['Kh', '7h', '2c'], hero: ['Kh', 'Ad'], unsure: [] });
  assert.equal(twice.hero, null); assert.match(twice.unsure.join(), /twice/);
  assert.equal(normalizeVision({ board: ['Kh', '7h'], hero: ['As', 'Ad'], unsure: [] }).board, null);
  assert.equal(normalizeVision({ board: [], hero: ['As'], unsure: [] }).hero, null);
  assert.equal(normalizeVision({ board: ['Zz', '7h', '2c'], hero: [], unsure: [] }).board, null);
});

test('vision: betting is passed through only when it adds up', () => {
  const seats = [{ position: 'UTG', folded: false, in_front: 6, last_action: 'raise' }, { position: 'BB', folded: false, in_front: 2, last_action: 'post' }];
  const ok = normalizeVision({ board: [], hero: ['As', 'Kd'], unsure: [], betting: { readable: true, players: 2, hero_position: 'BB', to_act: 'BB', unit: 'chips', seats } });
  assert.deepEqual(ok.betting, { players: 2, heroPosition: 'BB', toAct: 'BB', unit: 'chips', seats: { UTG: { folded: false, bet: 6, last: 'raise' }, BB: { folded: false, bet: 2, last: 'post' } } });
  assert.equal(normalizeVision({ board: [], hero: [], unsure: [], betting: { readable: false, players: 2, hero_position: 'BB', to_act: 'BB', unit: 'chips', seats } }).betting, null);
  assert.equal(normalizeVision({ board: [], hero: [], unsure: [], betting: { readable: true, players: 3, hero_position: 'BB', to_act: 'BB', unit: 'chips', seats } }).betting, null);
  assert.equal(normalizeVision({ board: [], hero: [], unsure: [], betting: { readable: true, players: 2, hero_position: 'BB', to_act: 'CO', unit: 'chips', seats } }).betting, null);
});

test('vision: whole-table reading is strict about what it could read', () => {
  const { normalizeTable } = require('../server/vision');
  const seat = (o = {}) => ({ name: 'A', stack: 100, dealer: false, folded: false, in_front: 0, last_action: 'none', ...o });
  const ok = normalizeTable({ readable: { cards: true, seats: true, names: true, stacks: true, betting: true }, problems: [], unit: 'chips', small_blind: 0.5, big_blind: 1,
    seats: [seat({ name: 'You' }), seat({ name: 'B', dealer: true, in_front: 2, last_action: 'raise' })], to_act: 0, board: ['As', 'Kd', '2c'], hero: ['Qh', 'Qs'] });
  assert.deepEqual(ok.blinds, { small: 0.5, big: 1 }); assert.equal(ok.toAct, 0); assert.equal(ok.seats[1].bet, 2);
  assert.ok(ok.readable.seats && ok.readable.stacks && ok.readable.betting);
  const bad = normalizeTable({ readable: { cards: true, seats: true, names: true, stacks: true, betting: true }, problems: [], unit: 'chips', small_blind: 0, big_blind: 0,
    seats: [seat({ name: '' }), seat({ stack: -1 })], to_act: -1, board: [], hero: [] });
  assert.equal(bad.readable.seats, false); // no dealer button seen
  assert.equal(bad.readable.betting, false); assert.equal(bad.readable.names, false); assert.equal(bad.readable.stacks, false);
  assert.ok(bad.problems.length >= 1); assert.equal(bad.blinds, null);
});
