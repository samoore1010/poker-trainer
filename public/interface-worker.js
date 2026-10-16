'use strict';
importScripts('interface-vision.js');
InterfaceVision.init();
self.onmessage = ({ data }) => {
  try {
    let frame = { pixels: new Uint8ClampedArray(data.pixels), width: data.width, height: data.height };
    if (data.corners) frame = InterfaceVision.rectify(frame.pixels, frame.width, frame.height, data.corners);
    self.postMessage({ id: data.id, context: data.context, at: data.at, result: InterfaceVision.analyze(frame.pixels, frame.width, frame.height, data.profile) });
  } catch (e) { self.postMessage({ id: data.id, context: data.context, error: e.message }); }
};
