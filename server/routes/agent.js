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
    send.json(200, await runAgent(agent, { message, scenario: body.scenario, history }));
  });
};
