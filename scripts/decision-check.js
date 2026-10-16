#!/usr/bin/env node
'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const { createApp } = require('../server/app');
const { loadConfig } = require('../server/config');
(async () => {
  const config = loadConfig(); config.openai.apiKey = ''; config.agent.anthropicKey = '';
  const server = http.createServer(createApp(config));
  await new Promise(r => server.listen(0, '127.0.0.1', r)); let browser;
  try {
    browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--no-sandbox'] });
    const page = await browser.newPage(), errors = []; page.on('pageerror', e => errors.push(e.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    await page.route(origin + '/', async route => {
      const response = await route.fetch();
      const html = (await response.text()).replace('})();\n</script>', 'window.__decisionTest = { decisions, cam, askLive, observeDecisionTable, renderDecision, loadScenario, requestUrgent, api: HV.api, validation: decisionValidation, recommendation: currentRecommendation, client: adviceClient };\n})();\n</script>');
      await route.fulfill({ response, body: html });
    });
    await page.goto(origin);
    const readings = await page.evaluate(() => {
      InterfaceVision.init(); const c = document.createElement('canvas'); c.width = 920; c.height = 2000;
      const g = c.getContext('2d'), profile = InterfaceVision.profiles.pure;
      window.fixture = { canvas: c, call: 'Call 3', enabled: true, timer: true };
      fixture.draw = () => {
        g.fillStyle = '#59371c'; g.fillRect(0,0,c.width,c.height);
        for (const [region, color, text] of [[profile.fold,'#c32136','Fold'],[profile.middle,'#20252b',fixture.call],[profile.raise,'#0078ee','Raise']]) {
          const [l,t,r,b] = region; g.fillStyle = fixture.enabled ? color : '#555555'; g.fillRect(l*c.width,t*c.height,(r-l)*c.width,(b-t)*c.height);
          g.fillStyle = fixture.enabled ? 'white' : '#888888'; g.font = 'bold 36px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, (l+r)/2*c.width, (t+b)/2*c.height);
        }
        if (fixture.timer) { const [l,t,r,b] = profile.timer; g.fillStyle = '#309cec'; g.fillRect(l*c.width,t*c.height,(r-l)*c.width,(b-t)*c.height); }
        for (const [i, card] of profile.cards.entries()) {
          g.save(); g.translate(card.x*c.width, card.y*c.height); g.rotate(card.angle*Math.PI/180);
          g.fillStyle = i ? '#d32c37' : '#21823d'; g.fillRect(-32,-38,64,76);
          g.fillStyle = 'white'; g.font = 'bold 36px Arial'; g.fillText(i ? '4' : '9',0,0); g.restore();
        }
      };
      const read = () => { fixture.draw(); return InterfaceVision.analyze(g.getImageData(0,0,c.width,c.height).data,c.width,c.height,'pure'); };
      const active = read(); fixture.enabled = false; const disabled = read(); fixture.enabled = true; fixture.timer = false; const noTimer = read(); fixture.timer = true; fixture.call = 'Check'; const check = read(); fixture.call = 'Call 3'; fixture.draw();
      navigator.mediaDevices.getUserMedia = async () => { const stream = c.captureStream(15); const id = setInterval(fixture.draw,67); fixture.timerId = id; return stream; };
      return { active, disabled, noTimer, check };
    });

    assert.equal(readings.active.controls.active, true); assert.equal(readings.active.controls.toCall, 3);
    assert.deepEqual(readings.active.hero, ['9c','4h']);
    assert.equal(readings.disabled.controls.active, false); assert.equal(readings.noTimer.controls.active, false);
    assert.equal(readings.check.controls.toCall, 0);
    if (process.env.CAMERA_FIXTURES_DIR) {
      const fs = require('node:fs'), path = require('node:path'); fs.mkdirSync(process.env.CAMERA_FIXTURES_DIR,{recursive:true});
      for (const [name, enabled, call] of [['active',true,'Call 3'],['disabled',false,'Call 3'],['changed',true,'Call 30']]) {
        const url = await page.evaluate(({enabled,call})=>{ fixture.enabled=enabled;fixture.call=call;fixture.draw();return fixture.canvas.toDataURL('image/png'); },{enabled,call});
        fs.writeFileSync(path.join(process.env.CAMERA_FIXTURES_DIR,name+'.png'),Buffer.from(url.split(',')[1],'base64'));
      }
      await page.evaluate(()=>{fixture.enabled=true;fixture.call='Call 3';fixture.draw();});
    }
    await page.click('#camBtn'); await page.selectOption('#sourceProfile','pure');
    await page.waitForFunction(() => __decisionTest.decisions.current?.toCall === 3, null, { timeout: 15000 });
    await page.evaluate(() => {
      const S = PokerScenario, sc = S.create({ opponents: 4, stack: 50, bigBlind: 1, smallBlind: 0.5, randomStacks: false });
      S.apply(sc, 'set_hero_cards', { cards: ['9c','4h'] });
      const r = S.apply(sc, 'set_action', { street: 'preflop', aggressor: 'UTG', amount: 4, folds: ['CO','BTN','SB'] });
      if (!r.ok) throw Error(r.error);
      __decisionTest.loadScenario(sc);
      const T = { unit:'chips', readable:{betting:true,cards:true}, hero:['9c','4h'],board:[],pot:5.5,
        seats:[{bet:1,folded:false},{bet:4,folded:false},{bet:0,folded:true},{bet:0,folded:true},{bet:0.5,folded:true}] };
      __decisionTest.observeDecisionTable(T,Date.now()); __decisionTest.renderDecision();
    });
    await page.waitForFunction(() => /Fold —/.test(document.getElementById('decisionNow').textContent), null, { timeout: 10000 });
    await page.evaluate(() => { fixture.call = 'Call 30'; fixture.draw(); });
    await page.waitForFunction(() => !document.getElementById('decisionNow').textContent.includes('Fold —'), null, { timeout: 5000 });
    await page.evaluate(() => { fixture.enabled = false; fixture.draw(); });
    await page.waitForFunction(() => document.getElementById('decisionNow').hidden);
    // Noisy controls must let an in-flight table request finish.
    await page.evaluate(() => {
      const t = __decisionTest; window.priorityCheck = { aborted: false, urgent: 0, request: t.api.request, has: t.api.has };
      t.api.has = feature => feature === 'vision';
      t.api.request = (path, options) => {
        const body = JSON.parse(options.body);
        if (!body.decision) return new Promise((resolve,reject) => {
          priorityCheck.finish = resolve;
          options.signal.addEventListener('abort', () => { priorityCheck.aborted=true; reject(new DOMException('cancel','AbortError')); }, {once:true});
        });
        priorityCheck.urgent++;
        return Promise.resolve({ unit:'chips', readable:{betting:true,cards:true,seats:true,names:false,stacks:false}, hero:['9c','4h'],board:[],pot:5.5,toAct:0,rotate:0,problems:[],
          controls:{active:true,enabled:true,action:'call',toCall:3,unit:'chips',confidence:1},
          seats:[{bet:1,folded:false},{bet:4,folded:false},{bet:0,folded:true},{bet:0,folded:true,dealer:true},{bet:0.5,folded:true}] });
      };
      t.askLive('full');
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => { fixture.enabled=true; fixture.call='Call 3'; fixture.draw(); });
    await page.waitForTimeout(1800);
    assert.equal(await page.evaluate(() => priorityCheck.aborted), false);
    assert.equal(await page.evaluate(() => priorityCheck.urgent), 0);
    await page.evaluate(() => priorityCheck.finish({ unit:'chips', readable:{betting:true,cards:true,seats:false}, hero:['9c','4h'],board:[],pot:5.5,toAct:0,rotate:0,problems:[], seats:[{bet:1,folded:false},{bet:4,folded:false},{bet:0,folded:true},{bet:0,folded:true},{bet:0.5,folded:true}] }));
    await page.waitForFunction(() => __decisionTest.cam.live.inflight === 0);
    // Ordinary camera use must show advice without controls or user-confirmed history.
    await page.evaluate(() => {
      fixture.enabled=false; fixture.draw();
      const t=__decisionTest; t.decisions.reset(); t.cam.joinedMidHand=true;
      const sc=PokerScenario.create({opponents:4,stack:50,bigBlind:1,smallBlind:0.5,randomStacks:false});
      PokerScenario.apply(sc,'set_hero_cards',{cards:['As','Ah']});
      window.autoScenario=sc; t.loadScenario(sc);
      window.refreshAdvice=setInterval(()=>t.loadScenario(autoScenario),50);
    });
    await page.waitForFunction(() => !!__decisionTest.recommendation(), null, {timeout:10000});
    assert.ok(await page.locator('.advice .adv-act').count());
    assert.equal(await page.locator('[data-confirm-history]').count(),0);
    await page.evaluate(() => clearInterval(refreshAdvice));
    await page.click('#camClose');
    await page.evaluate(() => { __decisionTest.api.request=priorityCheck.request; __decisionTest.api.has=priorityCheck.has; });
    // A controlled source supplies actual history and bypasses video inference.
    const connected = await page.evaluate(async () => {
      const source = await connectPokerSource(), S=PokerScenario, scenario=S.create({opponents:4,bigBlind:1,smallBlind:0.5,stack:50,randomStacks:false});
      S.apply(scenario,'set_hero_cards',{cards:['9c','4h']}); S.apply(scenario,'set_action',{street:'preflop',aggressor:'UTG',amount:4,folds:['CO','BTN','SB']});
      const observation={unit:'chips',hero:['9c','4h'],board:[],pot:5.5,toAct:0,controls:{active:true,enabled:true,action:'call',toCall:3},
        seats:[{bet:1,folded:false},{bet:4,folded:false},{bet:0,folded:true},{bet:0,folded:true,dealer:true},{bet:0.5,folded:true}].map(x=>({...x,stack:null}))};
      const result=source.push({sequence:1,scenario,observation});
      let rejected=false; try { source.push({sequence:1,scenario,observation}); } catch { rejected=true; }
      source.close();return {ready:result.ready,rejected,issues:result.issues};
    });
    assert.equal(connected.ready,true, JSON.stringify(connected));assert.equal(connected.rejected,true);
    const workerResult = await page.evaluate(async () => {
      const S=PokerScenario, sc=S.create({opponents:1,bigBlind:1,smallBlind:0.5,stack:50,randomStacks:false});
      S.apply(sc,'set_hero_cards',{cards:['As','Ah']});
      const payload=()=>({scenario:sc,street:sc.street,hero:sc.hero.cards.map(PokerEngine.cardFromCode),board:sc.board.map(PokerEngine.cardFromCode)});
      return await new Promise((resolve,reject)=>{
        const timeout=setTimeout(()=>{client.cancel();reject(Error('Postflop advice worker timed out'));},20000);
        const client=new AdviceClient(error=>{clearTimeout(timeout);if(error)reject(Error(error));else resolve(client.result);client.cancel();});
        client.request(payload()); // superseded before the preflop worker can answer
        S.apply(sc,'set_board',{cards:['Ks','7d','2c']});
        client.request(payload());
      });
    });
    assert.ok(workerResult && typeof workerResult.action === 'string');
    assert.deepEqual(errors, []);
    console.log('PASS: local active/disabled controls, call/check OCR, coloured cards, urgent preflop advice, price-change invalidation control disappearance, non-starving table reads, automatic advice without controls or confirmation, and structured-source sequencing');
  } finally { if(browser) await browser.close(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
