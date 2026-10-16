'use strict';
importScripts('engine.js', 'strategy.js', 'ranges.js', 'ev.js', 'scenario.js');
self.onmessage = ({ data }) => {
  try {
    const { scenario, street, hero, board } = data;
    // Preflop charts need no Monte Carlo simulation. Postflop work is isolated here.
    const eq = street === 0 ? { chance: 0 } : PokerEngine.equity({ hero, board,
      opps: PokerScenario.engineOpponents(scenario, street), trials: 2000 });
    const result = PokerScenario.recommendation(scenario, street, hero, board, eq);
    self.postMessage({ key: data.key, result });
  } catch (e) { self.postMessage({ key: data.key, error: e.message }); }
};
