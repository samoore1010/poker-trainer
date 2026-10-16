'use strict';
const { test } = require('node:test'), assert = require('node:assert/strict');
const { Tracker } = require('../public/decision-state');
const I = require('../public/interface-vision');
const controls = { active: true, enabled: true, action: 'call', toCall: 3, confidence: 0.95, unit: 'chips' };
const table = () => ({ unit: 'chips', readable: { betting: true, cards: true }, hero: ['9c','4h'], board: [], pot: 5.5,
  seats: [{ bet: 1, folded: false }, { bet: 4, folded: false }, { bet: 0, folded: true }, { bet: 0, folded: true, dealer: true }, { bet: 0.5, folded: true }] });
const model = { bigBlind: 1, players: 5, toCall: 3, next: 0, pot: 5.5, hero: ['9c','4h'], board: [], historyUncertain: false };
function ready() { const t = new Tracker(); t.observe(controls, 1000); t.observe(controls, 1100); t.observeTable(table(), 1100); return t; }
test('active controls plus coherent current observations validate a decision without changing history', () => {
  const t = ready(), before = JSON.stringify(model);
  assert.equal(t.validate(model, 1200).ready, true); assert.equal(JSON.stringify(model), before);
  assert.equal(t.events.filter(e => e.type === 'hero_turn').length, 1);
  t.observe(controls, 1200); assert.equal(t.events.filter(e => e.type === 'hero_turn').length, 1);
});
test('disabled buttons, uncertainty, changed call price, stale frames and stale observations invalidate advice', () => {
  const t = ready();
  assert.equal(t.validate(model, 2200).ready, false);
  t.observe({ ...controls, toCall: 30 }, 1200); assert.equal(t.current, null);
  t.observe(controls, 1100); assert.equal(t.current, null);
  t.observe({ ...controls, enabled: false }, 1300); assert.equal(t.current, null);
});
test('call price disagreement blocks validation but inferred history needs no manual confirmation', () => {
  const t = ready();
  assert.equal(t.validate({ ...model, historyUncertain: true }, 1200).ready, true);
  assert.match(t.validate({ ...model, historyUncertain: true }, 1200).warnings[0], /inferred automatically/);
  const bad = table(); bad.seats[1].bet = 40; t.observeTable(bad, 1200);
  assert.match(t.validate(model, 1200).issues.join(), /disagree/);
});
test('big-blind observations convert consistently and never erase folded contributions', () => {
  const t = ready(), T = table(); T.unit = 'bb'; t.observe({ ...controls, unit: 'bb' }, 1200); t.observe({ ...controls, unit: 'bb' }, 1300); t.observeTable(T, 1300);
  assert.equal(t.validate({ ...model, bigBlind: 2, pot: 11, toCall: 6 }, 1400).ready, true);
  assert.equal(t.table.seats[4].bet, 0.5);
});
test('chip sweep, fold and stack-confirmed contribution are distinct events', () => {
  const t = ready(), a = table(); a.seats[1].stack = 23; t.observeTable(a, 1200);
  const b = table(); b.seats[1].bet = 6; b.seats[1].stack = 21; t.observeTable(b, 1300);
  assert.equal(t.events.find(e => e.type === 'contribution_increased').stackConfirmed, true);
  const c = table(); c.seats.forEach(s => { s.bet = 0; }); t.observeTable(c, 1400);
  assert.ok(t.events.some(e => e.type === 'chip_sweep'));
});
test('latency diagnostics count each painted decision once', () => {
  const t = ready(); t.painted(1250); t.painted(1400);
  assert.deepEqual({ ...t.metrics(), events: [] }, { decisions: 1, medianMs: 250, p95Ms: 250, events: [] });
});
test('screen rectification preserves corners and rejects degenerate frames', () => {
  assert.deepEqual(I.homography([[0,0],[1,0],[1,1],[0,1]]), [1,0,0,0,1,0,0,0]);
  assert.throws(() => I.homography([[0,0],[0,0],[0,0],[0,0]]));
  const pixels = new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,255,255,255,255,255]);
  assert.deepEqual(I.rectify(pixels, 2, 2, [[0,0],[1,0],[1,1],[0,1]], 2, 2).pixels, pixels);
});
test('structured observations require unique cards and explicit amounts', () => {
  const { observation } = require('../public/structured-source');
  const T = table(); T.toAct=0; T.controls=controls; T.seats.forEach(s=>s.stack=null);
  assert.equal(observation(T).pot,5.5);
  assert.throws(()=>observation({...T,hero:['9c','9c']}));
  const bad=structuredClone(T);bad.seats[0].bet=null;assert.throws(()=>observation(bad));
});
test('expired controls clear the actionable result even with fresh table data',()=>{
  const t=ready();t.observeTable(table(),4000);assert.equal(t.validate(model,4100).ready,false);
});
test('contradictory seat turn and folded-player evidence blocks advice',()=>{
  const t=ready(),T=table();T.toAct=1;t.observeTable(T,1200);
  assert.equal(t.validate(model,1200).ready,false);
  T.toAct=0;t.observeTable(T,1300);
  assert.equal(t.validate({...model,folded:[false,false,false,true,true]},1300).ready,false);
});
test('a betting-only read preserves recent card evidence without refreshing its age',()=>{
  const t=ready(),T=table();T.readable.cards=false;T.hero=null;T.board=null;
  t.observeTable(T,1300);assert.equal(t.validate(model,1400).ready,true);
  t.observe(controls,5000);t.observeTable(T,5000);
  assert.equal(t.validate(model,5200).ready,false);
});

test('missing local OCR does not starve independent AI turn observations', () => {
  const t = new Tracker();
  t.observe(null, 1500, 'local');
  t.observe(controls, 1000, 'ai');
  t.observe(null, 1700, 'local');
  t.observe(controls, 1200, 'ai');
  assert.equal(t.current.source, 'ai');
  t.observe(null, 1800, 'local');
  assert.equal(t.current.source, 'ai');
  t.observe(null, 1300, 'ai');
  assert.equal(t.current, null);
});
