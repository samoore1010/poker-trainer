'use strict';
// Picks the LLM behind the table agent and runs one user request against a scenario.
const S = require('../../public/scenario.js');
const SYSTEM = require('./prompt');
const { DEFS, execute, calculate } = require('./tools');
const { createOpenAIAgent } = require('./openai-agent');

function createAgent(config, openai) {
  const a = config.agent || {};
  const provider = a.provider || (a.anthropicKey ? 'anthropic' : openai.configured ? 'openai' : '');
  if (provider === 'anthropic' && a.anthropicKey) {
    const { createAnthropicAgent } = require('./anthropic-agent');
    return createAnthropicAgent({ apiKey: a.anthropicKey, model: a.anthropicModel, effort: a.effort, maxRounds: a.maxRounds, timeoutMs: a.timeoutMs, baseURL: a.anthropicBaseUrl });
  }
  if (provider === 'openai' && openai.configured) return createOpenAIAgent({ openai, model: config.openai.agentModel || 'gpt-6-astra', maxRounds: a.maxRounds || 8, reasoning: config.openai.agentReasoning });
  return null;
}

// One request: the user's words + the current scenario (+ a little chat history) → the new scenario and a reply.
// emit(event) streams progress: {type:'status', text} and {type:'scenario', scenario, changes} as soon as edits land.
async function runAgent(agent, { message, scenario, history }, emit = () => {}) {
  const { scenario: sc, fixes } = S.normalize(scenario);
  const state = { scenario: sc, changes: [], lastStats: null, emit };
  // The current numbers go in up front, so a plain question ("should I call?") needs no tool call at all.
  const now = calculate(sc);
  const userText = `Current table:\n${S.summary(sc)}${fixes.length ? `\n(Repaired on load: ${fixes.join('; ')})` : ''}\n\nCurrent stats and recommendation (from the engine):\n${JSON.stringify(now)}\n\nUser: ${message}`;
  const started = Date.now();
  const { reply } = await agent.run({
    system: SYSTEM, history, userText, tools: DEFS,
    execute: (name, args) => { emit({ type: 'status', text: name === 'update_table' ? 'Updating the table…' : 'Running the numbers…' }); return execute(state, name, args); },
    onRound: n => emit({ type: 'status', text: n === 0 ? 'Thinking…' : 'Writing the answer…' }),
  });
  return { reply, scenario: state.scenario, changes: state.changes, stats: state.lastStats || (now.error ? null : now), provider: agent.name, model: agent.model, ms: Date.now() - started };
}

module.exports = { createAgent, runAgent };
