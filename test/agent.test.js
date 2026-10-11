'use strict';
// Agent loop against fake OpenAI (Responses API) and Anthropic (Messages API) servers.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { createApp } = require('../server/app');

let mock, url, seen = [];
const PLAN = [['update_table', { new_table: { opponents: 3, hero_position: 'BTN' }, hero_cards: ['Ah', 'Qh'], opponents: [{ seat: 'BB', range: 'QQ+, AK' }], board: ['Kh', '7h', '2c'] }]];
const winOf = o => (o.stats || o).win_pct;
before(async () => {
  mock = http.createServer((req, res) => {
    const chunks = []; req.on('data', c => chunks.push(c)); req.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); seen.push({ url: req.url, headers: req.headers, body });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v1/responses') {
        if (!body.previous_response_id) return res.end(JSON.stringify({ id: 'r1', output: PLAN.map(([name, a], i) => ({ type: 'function_call', call_id: 'c' + i, name, arguments: JSON.stringify(a) })) }));
        const calc = body.input.map(x => JSON.parse(x.output)).find(o => winOf(o) !== undefined).stats;
        return res.end(JSON.stringify({ id: 'r2', output: [{ type: 'message', content: [{ type: 'output_text', text: `win ${calc.win_pct}` }] }] }));
      }
      if (req.url.startsWith('/v1/messages')) {
        const last = body.messages[body.messages.length - 1], base = { id: 'm', type: 'message', role: 'assistant', model: body.model, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 1 } };
        if (typeof last.content === 'string') return res.end(JSON.stringify({ ...base, stop_reason: 'tool_use', content: PLAN.map(([name, input], i) => ({ type: 'tool_use', id: 't' + i, name, input })) }));
        const calc = last.content.map(b => JSON.parse(typeof b.content === 'string' ? b.content : b.content[0].text)).find(o => winOf(o) !== undefined).stats;
        return res.end(JSON.stringify({ ...base, stop_reason: 'end_turn', content: [{ type: 'text', text: `win ${calc.win_pct}` }] }));
      }
      res.statusCode = 404; res.end('{}');
    });
  });
  await new Promise(r => mock.listen(0, '127.0.0.1', r)); url = `http://127.0.0.1:${mock.address().port}`;
});
after(() => mock.close());

function cfg(agent, openaiKey = 'sk-test') {
  return { accessCode: '', rateLimitPerMin: 100, maxAudioBytes: 1e6, openai: { apiKey: openaiKey, baseUrl: url + '/v1', timeoutMs: 5000, agentModel: 'gpt-test' }, agent };
}
async function call(config, payload) {
  const srv = http.createServer(createApp(config, { log: () => {} }));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try { const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); return { status: r.status, body: await r.json() }; }
  finally { srv.close(); }
}
const check = body => {
  assert.deepEqual(body.scenario.hero.cards, ['Ah', 'Qh']);
  assert.deepEqual(body.scenario.board, ['Kh', '7h', '2c']);
  assert.equal(body.scenario.street, 1);
  assert.equal(body.changes.length, 4);
  assert.ok(body.stats.recommendation && body.stats.recommendation.action);
  assert.match(body.reply, /^win \d/);
  assert.equal(body.stats.street, 'flop');
};

test('OpenAI provider runs the tool loop', async () => {
  seen = [];
  const { status, body } = await call(cfg({ provider: 'openai' }), { message: 'set it up', scenario: {} });
  assert.equal(status, 200, JSON.stringify(body)); check(body);
  assert.equal(body.provider, 'openai');
  const first = seen.find(s => s.url === '/v1/responses');
  assert.equal(first.body.model, 'gpt-test'); assert.equal(first.body.tools.length, 3);
  assert.match(first.body.input.at(-1).content, /Current table:/); assert.match(first.body.input.at(-1).content, /Current stats and recommendation/);
  assert.equal(seen.filter(s => s.url === '/v1/responses').length, 2); // one tool round + the answer
});

test('Claude provider runs the tool loop with fallbacks', async () => {
  seen = [];
  const { status, body } = await call(cfg({ provider: 'anthropic', anthropicKey: 'sk-ant-test', anthropicModel: 'claude-opus-5-5', anthropicBaseUrl: url, effort: 'medium', maxRounds: 8 }), { message: 'set it up', scenario: {}, history: [{ role: 'assistant', text: 'dropped' }, { role: 'user', text: 'earlier' }, { role: 'assistant', text: 'ok' }] });
  assert.equal(status, 200, JSON.stringify(body)); check(body);
  const first = seen.find(s => s.url.startsWith('/v1/messages'));
  assert.equal(first.body.model, 'claude-opus-5-5');
  assert.equal(first.body.fallbacks, 'default');
  assert.match(first.headers['anthropic-beta'], /server-side-fallback-2026-07-01/);
  assert.deepEqual(first.body.output_config, { effort: 'medium' });
  assert.equal(first.body.messages[0].role, 'user'); // history never starts with the assistant
});

test('no provider configured → 503', async () => {
  const { status, body } = await call(cfg({}, ''), { message: 'hi', scenario: {} });
  assert.equal(status, 503); assert.equal(body.error.code, 'agent_not_configured');
});

test('streams progress, the new table, then the answer', async () => {
  const srv = http.createServer(createApp(cfg({ provider: 'openai' }), { log: () => {} }));
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/agent`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' }, body: JSON.stringify({ message: 'set it up', scenario: {} }) });
    assert.match(r.headers.get('content-type'), /ndjson/);
    const events = (await r.text()).trim().split('\n').map(l => JSON.parse(l));
    const types = events.map(e => e.type);
    assert.equal(types[0], 'status'); assert.ok(types.includes('scenario')); assert.equal(types.at(-1), 'done');
    assert.ok(types.indexOf('scenario') < types.indexOf('done'));
    assert.deepEqual(events.find(e => e.type === 'scenario').scenario.hero.cards, ['Ah', 'Qh']);
    check(events.at(-1));
  } finally { srv.close(); }
});
