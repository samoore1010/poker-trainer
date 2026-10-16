'use strict';
importScripts('vision.js');
self.onmessage = async ({ data }) => {
  try {
    if (data.templates) { await CardVision.init(data.templates); return; }
    const result = CardVision.analyze(new Uint8ClampedArray(data.pixels), data.width, data.height, data.options);
    self.postMessage({ id: data.id, result });
  } catch (e) { self.postMessage({ id: data.id, error: e.message }); }
};
