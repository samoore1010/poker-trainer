// Card vision: finds playing cards in a camera frame and reads them, entirely in the browser (no model download,
// nothing sent anywhere). Built for cards drawn the way this app draws them — a white face with the rank in the
// top-left and the suit in the bottom-right — so a phone pointed at another screen running the app can follow its hand.
//
// Pipeline per frame:
//  1. Card faces: bright, colourless pixels → connected regions → keep card-shaped ones (rotation allowed; a row of
//     touching cards is split into single cards).
//  2. Each face is resampled upright; the ink in its top-left corner is the rank and in its bottom-right the suit.
//  3. Glyphs are matched against templates drawn on a canvas with the same fonts (rank: 13 letters; suit: colour picks
//     red ♥♦ or black ♠♣, then shape picks one of the two).
//  4. Layout: the row of 3–5 cards in the middle is the board (left to right = deal order); the larger pair below it is
//     your hand.
(function (root) {
  'use strict';
  const RANKS = '23456789TJQKA';
  const SUIT_SYM = { c: '♣', d: '♦', h: '♥', s: '♠' };
  const GW = 14, GH = 18;          // rank glyph grid
  const SG = 20;                   // suit glyph grid (finer: a spade's point vs a club's round top)
  const FW = 72, FH = 100;         // a card face resampled upright
  const CARD_ASPECT = 0.71;        // width / height of the app's cards

  // ----- glyph templates -----
  let templates = null;
  function inkOf(data, w, h) { const out = new Float32Array(w * h); for (let i = 0; i < w * h; i++) { const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2]; out[i] = Math.max(0, Math.min(1, (255 - (r * 0.299 + g * 0.587 + b * 0.114)) / 200)); } return out; }
  function bboxOf(ink, w, h, thr) {
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[y * w + x] > thr) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }
  // Area-average a box of a float map onto a GW×GH grid (4×4 bilinear samples per cell).
  function resample(m, w, h, b, gw = GW, gh = GH) {
    const GW = gw, GH = gh, out = new Float32Array(GW * GH), bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1;
    const at = (x, y) => {
      x = Math.max(0, Math.min(w - 1, x)); y = Math.max(0, Math.min(h - 1, y));
      const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi, x2 = Math.min(w - 1, xi + 1), y2 = Math.min(h - 1, yi + 1);
      return m[yi * w + xi] * (1 - fx) * (1 - fy) + m[yi * w + x2] * fx * (1 - fy) + m[y2 * w + xi] * (1 - fx) * fy + m[y2 * w + x2] * fx * fy;
    };
    for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) {
      let s = 0;
      for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) s += at(b.x0 - 0.5 + (gx + (sx + 0.5) / 4) / GW * bw, b.y0 - 0.5 + (gy + (sy + 0.5) / 4) / GH * bh);
      out[gy * GW + gx] = s / 16;
    }
    return out;
  }
  // The glyph's box: pixels within `box` darker than 40% of the darkest one (the same rule for templates and camera).
  function glyphBox(ink, w, h, box, frac = 0.4) {
    let mx = 0; for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) mx = Math.max(mx, ink[y * w + x]);
    if (mx < 0.05) return null;
    const t = mx * frac; let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = box.y0; y <= box.y1; y++) for (let x = box.x0; x <= box.x1; x++) if (ink[y * w + x] > t) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    return x1 < 0 ? null : { x0, y0, x1, y1 };
  }
  // Width of the top half of a glyph, row by row (0..1 of its box): a spade or diamond starts at a point, a club or heart wide.
  function topProfile(ink, w, h, b) {
    let mx = 0; for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) mx = Math.max(mx, ink[y * w + x]);
    const bw = b.x1 - b.x0 + 1, bh = b.y1 - b.y0 + 1, out = new Float32Array(8);
    for (let r = 0; r < 8; r++) {
      const y = Math.min(b.y1, Math.round(b.y0 + (r + 0.5) / 16 * bh)); let s = 0;
      for (let x = b.x0; x <= b.x1; x++) s += Math.min(1, ink[y * w + x] / (0.6 * mx));
      out[r] = s / bw;
    }
    return out;
  }
  // A suit is compared by a square from its top, as wide as the symbol: stems (which blur away) don't matter.
  const square = (b, h) => ({ x0: b.x0, y0: b.y0, x1: b.x1, y1: Math.min(h - 1, b.y0 + (b.x1 - b.x0)) });
  function ncc(a, b) {
    let ma = 0, mb = 0; for (let i = 0; i < a.length; i++) { ma += a[i]; mb += b[i]; } ma /= a.length; mb /= b.length;
    let sab = 0, saa = 0, sbb = 0; for (let i = 0; i < a.length; i++) { const x = a[i] - ma, y = b[i] - mb; sab += x * y; saa += x * x; sbb += y * y; }
    return saa && sbb ? sab / Math.sqrt(saa * sbb) : 0;
  }
  async function init(supplied) {
    if (supplied) { templates = supplied; return templates; }
    if (templates) return templates;
    try { if (document.fonts) await Promise.race([document.fonts.load('600 64px "IBM Plex Mono"'), new Promise(r => setTimeout(r, 2500))]); } catch (e) { /* fall back to system fonts */ }
    // drawn small and at several blurs, like a glyph seen through a camera
    const S = 72, cv = document.createElement('canvas'); cv.width = cv.height = S;
    const g = cv.getContext('2d', { willReadFrequently: true });
    const draw = (ch, font, blur, frac) => {
      g.filter = 'none'; g.fillStyle = '#fff'; g.fillRect(0, 0, S, S); g.filter = blur ? `blur(${blur}px)` : 'none';
      g.fillStyle = '#000'; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(ch, S / 2, S / 2);
      const ink = inkOf(g.getImageData(0, 0, S, S).data, S, S), b = glyphBox(ink, S, S, { x0: 0, y0: 0, x1: S - 1, y1: S - 1 }, frac);
      return b ? { v: resample(ink, S, S, b), s: resample(ink, S, S, square(b, S), SG, SG), p: topProfile(ink, S, S, square(b, S)), aspect: (b.x1 - b.x0 + 1) / (b.y1 - b.y0 + 1) } : null;
    };
    const rankFonts = ['600 34px "IBM Plex Mono", monospace', 'bold 34px monospace', 'bold 34px sans-serif'];
    const suitFonts = ['34px "IBM Plex Mono", monospace', '34px sans-serif', '34px serif'];
    templates = { rank: [], suit: [] };
    for (const blur of [0, 1, 2, 3]) {
      for (const r of RANKS) for (const f of rankFonts) { const t = draw(r, f, blur); if (t) templates.rank.push({ label: r, blur, ...t }); }
      for (const s of 'cdhs') for (const f of suitFonts) { const t = draw(SUIT_SYM[s], f, blur, 0.22); if (t && !templates.suit.some(x => x.label === s && x.blur === blur && ncc(x.v, t.s) > 0.995)) templates.suit.push({ label: s, blur, ...t, v: t.s }); }
    }
    return templates;
  }
  // Best template for a glyph: correlation minus a penalty for a different shape (width ÷ height).
  const P = { full: 0.5, top: 0.5, prof: 1.5 }; // suit matching weights
  const TOP = Math.round(SG * 0.45) * SG; // the top of a suit symbol tells ♠ (pointed) from ♣ (round) and ♥ (notched) from ♦ (pointed)
  function match(list, v, aspect, allowed, prof, blur) {
    const best = new Map(), suit = v.length === SG * SG; let bestT = null, bestS = -Infinity;
    for (const t of list) {
      if (allowed && !allowed.includes(t.label)) continue;
      if (blur !== undefined && Math.abs(t.blur - blur) > 1) continue; // the same camera blur as the rank
      let sim = suit ? P.full * ncc(v, t.v) + P.top * ncc(v.subarray(0, TOP), t.v.subarray(0, TOP)) : ncc(v, t.v);
      if (prof && t.p) { let d = 0; for (let i = 0; i < 8; i++) d += Math.abs(prof[i] - t.p[i]); sim -= P.prof * d / 8; }
      const sc = suit ? sim : sim - 0.25 * Math.abs(Math.log(aspect / t.aspect));
      if (!best.has(t.label) || sc > best.get(t.label)) best.set(t.label, sc);
      if (sc > bestS) { bestS = sc; bestT = t; }
    }
    const ranked = [...best.entries()].sort((a, b) => b[1] - a[1]);
    return { label: ranked[0][0], score: ranked[0][1], margin: ranked.length > 1 ? ranked[0][1] - ranked[1][1] : 1, blur: bestT.blur };
  }

  // ----- 1. card faces -----
  function findFaces(px, w, h) {
    const n = w * h, mask = new Uint8Array(n);
    // brightness threshold: Otsu on luminance, never below 120
    const hist = new Uint32Array(256), raw = new Uint8Array(n), chroma = new Uint8Array(n), lum = new Uint8Array(n), sat = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]; raw[i] = (r * 77 + g * 150 + b * 29) >> 8; chroma[i] = Math.max(r, g, b) - Math.min(r, g, b); }
    // 3×3 average: camera noise would otherwise punch holes in the card faces
    box3(raw, lum, w, h); box3(chroma, sat, w, h);
    for (let i = 0; i < n; i++) hist[lum[i]]++;
    let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
    let sumB = 0, wB = 0, best = 0, otsu = 160;
    for (let t = 0; t < 256; t++) { wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break; sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) * (mB - mF); if (v > best) { best = v; otsu = t; } }
    // the card faces are among the brightest things in view: stay well below the bright end, whatever the exposure
    let acc = 0, p98 = 255; for (let t = 255; t >= 0; t--) { acc += hist[t]; if (acc > n * 0.02) { p98 = t; break; } }
    const T = Math.max(100, Math.min(200, otsu, p98 - 45));
    for (let i = 0; i < n; i++) if (lum[i] >= T && sat[i] < 52) mask[i] = 1;
    // shave the edges: thin bridges (a glow, a blurred gap, a label touching a card) come apart; added back below
    const er = Math.max(1, Math.round(Math.min(w, h) / 360));
    erode(mask, w, h, er);
    fillHoles(mask, w, h); // the rank and suit leave holes in a face; a card is measured as a solid shape
    // connected regions (two-pass, union-find)
    const lab = new Int32Array(n), parent = [0];
    const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!mask[i]) continue;
      const a = x > 0 ? lab[i - 1] : 0, b = y > 0 ? lab[i - w] : 0;
      if (!a && !b) { lab[i] = parent.length; parent.push(parent.length); }
      else if (a && b) { const ra = find(a), rb = find(b); lab[i] = Math.min(ra, rb); if (ra !== rb) parent[Math.max(ra, rb)] = Math.min(ra, rb); }
      else lab[i] = a || b;
    }
    const L = parent.length, cnt = new Float64Array(L), sx = new Float64Array(L), sy = new Float64Array(L), sxx = new Float64Array(L), syy = new Float64Array(L), sxy = new Float64Array(L);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x; if (!lab[i]) continue;
      const r = find(lab[i]); lab[i] = r; cnt[r]++; sx[r] += x; sy[r] += y; sxx[r] += x * x; syy[r] += y * y; sxy[r] += x * y;
    }
    const minH = 0.035 * Math.min(w, h), minN = minH * minH * CARD_ASPECT * 0.6, maxN = 0.12 * n;
    const cand = new Map();
    for (let r = 1; r < L; r++) {
      const c = cnt[r]; if (c < minN || c > maxN) continue;
      const mx = sx[r] / c, my = sy[r] / c, cxx = sxx[r] / c - mx * mx, cyy = syy[r] / c - my * my, cxy = sxy[r] / c - mx * my;
      const th = 0.5 * Math.atan2(2 * cxy, cxx - cyy);
      cand.set(r, { n: c, mx, my, cos: Math.cos(th), sin: Math.sin(th), a0: Infinity, a1: -Infinity, b0: Infinity, b1: -Infinity });
    }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const k = lab[y * w + x]; if (!k) continue; const c = cand.get(k); if (!c) continue;
      const dx = x - c.mx, dy = y - c.my, a = dx * c.cos + dy * c.sin, b = -dx * c.sin + dy * c.cos;
      if (a < c.a0) c.a0 = a; if (a > c.a1) c.a1 = a; if (b < c.b0) c.b0 = b; if (b > c.b1) c.b1 = b;
    }
    const faces = [], rowsToSplit = [];
    for (const c of cand.values()) {
      const Lm = c.a1 - c.a0 + 1 + 2 * er, Sm = c.b1 - c.b0 + 1 + 2 * er, fill = c.n / ((Lm - 2 * er) * (Sm - 2 * er)), ratio = Lm / Sm;
      if (fill < 0.6 || Sm < minH * CARD_ASPECT) continue;
      // centre of the box, and its axes: u along the long side, v across it
      const ca = (c.a0 + c.a1) / 2, cb = (c.b0 + c.b1) / 2;
      const cx = c.mx + ca * c.cos - cb * c.sin, cy = c.my + ca * c.sin + cb * c.cos;
      const u = { x: c.cos, y: c.sin };
      // the phone is held roughly upright: a card is taller than wide, so a region that is longer side to side is a row
      const across = Math.abs(c.cos) > Math.abs(c.sin);
      if (!across && ratio >= 1.2 && ratio <= 1.75 && fill >= 0.68) faces.push(upright(cx, cy, u, Lm, Sm));
      else if (across && ratio > 1.1 && ratio < 8) { c.len = Math.ceil(Lm) + 2; c.cnt = new Float32Array(c.len); c.sb = new Float32Array(c.len); rowsToSplit.push(c); }
    }
    if (rowsToSplit.length) {
      // touching cards in a row: count the region's pixels across the row; the cards are the runs between the dips
      const byLab = new Map(); for (const [k, c] of cand) if (c.cnt) byLab.set(k, c);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const k = lab[y * w + x]; if (!k) continue; const c = byLab.get(k); if (!c) continue;
        const dx = x - c.mx, dy = y - c.my, a = Math.round(dx * c.cos + dy * c.sin - c.a0), b = -dx * c.sin + dy * c.cos;
        if (a >= 0 && a < c.len) { c.cnt[a]++; c.sb[a] += b; }
      }
      for (const c of rowsToSplit) {
        const sorted = Array.from(c.cnt).filter(x => x > 0).sort((p, q) => p - q), full = sorted[Math.floor(sorted.length * 0.9)] || 0;
        c.a0 -= er; // runs are measured on the shaved region
        if (!full) continue;
        let start = -1;
        for (let a = 0; a <= c.len; a++) {
          const on = a < c.len && c.cnt[a] > full * 0.55;
          if (on && start < 0) start = a;
          if (!on && start >= 0) {
            const W = a - start + 2 * er; let n = 0, sb = 0, hs = [];
            for (let k = start; k < a; k++) { n += c.cnt[k]; sb += c.sb[k]; hs.push(c.cnt[k]); }
            hs.sort((p, q) => p - q); const H = hs[Math.floor(hs.length * 0.9)] + 2 * er;
            // a run wider than one card is cards blurred together: cut it into equal card widths
            const gap = 0.08 * H, k = W / H < 0.95 ? 1 : Math.round((W + gap) / (CARD_ASPECT * H + gap));
            const cw = (W - (k - 1) * gap) / k, fit = Math.abs(cw / H - CARD_ASPECT) < 0.14;
            if (H > minH && k >= 1 && k <= 5 && (k === 1 ? W / H > 0.5 : fit)) {
              const bm = sb / n;
              for (let j = 0; j < k; j++) {
                const am = c.a0 + start + cw / 2 + j * (cw + gap);
                faces.push(upright(c.mx + am * c.cos - bm * c.sin, c.my + am * c.sin + bm * c.cos, { x: -c.sin, y: c.cos }, H, k === 1 ? W : cw));
              }
            }
            start = -1;
          }
        }
      }
    }
    return faces;
  }
  function fillHoles(mask, w, h) {
    const out = new Uint8Array(w * h), q = new Int32Array(w * h); let qa = 0, qb = 0;
    const push = i => { if (!mask[i] && !out[i]) { out[i] = 1; q[qb++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (qa < qb) { const i = q[qa++], x = i % w; if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (i >= w) push(i - w); if (i < w * (h - 1)) push(i + w); }
    for (let i = 0; i < w * h; i++) if (!out[i]) mask[i] = 1;
  }
  function erode(mask, w, h, r) {
    const tmp = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) { let v = 1; for (let k = -r; k <= r && v; k++) { const xx = x + k; if (xx < 0 || xx >= w || !mask[o + xx]) v = 0; } tmp[o + x] = v; } }
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { let v = 1; for (let k = -r; k <= r && v; k++) { const yy = y + k; if (yy < 0 || yy >= h || !tmp[yy * w + x]) v = 0; } mask[y * w + x] = v; }
  }
  function box3(src, dst, w, h) {
    const tmp = new Uint16Array(w * h);
    for (let y = 0; y < h; y++) { const o = y * w; for (let x = 0; x < w; x++) tmp[o + x] = src[o + Math.max(0, x - 1)] + src[o + x] + src[o + Math.min(w - 1, x + 1)]; }
    for (let y = 0; y < h; y++) { const a = Math.max(0, y - 1) * w, b = y * w, c = Math.min(h - 1, y + 1) * w; for (let x = 0; x < w; x++) dst[b + x] = (tmp[a + x] + tmp[b + x] + tmp[c + x]) / 9; }
  }
  // A face with its "down" axis pointing down the image: centre, unit right/down vectors, width, height.
  function upright(cx, cy, axis, H, W) {
    let d = { x: axis.x, y: axis.y }; if (d.y < 0) d = { x: -d.x, y: -d.y };
    return { cx, cy, down: d, right: { x: d.y, y: -d.x }, w: W, h: H };
  }

  // ----- 2–3. read one face -----
  function readFace(px, w, h, f, T) {
    const N = FW * FH, lum = new Float32Array(N), RR = new Float32Array(N), GG = new Float32Array(N), BB = new Float32Array(N), m = 0.03;
    for (let y = 0; y < FH; y++) for (let x = 0; x < FW; x++) {
      const ox = (x + 0.5) / FW - 0.5, oy = (y + 0.5) / FH - 0.5;
      const sx = f.cx + ox * f.w * (1 - 2 * m) * f.right.x + oy * f.h * (1 - 2 * m) * f.down.x;
      const sy = f.cy + ox * f.w * (1 - 2 * m) * f.right.y + oy * f.h * (1 - 2 * m) * f.down.y;
      const xi = Math.max(0, Math.min(w - 2, Math.floor(sx))), yi = Math.max(0, Math.min(h - 2, Math.floor(sy))), fx = Math.max(0, Math.min(1, sx - xi)), fy = Math.max(0, Math.min(1, sy - yi));
      let r = 0, g = 0, b = 0;
      for (const [dx, dy, wt] of [[0, 0, (1 - fx) * (1 - fy)], [1, 0, fx * (1 - fy)], [0, 1, (1 - fx) * fy], [1, 1, fx * fy]]) { const k = ((yi + dy) * w + xi + dx) * 4; r += px[k] * wt; g += px[k + 1] * wt; b += px[k + 2] * wt; }
      const i = y * FW + x; lum[i] = r * 0.299 + g * 0.587 + b * 0.114; RR[i] = r; GG[i] = g; BB[i] = b;
    }
    const sorted = Float32Array.from(lum).sort(), face = sorted[Math.floor(N * 0.85)];
    if (face < 110) return null;
    const ink = new Float32Array(N), bin = new Uint8Array(N);
    let peak = 0;
    // felt showing in the rounded corners touches the edge of the crop, so it never counts as a glyph (below)
    for (let i = 0; i < N; i++) { ink[i] = Math.max(0, Math.min(1, (face - lum[i]) / face)); if (ink[i] > peak) peak = ink[i]; }
    // the card's own white, to judge ink colour under any lighting
    let wr = 0, wg = 0, wb = 0, wn = 0; for (let i = 0; i < N; i++) if (lum[i] >= face * 0.97) { wr += RR[i]; wg += GG[i]; wb += BB[i]; wn++; }
    wr = wr / wn || 255; wg = wg / wn || 255; wb = wb / wn || 255;
    if (peak < 0.12) return null;
    for (let i = 0; i < N; i++) bin[i] = ink[i] > Math.max(0.1, peak * 0.3) ? 1 : 0;
    // ink blobs (flood fill), ignoring anything touching the edge (felt in the rounded corners, neighbours)
    const seen = new Uint8Array(N), blobs = [];
    for (let i = 0; i < N; i++) {
      if (!bin[i] || seen[i]) continue;
      const stack = [i]; seen[i] = 1; let n = 0, x0 = FW, y0 = FH, x1 = 0, y1 = 0, edge = false, sr = 0, sg = 0, sb = 0;
      while (stack.length) {
        const j = stack.pop(), x = j % FW, y = (j - x) / FW; n++; sr += RR[j] / wr; sg += GG[j] / wg; sb += BB[j] / wb;
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        if (x === 0 || y === 0 || x === FW - 1 || y === FH - 1) edge = true;
        for (const k of [j - 1, j + 1, j - FW, j + FW]) if (k >= 0 && k < N && !seen[k] && bin[k] && Math.abs((k % FW) - x) <= 1) { seen[k] = 1; stack.push(k); }
      }
      if (n >= 6 && !edge) blobs.push({ n, x0, y0, x1, y1, cx: (x0 + x1) / 2 / FW, cy: (y0 + y1) / 2 / FH, sr, sg, sb });
    }
    const pick = (inRegion) => {
      const list = blobs.filter(inRegion); if (!list.length) return null;
      const main = list.reduce((a, b) => (b.n > a.n ? b : a));
      // join the pieces of one glyph (e.g. the tail of a Q) that sit next to the main blob
      const box = { x0: main.x0, y0: main.y0, x1: main.x1, y1: main.y1 }; let n = main.n, sr = main.sr, sg = main.sg, sb = main.sb;
      for (const b of list) if (b !== main && b.n >= main.n * 0.08 && b.x0 <= box.x1 + 2 && b.x1 >= box.x0 - 2 && b.y0 <= box.y1 + 2 && b.y1 >= box.y0 - 2) { box.x0 = Math.min(box.x0, b.x0); box.y0 = Math.min(box.y0, b.y0); box.x1 = Math.max(box.x1, b.x1); box.y1 = Math.max(box.y1, b.y1); n += b.n; sr += b.sr; sg += b.sg; sb += b.sb; }
      return { ...box, n, r: sr / n, g: sg / n, b: sb / n };
    };
    const pad = b => ({ x0: Math.max(0, b.x0 - 2), y0: Math.max(0, b.y0 - 2), x1: Math.min(FW - 1, b.x1 + 2), y1: Math.min(FH - 1, b.y1 + 2) });
    const rk0 = pick(b => b.cx < 0.5 && b.cy < 0.45), su0 = pick(b => b.cx > 0.45 && b.cy > 0.5);
    if (!rk0 || !su0) return null;
    // a face of this app's cards has ink only at the rank (top left) and the suit (bottom right); buttons, labels and
    // panels cut into card-sized pieces have writing across the middle
    const all = blobs.reduce((t, b) => t + b.n, 0);
    if (rk0.n + su0.n < 0.8 * all || blobs.some(b => b.cx > 0.3 && b.cx < 0.7 && b.cy > 0.3 && b.cy < 0.7 && b.n > 0.25 * su0.n)) return null;
    const rk = glyphBox(ink, FW, FH, pad(rk0)), su = glyphBox(ink, FW, FH, pad(su0), 0.22);
    if (!rk || !su) return null;
    // ink colour relative to the card's white: red (♥♦), blue (♦ in a four-colour deck), green (♣ in one), or black
    const { r: cr, g: cg, b: cb } = su0, color = cr - Math.max(cg, cb) > 0.18 ? 'red' : cb - Math.max(cr, cg) > 0.12 ? 'blue' : cg - Math.max(cr, cb) > 0.08 ? 'green' : 'black';
    const rh = rk.y1 - rk.y0 + 1, sh = su.y1 - su.y0 + 1;
    if (rh < FH * 0.08 || sh < FH * 0.08 || rh > FH * 0.45 || sh > FH * 0.5) return null;
    const isRed = color === 'red';
    const R = match(T.rank, resample(ink, FW, FH, rk), (rk.x1 - rk.x0 + 1) / rh);
    const Su = color === 'blue' ? { label: 'd', score: 1, margin: 1 } : color === 'green' ? { label: 'c', score: 1, margin: 1 }
      : match(T.suit, resample(ink, FW, FH, square(su, FH), SG, SG), 1, isRed ? ['h', 'd'] : ['s', 'c'], topProfile(ink, FW, FH, square(su, FH)), R.blur);
    const ok = R.score > 0.75 && R.margin > 0.035 && Su.score > 0.6 && Su.margin > 0.035;
    return { code: R.label + Su.label, rank: R.label, suit: Su.label, ok, conf: Math.min(R.score, Su.score), rankScore: R.score, rankMargin: R.margin, suitScore: Su.score, suitMargin: Su.margin, color };
  }

  // ----- 4. which cards are yours and which are the board -----
  function layout(cards) {
    if (!cards.length) return { hero: null, board: [] };
    const d = cards.reduce((a, c) => ({ x: a.x + c.down.x, y: a.y + c.down.y }), { x: 0, y: 0 }), dl = Math.hypot(d.x, d.y) || 1, down = { x: d.x / dl, y: d.y / dl }, right = { x: down.y, y: -down.x };
    cards.forEach(c => { c.py = c.cx * down.x + c.cy * down.y; c.px = c.cx * right.x + c.cy * right.y; });
    const rows = [];
    for (const c of cards.slice().sort((a, b) => a.py - b.py)) {
      const row = rows.find(r => Math.abs(r.py - c.py) < 0.45 * Math.min(r.h, c.h) && c.h / r.h < 1.2 && r.h / c.h < 1.2);
      if (row) { row.cards.push(c); row.py = row.cards.reduce((s, x) => s + x.py, 0) / row.cards.length; }
      else rows.push({ py: c.py, h: c.h, cards: [c] });
    }
    rows.forEach(r => {
      r.cards.sort((a, b) => a.px - b.px); r.h = r.cards.reduce((s, x) => s + x.h, 0) / r.cards.length;
      // cards in one row must sit side by side, not across the table
      r.tight = r.cards.every((c, i) => !i || c.px - r.cards[i - 1].px < (c.w + r.cards[i - 1].w) / 2 * 1.6);
    });
    const boards = rows.filter(r => r.tight && r.cards.length >= 3 && r.cards.length <= 5).sort((a, b) => b.cards.length - a.cards.length);
    const board = boards[0] || null;
    const pairs = rows.filter(r => r.tight && r.cards.length === 2 && (!board || (r.py > board.py && r.h > board.h * 1.08))).sort((a, b) => b.h - a.h);
    const hero = pairs[0] || null;
    if (board) board.cards.forEach(c => { c.role = 'board'; });
    if (hero) hero.cards.forEach(c => { c.role = 'hero'; });
    return { hero: hero ? hero.cards : null, board: board ? board.cards : [] };
  }

  // Reads one frame. px = RGBA bytes. → {cards: [{code, ok, role, cx, cy, w, h, down, right}], hero: codes|null, board: codes,
  //   complete: every card in your hand and on the board was read confidently}
  function analyze(px, w, h, opts) {
    const T = templates; if (!T) throw new Error('vision.init() first');
    const faces = findFaces(px, w, h), cards = [];
    for (const f of faces) { const r = readFace(px, w, h, f, T); if (r) cards.push({ ...f, ...r }); }
    const lay = layout(cards);
    // a four-colour deck (♦ blue, ♣ green) on the table, now or earlier: then red is always ♥ and black always ♠
    const four = (opts && opts.fourColor) || cards.some(c => c.role && c.ok && (c.color === 'blue' || c.color === 'green'));
    if (four) cards.forEach(c => { if (c.color === 'red' || c.color === 'black') { c.suit = c.color === 'red' ? 'h' : 's'; c.code = c.rank + c.suit; c.suitScore = 1; c.suitMargin = 1; c.ok = c.rankScore > 0.75 && c.rankMargin > 0.035; } });
    const codes = list => list.map(c => c.code);
    const used = [...(lay.hero || []), ...lay.board];
    const unique = new Set(codes(used)).size === used.length;
    return { cards, hero: lay.hero ? codes(lay.hero) : null, board: codes(lay.board),
      heroComplete: unique && !!lay.hero && lay.hero.every(c => c.ok),
      boardComplete: unique && (lay.board.length > 0 ? lay.board.every(c => c.ok) : !!lay.hero && faces.length === lay.hero.length),
      complete: used.length > 0 && unique && used.every(c => c.ok), fourColor: four, width: w, height: h };
  }

  root.CardVision = { init, analyze, SUIT_SYM, _debug: { P, findFaces, readFace, layout, templates: () => templates } };
})(typeof self !== 'undefined' ? self : this);
