// Decision observations are independent of reconstructed betting history.
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DecisionState = api;
})(typeof self !== 'undefined' ? self : this, () => {
  'use strict';
  const amount = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  class Tracker {
    constructor() { this.reset(); }
    reset() { this.version = 0; this.current = null; this.candidate = null; this.lastFrame = -1; this.table = null; this.events = []; this.samples = []; this.paintedVersion = null; }
    event(type, at, detail = {}) {
      this.events.push({ type, at, ...detail }); if (this.events.length > 200) this.events.shift();
    }
    observe(controls, at, source = 'local') {
      if (!Number.isFinite(at) || at <= this.lastFrame) return false;
      this.lastFrame = at;
      const valid = controls && controls.active === true && controls.enabled === true &&
        controls.confidence >= 0.85 && amount(controls.toCall) && ['call', 'check'].includes(controls.action);
      if (!valid) {
        if (this.current) this.event('decision_unavailable', at);
        if (this.current || this.candidate) this.version++;
        this.current = null; this.candidate = null;
        return false;
      }
      const key = `${controls.action}:${controls.toCall}:${controls.unit || 'unknown'}`;
      if (!this.candidate || this.candidate.key !== key) {
        this.current = null; this.version++;
        this.candidate = { key, at, count: 1 };
        this.event('controls_changed', at, { toCall: controls.toCall });
        if (source !== 'structured') return false;
      }
      this.candidate.count++;
      if (source !== 'structured' && at - this.candidate.at < 70) return false;
      const fresh = !this.current;
      this.current = { ...controls, source, capturedAt: at, startedAt: this.candidate.at, version: this.version };
      if (fresh) this.event('hero_turn', at, { toCall: controls.toCall });
      return fresh;
    }
    observeTable(T, at) {
      if (!T || (this.table && at <= this.table.capturedAt)) return;
      const old = this.table;
      const cardsRead = T.readable?.cards && Array.isArray(T.board) && Array.isArray(T.hero);
      const snapshot = { ...T, capturedAt: at, cardsAt: cardsRead ? at : old?.cardsAt,
        hero: cardsRead ? T.hero : old?.hero || null, board: cardsRead ? T.board : old?.board ?? null };

      if (old) {
        const seatMapStable = old.seats?.length === T.seats?.length && T.seats?.every((s, i) => !s.name || !old.seats[i].name || s.name === old.seats[i].name);
        if (!seatMapStable) this.event('seat_map_changed', at);
        if (Array.isArray(old.board) && Array.isArray(T.board) && T.board.length > old.board.length) this.event('street_changed', at, { board: T.board });
        const oldDealer = old.seats?.findIndex(s => s.dealer), dealer = T.seats?.findIndex(s => s.dealer);
        const cleared = old.board?.length > 0 && T.board?.length === 0;
        const changedCards = old.hero?.length === 2 && T.hero?.length === 2 && !equal(old.hero, T.hero);
        if ((cleared && changedCards) || (changedCards && dealer >= 0 && oldDealer >= 0 && dealer !== oldDealer)) this.event('new_hand_candidate', at);
        if (seatMapStable && T.readable?.betting && old.readable?.betting) {
          const swept = T.seats.every(s => s.bet === 0) && old.seats.some(s => s.bet > 0);
          if (swept) this.event('chip_sweep', at);
          T.seats.forEach((s, i) => {
            const prev = old.seats[i];
            if (s.folded && !prev.folded) this.event('fold_observed', at, { seat: i });
            if (!swept && amount(s.bet) && amount(prev.bet) && s.bet > prev.bet) {
              const delta = s.bet - prev.bet;
              this.event('contribution_increased', at, { seat: i, to: s.bet, delta,
                stackConfirmed: amount(s.stack) && amount(prev.stack) && Math.abs(prev.stack - s.stack - delta) < 0.01 });
            }
          });
        }
        if (!equal(old.board, snapshot.board) || !equal(old.hero, snapshot.hero) || !equal(old.seats?.map(s => [s.bet, s.folded]), T.seats?.map(s => [s.bet, s.folded]))) this.version++;
      }
      this.table = snapshot;
    }
    validate(model, now) {
      const c = this.current, T = this.table, issues = [];
      if (!c || now - c.capturedAt > (c.source === 'local' ? 900 : 3500)) return { ready: false, issues: ['Waiting for active action controls.'] };
      if (!T || now - T.capturedAt > 4000) return { ready: false, issues: ['Reading cards and current bets.'], controls: c };
      const k = T.unit === 'bb' ? model.bigBlind : T.unit === 'chips' ? 1 : null;
      const controlK = c.unit === 'bb' ? model.bigBlind : c.unit === 'chips' ? 1 : k;
      if (!k || !controlK) issues.push('Confirming displayed units.');
      const call = c.toCall * (controlK || 1), near = (a, b) => amount(a) && amount(b) && Math.abs(a - b) <= 0.011;
      if (!T.readable?.betting || T.seats?.length !== model.players) issues.push('Confirming active opponents and contributions.');
      const bets = (T.seats || []).map(s => s.bet === null ? NaN : s.bet * (k || 1));
      if (!bets.length || !bets.every(Number.isFinite) || !near(Math.max(...bets) - bets[0], call)) issues.push('Call button and contributions disagree.');
      if (T.toAct !== null && T.toAct !== undefined && T.toAct !== 0) issues.push('Action controls and seat turn indicator disagree.');
      const dealer = T.seats?.findIndex(s => s.dealer);
      if (Number.isInteger(model.button) && dealer >= 0 && dealer !== model.button) issues.push('Confirming the dealer position.');
      if (model.folded && T.seats?.some((s,i) => s.folded !== model.folded[i])) issues.push('Confirming which players remain in the hand.');
      if (model.contributions && bets.some((bet,i) => !near(bet, model.contributions[i]))) issues.push('Reconciling individual contributions.');
      if (model.behind && T.seats?.some((s,i) => !s.folded && amount(s.stack) && !near(s.stack*(k||1), model.behind[i]))) issues.push('Confirming effective stacks.');
      if (!near(model.toCall, call) || model.next !== 0) issues.push('Reconciling the current decision with betting history.');
      if (!amount(T.pot) || !near(model.pot, T.pot * (k || 1))) issues.push('Confirming the pot.');
      if (!T.cardsAt || now - T.cardsAt > 4000 || !T.hero || !equal(T.hero, model.hero) || !Array.isArray(T.board) || !equal(T.board, model.board)) issues.push('Confirming your cards and the board.');
      if (model.historyUncertain) issues.push('Earlier betting was not observed; confirm the action history.');
      return { ready: !issues.length, issues, controls: c, toCall: call, pot: T.pot, version: this.version };
    }
    painted(now) {
      if (!this.current || this.paintedVersion === this.version) return;
      this.paintedVersion = this.version;
      this.samples.push(now - this.current.startedAt); if (this.samples.length > 200) this.samples.shift();
    }
    metrics() {
      const sorted = this.samples.slice().sort((a, b) => a - b), p = n => sorted.length ? sorted[Math.ceil(n * sorted.length) - 1] : null;
      return { decisions: sorted.length, medianMs: p(0.5), p95Ms: p(0.95), events: this.events.slice() };
    }
  }
  return { Tracker };
});
