// Runs the poker engine off the main thread so big simulations never freeze the page.
importScripts('engine.js');
const E = self.PokerEngine;
self.onmessage = ({ data }) => {
  const { id, kind, args } = data;
  try {
    let result;
    if (kind === 'equity') result = E.equity(args);
    else if (kind === 'strip') result = [1, 2, 3, 4, 5, 6, 7, 8].map(k => E.winChanceQuick(args.hero, [], k, args.trials || 2500));
    else throw new Error('unknown job ' + kind);
    self.postMessage({ id, result });
  } catch (e) { self.postMessage({ id, error: e.message }); }
};
