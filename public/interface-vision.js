// Constrained OCR for explicitly selected screen layouts. Unknown layouts never imply a turn.
(function (root) {
  'use strict';
  const profiles = {
    generic: null,
    pure: { label: 'Pure portrait (5 seats)', aspect: 0.46,
      fold: [0.04, 0.90, 0.34, 0.962], middle: [0.35, 0.90, 0.65, 0.962], raise: [0.66, 0.90, 0.97, 0.962],
      timer: [0.39, 0.855, 0.61, 0.867], pot: [0.43, 0.38, 0.57, 0.40],
      // Rank patches on the two overlapping four-colour cards; sample in card-local coordinates.
      contributions: { 0: [0.47,0.69,0.53,0.708], 1: [0.25,0.58,0.30,0.598], 4: [0.68,0.58,0.76,0.602] },
      actions: { 1: [0.09,0.482,0.19,0.51], 2: [0.20,0.133,0.30,0.16], 3: [0.685,0.133,0.79,0.16], 4: [0.78,0.482,0.89,0.51] },
      cards: [{ x: 0.65, y: 0.794, angle: -10 }, { x: 0.728, y: 0.787, angle: 10 }] }
  };
  let templates = [];
  function glyph(mask, w, h) {
    let x0 = w, x1 = -1, y0 = h, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    if (x1 < x0) return null;
    const out = new Float32Array(20 * 28), bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    for (let y = 0; y < 28; y++) for (let x = 0; x < 20; x++) {
      let sum = 0;
      for (let yy = 0; yy < 3; yy++) for (let xx = 0; xx < 3; xx++) sum += mask[Math.min(y1, y0 + Math.floor((y + (yy + 0.5) / 3) * bh / 28)) * w + Math.min(x1, x0 + Math.floor((x + (xx + 0.5) / 3) * bw / 20))];
      out[y * 20 + x] = sum / 9;
    }
    return { pixels: out, aspect: bw / bh, x0, x1, y0, y1 };
  }
  function init(supplied) {
    if (supplied) { templates = supplied; return templates; }
    if (templates.length) return templates;
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(70, 70) : document.createElement('canvas');
    canvas.width = canvas.height = 70; const g = canvas.getContext('2d');
    for (const font of ['bold 36px Arial', '600 36px sans-serif', '36px Arial']) for (const char of 'FoldCaheckRisBt0123456789.AKQJT') {
      g.fillStyle = 'black'; g.fillRect(0, 0, 70, 70); g.fillStyle = 'white'; g.font = font; g.fillText(char, 8, 48);
      const rgba = g.getImageData(0, 0, 70, 70).data, mask = new Uint8Array(4900);
      for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4] > 160 ? 1 : 0;
      templates.push({ char, ...glyph(mask, 70, 70) });
    }
    return templates;
  }
  function read(px, w, h, box, allowed = 'FoldCaheckRisBt0123456789.') {
    const x0 = Math.max(0, Math.floor(box[0] * w)), y0 = Math.max(0, Math.floor(box[1] * h));
    const W = Math.max(1, Math.min(w - x0, Math.ceil((box[2] - box[0]) * w))), H = Math.max(1, Math.min(h - y0, Math.ceil((box[3] - box[1]) * h)));
    const mask = new Uint8Array(W * H), columns = new Uint16Array(W);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = ((y + y0) * w + x + x0) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
      // White text and yellow monetary text, excluding saturated red/blue buttons.
      if ((r > 170 && g > 170 && b > 170) || (r > 170 && g > 130 && b < 130)) { mask[y * W + x] = 1; columns[x]++; }
    }
    const runs = []; let start = -1;
    for (let x = 0; x <= W; x++) {
      if (x < W && columns[x] > 0) { if (start < 0) start = x; }
      else if (start >= 0) { if (x - start >= 1) runs.push([start, x]); start = -1; }
    }
    let text = '', confidence = 1;
    const shapes = runs.map(([a, b]) => {
      const sub = new Uint8Array((b - a) * H);
      for (let y = 0; y < H; y++) sub.set(mask.subarray(y * W + a, y * W + b), y * (b - a));
      return glyph(sub, b - a, H);
    }).filter(Boolean);
    const maxH = Math.max(1, ...shapes.map(s => s.y1 - s.y0 + 1));
    for (const shape of shapes) {
      if (shape.y1 - shape.y0 + 1 < maxH * 0.3) { if (allowed.includes('.') && shape.y0 > H * 0.45) text += '.'; else return { text: '', confidence: 0 }; continue; }
      const best = new Map();
      for (const t of templates) {
        if (!allowed.includes(t.char)) continue;
        let error = 0; for (let i = 0; i < shape.pixels.length; i++) error += Math.abs(shape.pixels[i] - t.pixels[i]);
        const score = 1 - error / shape.pixels.length - 0.15 * Math.abs(Math.log(shape.aspect / t.aspect));
        best.set(t.char, Math.max(best.get(t.char) || -1, score));
      }
      const ranked = [...best].sort((a, b) => b[1] - a[1]);
      if (!ranked.length || ranked[0][1] < 0.76 || (ranked[1] && ranked[0][1] - ranked[1][1] < 0.015)) return { text: '', confidence: 0 };
      text += ranked[0][0]; confidence = Math.min(confidence, ranked[0][1]);
    }
    return { text, confidence: text ? confidence : 0 };
  }
  function colorFraction(px, w, h, box, predicate) {
    let total = 0, found = 0;
    for (let y = Math.floor(box[1] * h); y < box[3] * h; y += 2) for (let x = Math.floor(box[0] * w); x < box[2] * w; x += 2) {
      const i = (y * w + x) * 4; total++; if (predicate(px[i], px[i + 1], px[i + 2])) found++;
    }
    return found / Math.max(1, total);
  }
  function coloredHand(px, w, h, profile) {
    const cards = [];
    for (const c of profile.cards) {
      const W = 44, H = 52, patch = new Uint8ClampedArray(W * H * 4), angle = c.angle * Math.PI / 180;
      let red = 0, green = 0, blue = 0, dark = 0;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const dx = (x / W - 0.5) * w * 0.045, dy = (y / H - 0.5) * h * 0.026;
        const sx = Math.round(c.x*w + dx*Math.cos(angle) - dy*Math.sin(angle));
        const sy = Math.round(c.y*h + dx*Math.sin(angle) + dy*Math.cos(angle));
        if (sx < 0 || sx >= w || sy < 0 || sy >= h) continue;
        const at = (sy*w+sx)*4, r = px[at], g = px[at+1], b = px[at+2];
        patch.set(px.subarray(at, at+4), (y*W+x)*4);
        if (r > 100 && r > g*1.5 && r > b*1.3) red++;
        else if (g > 65 && g > r*1.3 && g > b*1.1) green++;
        else if (b > 90 && b > r*1.4 && b > g*1.1) blue++;
        else if (Math.max(r,g,b) < 70) dark++;
      }
      const ranked = [['h',red],['c',green],['d',blue],['s',dark]].sort((a,b) => b[1]-a[1]);
      const rank = read(patch, W, H, [0,0,1,1], '23456789TJQKA');
      if (rank.text.length !== 1 || rank.confidence < 0.86 || ranked[0][1] < W*H*0.35 || ranked[1][1] > ranked[0][1]*0.3) return null;
      cards.push(rank.text + ranked[0][0]);
    }
    return new Set(cards).size === 2 ? cards : null;
  }
  function analyze(px, w, h, profileName) {
    const p = profiles[profileName];
    if (!p || Math.abs(w / h - p.aspect) > 0.12) return { controls: null, reason: 'Select and frame the source screen layout.' };
    const fold = read(px, w, h, p.fold, 'Fold'), middle = read(px, w, h, p.middle, 'CalCheck0123456789.'), raise = read(px, w, h, p.raise, 'RaiseBet');
    const timer = colorFraction(px, w, h, p.timer, (r, g, b) => b > 110 && b > r * 1.3 && g > 65) > 0.08;
    const activeColors = colorFraction(px, w, h, p.fold, (r, g, b) => r > 100 && r > g * 1.5 && r > b * 1.2) > 0.25 &&
      colorFraction(px, w, h, p.raise, (r, g, b) => b > 100 && b > r * 1.4) > 0.25;
    const match = /^Call(\d+(?:\.\d+)?)$/.exec(middle.text), check = middle.text === 'Check';
    const active = fold.text === 'Fold' && ['Raise', 'Bet'].includes(raise.text) && !!(match || check) && activeColors && timer;
    const pot = read(px, w, h, p.pot, '0123456789.');
    const contributions = {}, actions = {};
    for (const [seat, box] of Object.entries(p.contributions)) {
      const r = read(px,w,h,box,'0123456789.');
      if (r.confidence >= 0.9 && /^\d+(\.\d+)?$/.test(r.text)) contributions[seat] = Number(r.text);
    }
    for (const [seat, box] of Object.entries(p.actions)) {
      const r = read(px,w,h,box,'FoldRaiseCheck');
      if (r.confidence >= 0.88 && ['Fold','Raise','Check'].includes(r.text)) actions[seat] = r.text.toLowerCase();
    }
    return { contributions, actions, hero: coloredHand(px, w, h, p), controls: { active, enabled: activeColors, action: check ? 'check' : 'call', toCall: match ? Number(match[1]) : check ? 0 : null,
      confidence: Math.min(fold.confidence, middle.confidence, raise.confidence), timer, unit: null },
      pot: pot.confidence >= 0.85 && /^\d+(\.\d+)?$/.test(pot.text) ? Number(pot.text) : null,
      evidence: { fold, middle, raise }, profile: profileName };
  }
  // Four-point projective transform: destination unit square to source quadrilateral.
  function homography(points) {
    if (!Array.isArray(points) || points.length !== 4 || points.some(p => p.length !== 2 || p.some(v => !Number.isFinite(v) || v < 0 || v > 1))) throw new Error('Choose four screen corners.');
    const turns = points.map((p,i) => { const q=points[(i+1)%4], r=points[(i+2)%4]; return (q[0]-p[0])*(r[1]-q[1])-(q[1]-p[1])*(r[0]-q[0]); });
    if (turns.some(t => t <= 1e-5)) throw new Error('Choose corners clockwise starting at the top left.');
    const dest = [[0, 0], [1, 0], [1, 1], [0, 1]], rows = [];
    points.forEach(([u, v], i) => { const [x, y] = dest[i]; rows.push([x,y,1,0,0,0,-u*x,-u*y,u], [0,0,0,x,y,1,-v*x,-v*y,v]); });
    for (let i = 0; i < 8; i++) {
      let best = i; for (let j = i + 1; j < 8; j++) if (Math.abs(rows[j][i]) > Math.abs(rows[best][i])) best = j;
      [rows[i], rows[best]] = [rows[best], rows[i]];
      const pivot = rows[i][i]; if (Math.abs(pivot) < 1e-8) throw new Error('Screen corners must form a quadrilateral.');
      for (let k = i; k <= 8; k++) rows[i][k] /= pivot;
      for (let j = 0; j < 8; j++) if (j !== i) { const f = rows[j][i]; for (let k = i; k <= 8; k++) rows[j][k] -= f * rows[i][k]; }
    }
    return rows.map(r => r[8]);
  }
  function rectify(px, w, h, points, W = 736, H = 1600) {
    const a = homography(points), out = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / (W - 1), v = y / (H - 1), z = a[6]*u+a[7]*v+1;
      const sx = (a[0]*u+a[1]*v+a[2])/z*(w-1), sy = (a[3]*u+a[4]*v+a[5])/z*(h-1);
      const xi = Math.max(0, Math.min(w-1, Math.round(sx))), yi = Math.max(0, Math.min(h-1, Math.round(sy)));
      out.set(px.subarray((yi*w+xi)*4, (yi*w+xi)*4+4), (y*W+x)*4);
    }
    return { pixels: out, width: W, height: H };
  }
  const api = { init, analyze, read, profiles, homography, rectify };
  if (typeof module === 'object' && module.exports) module.exports = api; else root.InterfaceVision = api;
})(typeof self !== 'undefined' ? self : this);
