#!/usr/bin/env node
'use strict';
// Checks the phone table for overlaps: for 1–8 opponents at common phone sizes, no seat (its speech bubble, avatar,
// cards and name plate), bet, dealer button, the pot, the board or your cards may overlap another, or leave the screen.
// Worst cases are forced: every bubble reads "Raises to $150", every seat has a four-chip bet.
//   npm run layout -- [url] [WxH,WxH,...]     (needs Playwright: npm i -D playwright, or a global install)
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { console.error('This check needs Playwright (npm i -D playwright).'); process.exit(2); }
const url = process.argv[2] || 'http://localhost:3000/';
const sizes = (process.argv[3] || '360x740,375x667,390x844,414x896,430x932').split(',').map(x => x.split('x').map(Number));

(async () => {
  const b = await chromium.launch(process.env.CHROMIUM ? { executablePath: process.env.CHROMIUM } : {});
  let bad = 0;
  for (const [w, h] of sizes) {
    const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
    await p.goto(url); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(800);
    for (let n = 1; n <= 8; n++) {
      await p.evaluate(v => { const s = document.getElementById('nOpp'); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, String(n));
      await p.waitForTimeout(300);
      const r = await p.evaluate(() => {
        const L = window.PokerLayout, tb = document.getElementById('table'), out = [];
        const box = e => { const r = e.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; };
        const seats = [...document.querySelectorAll('.seat')];
        seats.forEach(s => { const a = s.querySelector('.act'); a.className = 'act bet'; a.textContent = 'Raises to $150'; });
        const ha = document.getElementById('heroAct'); ha.className = 'act you'; ha.textContent = 'Your turn · $150 to call';
        const probe = (pos, html, cls) => { const e = document.createElement('div'); e.className = cls + ' layout-probe'; e.innerHTML = html; e.style.left = pos.x + '%'; e.style.top = pos.y + '%'; tb.appendChild(e); return e; };
        const chips = '<span class="chips-stack" style="--n:3">' + '<i style="--k:0"></i><i style="--k:1"></i><i style="--k:2"></i><i style="--k:3"></i></span><b>$150</b>';
        for (let i = 0; i <= seats.length; i++) {
          out.push({ k: 'bet' + i, ...box(probe(L.betPos(i), chips, 'chipbet')) });
          out.push({ k: 'dealer' + i, ...box(probe(L.dealerPos(i), 'D', 'dealer')) });
        }
        seats.forEach(s => { for (const part of [s.querySelector('.act'), s.querySelector('.pic'), s.querySelector('.plate'), ...s.querySelectorAll('.cards .card')]) out.push({ k: 'seat' + s.dataset.seat, ...box(part) }); });
        const hero = document.getElementById('hero');
        for (const part of [hero.querySelector('.act'), hero.querySelector('.pic'), hero.querySelector('.plate')]) out.push({ k: 'you', ...box(part) });
        document.querySelectorAll('#heroCards .card').forEach(c => out.push({ k: 'your cards', ...box(c) }));
        out.push({ k: 'pot', ...box(document.getElementById('pot')) });
        document.querySelectorAll('#board > *').forEach(c => out.push({ k: 'board', ...box(c) }));
        const hits = new Set();
        for (let i = 0; i < out.length; i++) for (let j = i + 1; j < out.length; j++) {
          const a = out[i], c = out[j];
          if (a.k === c.k || (a.k.startsWith('dealer') && c.k.startsWith('dealer'))) continue; // only one dealer button shows
          const ov = Math.min(a.r, c.r) - Math.max(a.l, c.l), oh = Math.min(a.b, c.b) - Math.max(a.t, c.t);
          if (ov > 1 && oh > 1) hits.add(`${a.k} × ${c.k}`);
        }
        const off = new Set(out.filter(x => x.l < 0 || x.r > innerWidth).map(x => x.k));
        document.querySelectorAll('.layout-probe').forEach(e => e.remove());
        return { hits: [...hits], off: [...off] };
      });
      if (r.hits.length || r.off.length) { bad++; console.log(`${w}x${h}, ${n} opponents: ${r.hits.join(', ')}${r.off.length ? ` · off screen: ${r.off.join(', ')}` : ''}`); }
    }
    await p.close();
  }
  await b.close();
  console.log(bad ? `${bad} layouts overlap` : `No overlaps: 1–8 opponents at ${sizes.map(s => s.join('×')).join(', ')}.`);
  process.exit(bad ? 1 : 0);
})();
