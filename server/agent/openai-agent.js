'use strict';
// Agent loop on the OpenAI Responses API with function calling.
// Each round sends the tool results back with previous_response_id until the model answers in text.

function textOf(res) {
  if (typeof res.output_text === 'string' && res.output_text) return res.output_text;
  return (res.output || []).filter(o => o.type === 'message').flatMap(o => o.content || []).filter(c => c.type === 'output_text').map(c => c.text).join('').trim();
}

function createOpenAIAgent({ openai, model, maxRounds = 8 }) {
  return {
    name: 'openai', model,
    async run({ system, history, userText, tools, execute }) {
      const fnTools = tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters, strict: false }));
      let input = history.map(h => ({ role: h.role, content: h.text })).concat([{ role: 'user', content: userText }]);
      let prev = null;
      for (let round = 0; round < maxRounds; round++) {
        const res = await openai.responses({ model, instructions: system, input, tools: fnTools, ...(prev ? { previous_response_id: prev } : {}) });
        prev = res.id;
        const calls = (res.output || []).filter(o => o.type === 'function_call');
        if (!calls.length) return { reply: textOf(res) };
        input = calls.map(c => {
          let args; try { args = JSON.parse(c.arguments || '{}'); } catch (e) { return { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify({ error: 'Arguments were not valid JSON; send them again.' }) }; }
          return { type: 'function_call_output', call_id: c.call_id, output: JSON.stringify(execute(c.name, args)) };
        });
      }
      return { reply: 'I made the changes but ran out of steps before summarizing. Ask me to explain the spot.' };
    },
  };
}

module.exports = { createOpenAIAgent };
