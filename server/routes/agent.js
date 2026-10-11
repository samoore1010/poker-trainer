'use strict';
// The table agent: POST {message, scenario, history?} → {reply, scenario, changes, stats}.
const { HttpError, readJson } = require('../http');
const { runAgent } = require('../agent');

module.exports = function agentRoutes(router, { agent }) {
  router.post('/api/agent', { metered: true }, async (req, res, { send }) => {
    if (!agent) throw new HttpError(503, 'agent_not_configured', 'The table agent needs OPENAI_API_KEY or ANTHROPIC_API_KEY set on the server.');
    const body = await readJson(req, 256 * 1024);
    const message = typeof body.message === 'string' ? body.message.trim() : '';
    if (!message) throw new HttpError(400, 'text_required', 'Send {"message": "...", "scenario": {...}}');
    if (message.length > 2000) throw new HttpError(413, 'too_long', 'Message is over 2000 characters.');
    const history = (Array.isArray(body.history) ? body.history : [])
      .filter(h => h && (h.role === 'user' || h.role === 'assistant') && typeof h.text === 'string' && h.text.trim())
      .slice(-6).map(h => ({ role: h.role, text: h.text.slice(0, 2000) }));
    if (history.length && history[0].role === 'assistant') history.shift();
    // Accept: application/x-ndjson streams progress (status lines, the new table as soon as it changes, then the reply).
    if (!/ndjson/.test(req.headers.accept || '')) return send.json(200, await runAgent(agent, { message, scenario: body.scenario, history }));
    res.writeHead(200, { 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    const write = ev => { if (!res.writableEnded) res.write(JSON.stringify(ev) + '\n'); };
    try { write({ type: 'done', ...(await runAgent(agent, { message, scenario: body.scenario, history }, write)) }); }
    catch (e) { write({ type: 'error', code: e.code || 'server_error', message: e.code ? e.message : 'Something went wrong on the server.' }); }
    res.end();
  });
};
