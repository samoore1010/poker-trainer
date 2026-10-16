#!/usr/bin/env node
'use strict';
// Optional browser integration check: uses Playwright and an installed Chromium.
// CHROMIUM=/usr/bin/chromium node scripts/camera-check.js
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const { createApp } = require('../server/app');
const { loadConfig } = require('../server/config');
(async () => {
  const config = loadConfig(); config.openai.apiKey = ''; config.agent.anthropicKey = '';
  const server = http.createServer(createApp(config));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage(); const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.addInitScript(() => {
      window.cameraCheck = { frames: 0, workers: 0, results: [] };
      const NativeWorker = window.Worker;
      window.Worker = class extends NativeWorker {
        constructor(url, options) {
          super(url, options);
          if (String(url).includes('vision-worker')) {
            cameraCheck.workers++;
            this.addEventListener('message', ({ data }) => {
              if (data.error) cameraCheck.error = data.error;
              if (data.result) { cameraCheck.frames++; cameraCheck.results.push(data.result); }
            });
          }
        }
      };
      navigator.mediaDevices.getUserMedia = async () => {
        const c = document.createElement('canvas'); c.width = 640; c.height = 480;
        const g = c.getContext('2d');
        const draw = () => {
          g.fillStyle = '#125b36'; g.fillRect(0, 0, 640, 480);
          for (const [i, rank] of ['A', 'K'].entries()) {
            const x = 220 + i * 100;
            g.fillStyle = 'white'; g.fillRect(x, 290, 80, 112);
            g.fillStyle = 'black'; g.font = 'bold 30px monospace'; g.fillText(rank, x + 6, 323);
            g.font = '30px serif'; g.fillText('♠', x + 48, 392);
          }
        };
        cameraCheck.canvas = c;
        draw(); const stream = c.captureStream(15), timer = setInterval(draw, 67);
        stream.getTracks()[0].addEventListener('ended', () => clearInterval(timer));
        return stream;
      };
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    // Expose closure functions only in this test response, never in the shipped app.
    await page.route(origin + '/', async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace('})();\n</script>',
        'window.__cameraTest = { cam, askLive, animateTo, tableCrop, getScenario: () => SC.clone(scenario), api: HV.api };\n})();\n</script>');
      await route.fulfill({ response, body: html });
    });
    await page.goto(origin);
    await page.locator('#camBtn').click();
    await page.waitForFunction(() => cameraCheck.frames >= 3, null, { timeout: 20000 });
    assert.equal(await page.evaluate(() => cameraCheck.error), undefined);
    const recognized = await page.evaluate(() => cameraCheck.results.some(r => r.heroComplete && r.hero.join(',') === 'As,Ks'));
    assert.equal(recognized, true, 'synthetic card pair must be recognized by the worker');
    // Worker and fallback must agree on the same pixels and template set.
    const equivalence = await page.evaluate(async () => {
      await CardVision.init(); const c = cameraCheck.canvas;
      const px = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      const expected = CardVision.analyze(px, c.width, c.height, {});
      const worker = new Worker('vision-worker.js'); worker.postMessage({ templates: CardVision._debug.templates() });
      const actual = await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) => data.error ? reject(new Error(data.error)) : resolve(data.result);
        worker.onerror = reject;
        worker.postMessage({ id: 1, pixels: px.buffer, width: c.width, height: c.height, options: {} }, [px.buffer]);
      });
      worker.terminate(); return { expected, actual };
    });
    assert.deepEqual(equivalence.actual, equivalence.expected);
    const regression = await page.evaluate(async () => {
      const t = __cameraTest, request = t.api.request, responses = [];
      t.api.request = () => new Promise(resolve => responses.push(resolve));
      const waitRequests = async n => { while (responses.length < n) await new Promise(r => setTimeout(r, 10)); };
      const reading = n => ({ readable: { seats: true, betting: false, cards: false, names: false, stacks: false },
        seats: Array.from({ length: n }, (_, i) => ({ name: '', stack: null, dealer: i === 0, bet: 0, folded: false })),
        unit: 'chips', board: null, hero: null, problems: [], rotate: 0, pot: null, toAct: null });
      try {
        const old = t.askLive('full'); await waitRequests(1);
        const fresh = t.askLive('full'); await waitRequests(2);
        responses[1](reading(3)); await fresh;
        responses[0](reading(7)); await old;
        const seenPlayers = t.cam.seenPlayers;
        const target = t.getScenario();
        for (let i = 0; i < 2; i++) {
          const m = PokerScenario.money(target);
          const r = PokerScenario.apply(target, 'act', { seat: m.next, action: 'call' });
          if (!r.ok) throw new Error(r.error);
        }
        let committed = false;
        t.animateTo(target, () => { committed = true; });
        return { seenPlayers, committed };
      } finally { t.api.request = request; }
    });
    assert.equal(regression.seenPlayers, 3, 'obsolete full reading must not update seats');
    assert.equal(regression.committed, true, 'state commit must complete without waiting for animation');
    const crops = await page.evaluate(() => { const t=__cameraTest, previous=t.cam.crop; t.cam.crop=null; const first=t.tableCrop([0.2,0.2,0.8,0.8]); t.cam.crop={x:0.2,y:0.2,w:0.6,h:0.6};const second=t.tableCrop([0.2,0.2,0.8,0.8]);t.cam.crop=previous;return {first,second}; });
    assert.deepEqual(crops.first,crops.second,'full-source boxes must not compound the current crop');
    await page.locator('#camClose').click();
    const stopped = await page.evaluate(() => cameraCheck.frames);
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => cameraCheck.frames), stopped);
    await page.locator('#camBtn').click();
    await page.waitForFunction(n => cameraCheck.frames >= n + 3, stopped);
    assert.ok(await page.evaluate(() => cameraCheck.workers >= 2));
    await page.locator('#camClose').click();
    assert.deepEqual(errors, []);
    console.log('PASS: camera worker processing, worker/fallback equivalence, stop, restart, stale full-response rejection, immediate state commit, and no page errors');
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
