#!/usr/bin/env node
'use strict';
// node scripts/replay-camera.js clip.mp4 labels.json [--live-ai]
// labels: {profile:'pure', corners?:[[x,y],...], intervals:[{fromMs,toMs,active,toCall?,hero?}]}
const fs = require('node:fs'), path = require('node:path'), http = require('node:http');
const { chromium } = require('playwright');
const { createApp } = require('../server/app'), { loadConfig } = require('../server/config');
(async () => {
  const [video, labels] = process.argv.slice(2);
  if (!video || !labels) throw Error('Usage: node scripts/replay-camera.js clip.mp4 labels.json [--live-ai]');
  const expected = JSON.parse(fs.readFileSync(labels, 'utf8'));
  if (!Array.isArray(expected.intervals) || !expected.intervals.length) throw Error('Supply labeled intervals; an unlabeled replay cannot measure accuracy.');
  for (let i=0;i<expected.intervals.length;i++) { const x=expected.intervals[i]; if (!(x.toMs>x.fromMs) || x.fromMs<0 || typeof x.active!=='boolean' || (i && x.fromMs<expected.intervals[i-1].toMs)) throw Error('Intervals must be ordered, non-overlapping and have boolean active labels.'); }
  const config = loadConfig(); if (!process.argv.includes('--live-ai')) { config.openai.apiKey=''; config.agent.anthropicKey=''; }
  const server=http.createServer(createApp(config,{log:()=>{}})); await new Promise(r=>server.listen(0,'127.0.0.1',r)); let browser;
  try {
    browser=await chromium.launch({executablePath:process.env.CHROMIUM||undefined,args:['--no-sandbox']}); const page=await browser.newPage();
    const errors=[]; page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.locator('#replayVideo').setInputFiles(path.resolve(video));
    await page.selectOption('#sourceProfile',expected.profile||'pure');
    if(expected.corners) await page.evaluate(corners=>window.configurePokerScreen(corners),expected.corners);
    let samples=0, correct=0, falseTurns=0, missedTurns=0, wrongPrices=0, cardChecks=0, correctCards=0;
    const firstCorrect=new Map(), firstAdvice=new Map(); let finished=false;
    const deadline=Date.now()+Math.max(...expected.intervals.map(x=>x.toMs))+30000;
    while(Date.now()<deadline) {
      const d=await page.evaluate(()=>window.cameraDiagnostics());
      if(d.sourceTimeMs>=Math.max(...expected.intervals.map(x=>x.toMs))) { finished=true; break; }
      const index=expected.intervals.findIndex(x=>d.sourceTimeMs>=x.fromMs&&d.sourceTimeMs<x.toMs);
      if(index>=0) {
        const x=expected.intervals[index], active=!!d.controls;
        samples++; if(active===x.active) correct++;
        if(active&&!x.active) falseTurns++;
        if(!active&&x.active) missedTurns++;
        if(active&&x.active&&x.toCall!==undefined&&d.controls.toCall!==x.toCall) wrongPrices++;
        const right=active&&x.active&&(x.toCall===undefined||d.controls.toCall===x.toCall);
        if(right&&!firstCorrect.has(index)) firstCorrect.set(index,d.sourceTimeMs-x.fromMs);
        if(right&&d.advice&&!firstAdvice.has(index)) firstAdvice.set(index,d.sourceTimeMs-x.fromMs);
        if(x.hero) { cardChecks++; if(JSON.stringify(x.hero)===JSON.stringify(d.observed?.hero)) correctCards++; }
      }
      await page.waitForTimeout(100);
    }
    if(!finished || !samples) throw Error('Replay did not complete the labeled interval range with nonzero samples.');
    if(errors.length) throw Error(errors.join('\n'));
    const summary=xs=>{ const a=[...xs].sort((x,y)=>x-y);return {count:a.length,medianMs:a.length?a[Math.ceil(a.length*.5)-1]:null,p95Ms:a.length?a[Math.ceil(a.length*.95)-1]:null}; };
    console.log(JSON.stringify({samples,turnAccuracy:correct/samples,falseTurnSamples:falseTurns,missedTurnSamples:missedTurns,wrongPriceSamples:wrongPrices,
      cardChecks,correctCards,turnDetection:summary(firstCorrect.values()),advicePaint:summary(firstAdvice.values()),
      missedDecisionIntervals:expected.intervals.filter((x,i)=>x.active&&!firstCorrect.has(i)).length},null,2));
  } finally {if(browser) await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
