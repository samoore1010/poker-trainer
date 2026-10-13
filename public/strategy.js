// Preflop strategy: standard 100-big-blind charts that approximate solver play for a disciplined long-run player.
// Used three ways: the "What you should do" advice, the computer opponents, and the likely hands of opponents
// inferred from what they did (an opener holds an opening range, a 3-bettor a 3-bet range, and so on).
// Charts are approximations, not solver output; they favour folding most hands, raising instead of limping.
(function (root, factory) {
  const E = typeof module === 'object' && module.exports ? require('./engine.js') : root.PokerEngine;
  const api = factory(E);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.PokerStrategy = api;
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  // Raise-first-in by how many players act after you preflop (1 = small blind, 2 = button, 3 = cutoff, 4 = hijack,
  // 5 = 6-max UTG / lojack, 6–8 = earlier seats at a full table). 'hu' = heads-up button.
  const RFI = {
    8: '66+, A9s+, A5s, KTs+, QTs+, JTs, AJo+, KQo',
    7: '55+, A8s+, A5s-A4s, KTs+, QTs+, JTs, T9s, AJo+, KQo',
    6: '44+, A2s+, KTs+, QTs+, JTs, T9s, 98s, ATo+, KQo',
    5: '22+, A2s+, K9s+, QTs+, JTs, T9s, 98s, 87s, AJo+, KQo',
    4: '22+, A2s+, K8s+, Q9s+, J9s+, T9s, 98s, 87s, 76s, ATo+, KJo+, QJo',
    3: '22+, A2s+, K5s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, A8o+, A5o, KTo+, QTo+, JTo',
    2: '22+, A2s+, K2s+, Q4s+, J6s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K8o+, Q9o+, J9o+, T8o+, 98o, 87o',
    1: '22+, A2s+, K3s+, Q5s+, J7s+, T7s+, 96s+, 86s+, 75s+, 64s+, 54s, A2o+, K9o+, Q9o+, J9o+, T9o',
    hu: '22+, A2s+, K2s+, Q2s+, J4s+, T6s+, 96s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o+, K5o+, Q7o+, J8o+, T8o+, 97o+, 87o, 76o',
  };
  // Facing one raise: by your seat group (big blind, small blind, or a seat after the raiser) and the raiser's tier.
  const VS_OPEN = {
    BB: {
      EP: { raise: 'QQ+, AKs, AKo, A5s-A4s', call: '22-JJ, A2s-AQs, K9s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 75s+, 65s, 54s, AJo-AQo, KQo' },
      MP: { raise: 'JJ+, AQs+, AKo, A5s-A4s, KQs', call: '22-TT, A2s-AJs, K7s+, Q8s+, J8s+, T8s+, 97s+, 86s+, 75s+, 64s+, 54s, ATo-AQo, KJo, QJo' },
      CO: { raise: 'TT+, AJs+, AQo+, KQs, A5s-A3s, 76s', call: '22-99, A2s-ATs, K4s+, Q6s+, J7s+, T7s+, 96s+, 85s+, 74s+, 64s+, 53s+, A7o-AJo, KTo+, QTo+, JTo, T9o' },
      BTN: { raise: '99+, ATs+, AJo+, KJs+, A5s-A2s, 65s', call: '22-88, A2s-A9s, K2s+, Q4s+, J6s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o-ATo, K8o+, Q9o+, J9o+, T8o+, 98o, 87o' },
      SB: { raise: '88+, ATs+, AJo+, KTs+, QJs, A5s-A2s', call: '22-77, A2s-A9s, K2s+, Q2s+, J5s+, T6s+, 95s+, 85s+, 74s+, 63s+, 53s+, 43s, A2o-ATo, K7o+, Q8o+, J8o+, T8o+, 97o+, 87o, 76o' },
    },
    SB: {
      EP: { raise: 'QQ+, AKs, AKo, AQs, A5s', call: '' },
      MP: { raise: 'JJ+, AQs+, AKo, KQs, A5s-A4s', call: '' },
      CO: { raise: 'TT+, AJs+, AQo+, KQs, KJs, QJs, A5s-A3s', call: '77-99, ATs, KTs, QTs, JTs' },
      BTN: { raise: '88+, ATs+, AJo+, KTs+, QTs+, JTs, A5s-A2s, KQo', call: '55-77, A6s-A9s, K9s, Q9s, J9s, T9s, 98s' },
      SB: { raise: '', call: '' },
    },
    IP: {
      EP: { raise: 'QQ+, AKs, AKo, A5s', call: '77-JJ, AJs-AQs, KQs, KJs, QJs, JTs, AQo' },
      MP: { raise: 'JJ+, AQs+, AKo, A5s-A4s, KQs', call: '66-TT, ATs-AJs, KJs, QJs, JTs, T9s, 98s, AQo' },
      CO: { raise: 'TT+, AJs+, AQo+, KQs, A5s-A3s, 76s', call: '22-99, A8s-ATs, KTs-KJs, QTs+, J9s+, T9s, 98s, 87s, AJo, KQo' },
      BTN: { raise: 'TT+, AJs+, AQo+, KQs, A5s-A3s, 76s', call: '22-99, A8s-ATs, KTs-KJs, QTs+, J9s+, T9s, 98s, 87s, AJo, KQo' },
      SB: { raise: '', call: '' },
    },
  };
  // You opened and got 3-bet.
  const VS_3BET = {
    IP: { raise: 'QQ+, AKs, AKo, A5s', call: 'JJ-99, AJs-AQs, KQs, QJs, JTs, AQo' },
    OOP: { raise: 'QQ+, AKs, AKo, A5s', call: 'JJ-TT, AQs, KQs' },
    LATE_VS_BLIND: { raise: 'QQ+, AKs, AKo, A5s-A4s', call: 'JJ-77, ATs-AQs, KJs+, QJs, JTs, T9s, AQo, KQo' },
  };
  const COLD_3BET = { raise: 'KK+, AKs', call: 'QQ-JJ, AKo, AQs' }; // a raise and a 3-bet before you act
  const VS_4BET = { raise: 'KK+, AKs', call: 'QQ, AKo' };
  // Limped pots.
  const ISO_BB = '99+, ATs+, KJs+, QJs, AJo+, KQo';
  const SB_COMPLETE = '22+, A2s+, K2s+, Q5s+, J7s+, T7s+, 96s+, 85s+, 75s+, 64s+, 54s, A2o+, K8o+, Q9o+, J9o+, T9o';
  const OVERLIMP = '22-99, A2s-A9s, K9s+, QTs+, JTs, T9s, 98s, 87s, 76s, 65s, 54s';
  // Likely hands behind passive actions (used for opponents' ranges).
  const LIMP = '22-99, A2s-AJs, K8s+, Q9s+, J9s+, T8s+, 97s+, 86s+, 76s, 65s, 54s, ATo-AJo, KTo+, QTo+, JTo';

  const has = new Map();
  // Is a hand class (e.g. "AKs", "T9o", "77") in a range string?
  function rangeHas(text, label) {
    if (!text) return false;
    let set = has.get(text);
    if (!set) { set = new Set(E.rangeOf(text).combos.map(([a, b]) => E.handLabel(a, b))); has.set(text, set); }
    return set.has(label);
  }
  const pctOf = text => (text ? E.rangeOf(text).pct : 0);
  const rfi = (behind, players) => (players === 2 ? RFI.hu : RFI[Math.max(1, Math.min(8, behind))]);
  // Raiser tier from how many players act after them, or from their range when one is set.
  function tier(behind, pct) {
    if (pct !== null && pct !== undefined) return pct <= 17 ? 'EP' : pct <= 22 ? 'MP' : pct <= 32 ? 'CO' : pct <= 48 ? 'BTN' : 'SB';
    return behind >= 5 ? 'EP' : behind === 4 ? 'MP' : behind === 3 ? 'CO' : behind === 2 ? 'BTN' : 'SB';
  }
  const tighter = t => ({ SB: 'BTN', BTN: 'CO', CO: 'MP', MP: 'EP', EP: 'EP' }[t]);
  const r1 = (x, bb) => Math.max(bb, bb >= 2 ? Math.round(x) : Math.round(x * 2) / 2);

  // The preflop decision for the player in ctx:
  // {label, players, pos, behind, bb, raises, max, toCall, stackLeft, heroRaisedLast, heroOpened, limpers, callers,
  //  opener:{behind,pct,name,pos,blind}, raiser:{...same}, inPositionVsRaiser, fmt}
  // → {action: fold|check|call|raise|wait, to, reasons[], t (0..1 inside the zone), close}
  function preflop(c) {
    const L = c.label, top = E.PCT[L], fmt = c.fmt || (x => String(x)), bbs = x => `${Math.round(x / c.bb * 10) / 10} BB`, both = x => (fmt(x) === bbs(x) ? fmt(x) : `${fmt(x)} (${bbs(x)})`);
    const reasons = [];
    let cont = 0; // how much of all hands continues in this spot (the computer players loosen or tighten around it)
    const res = (action, t, extra = {}) => ({ action, t: Math.max(0, Math.min(1, t)), reasons, cont, ...extra });
    const raiseTo = x => Math.min(r1(Math.min(x, 1e9), c.bb), c.max - c.toCall + c.stackLeft); // never more than the stack
    const depth = (text) => { const p = pctOf(text); return p ? 1 - Math.min(1, top / p) : 0; }; // how far inside a range
    const near = (text) => { const p = pctOf(text); return p && top <= p * 1.35; };
    if (c.heroRaisedLast) { reasons.push(`You raised to ${fmt(c.max)}; wait for the others.`); return res('wait', 0.6); }

    // ----- nobody has raised -----
    if (c.raises === 0) {
      if (c.pos === 'BB') {
        if (rangeHas(ISO_BB, L) && c.limpers > 0) { const to = raiseTo(c.bb * 3 + c.limpers * c.bb + (c.sbIn ? c.bb / 2 : 0)); reasons.push(`${L} is strong enough to raise the limpers from the big blind instead of checking.`); return res('raise', 0.4 + depth(ISO_BB) * 0.6, { to, cont: pctOf(ISO_BB) }); }
        reasons.push(c.limpers > 0 ? `Nobody raised: check and see a free flop with ${L}.` : `Everyone folded to you: you win the blinds.`);
        return res('check', 0.5, { cont: 100 });
      }
      const open = rfi(c.behind, c.players), openPct = Math.round(pctOf(open));
      if (c.limpers === 0) {
        reasons.push(`From ${c.pos} a solid player opens about ${openPct}% of hands${c.players === 2 ? ' heads-up' : ''}.`);
        if (rangeHas(open, L)) {
          const to = raiseTo(c.bb * (c.pos === 'SB' ? 3 : c.players === 2 ? 2.5 : 2.5));
          reasons.push(`${L} is in that range: raise. Don't limp; raising wins the blinds often and builds the pot with the edge.`);
          return res('raise', 0.3 + depth(open) * 0.7, { to, close: !depth(open) || top > pctOf(open) * 0.85, cont: pctOf(open) });
        }
        reasons.push(`${L} is outside it: fold. Most hands aren't worth playing from here.`);
        return res('fold', 1 - Math.min(1, (top - pctOf(open)) / Math.max(10, pctOf(open))), { close: near(open), cont: pctOf(open) });
      }
      // limpers in front
      const iso = c.pos === 'SB' ? rangeHas(ISO_BB, L) : rangeHas(open, L) && top <= Math.min(pctOf(open) * 0.6, 18);
      reasons.push(`${c.limpers} player${c.limpers > 1 ? 's' : ''} limped in front of you.`);
      if (iso) {
        const to = raiseTo(c.bb * (c.pos === 'SB' || c.pos === 'BB' ? 4 : 3) + c.limpers * c.bb);
        reasons.push(`${L} is strong enough to raise them (isolate) rather than limp along.`);
        return res('raise', 0.35 + depth(open) * 0.65, { to, cont: Math.min(pctOf(open) * 0.6, 18) });
      }
      if (c.pos === 'SB' && rangeHas(SB_COMPLETE, L)) { reasons.push(`Completing the small blind is cheap with ${L} in a limped pot.`); return res('call', 0.3, { close: true, cont: pctOf(SB_COMPLETE) }); }
      if (c.behind <= 3 && rangeHas(OVERLIMP, L)) { reasons.push(`${L} plays well in a cheap multiway pot from late position: limp behind.`); return res('call', 0.25, { close: true, cont: pctOf(OVERLIMP) }); }
      reasons.push(`${L} is too weak to play here: fold.`);
      return res('fold', 0.4, { close: c.behind <= 3 && near(OVERLIMP), cont: c.behind <= 3 ? pctOf(OVERLIMP) : Math.min(pctOf(open) * 0.6, 18) });
    }

    // ----- one raise: 3-bet, call or fold -----
    const R = c.raiser, size = c.max / c.bb;
    if (c.raises === 1) {
      let t = tier(R.behind, R.pct);
      if (size >= 4) t = tighter(t);
      const group = c.pos === 'BB' ? 'BB' : c.pos === 'SB' ? 'SB' : 'IP';
      const ch = VS_OPEN[group][t] || VS_OPEN.IP.EP;
      let raise = ch.raise, call = ch.call;
      cont = pctOf(raise) + pctOf(call);
      reasons.push(`${R.name} (${R.pos}) raised to ${both(c.max)}; against a ${t === 'EP' ? 'tight early' : t === 'MP' ? 'middle-position' : t === 'CO' ? 'cutoff-style' : t === 'BTN' ? 'wide button' : 'very wide'} raise you continue with about ${Math.round(pctOf(raise) + pctOf(call))}% of hands${group === 'BB' ? ' from the big blind' : ''}.`);
      if (c.callers > 0) reasons.push(`${c.callers} player${c.callers > 1 ? 's' : ''} already called, so tighten up: big pairs and strong suited hands only.`);
      const multiOk = L => !c.callers || L.length === 2 || L.endsWith('s');
      if (rangeHas(raise, L) && (!c.callers || top <= 4)) {
        const to = raiseTo((c.inPositionVsRaiser ? 3 : 4) * c.max + c.callers * c.max);
        reasons.push(`${L} is a 3-bet: re-raise${c.inPositionVsRaiser ? ' in position' : ''}.`);
        return res('raise', 0.4 + depth(raise) * 0.6, { to });
      }
      if ((rangeHas(call, L) || (rangeHas(raise, L) && c.callers)) && multiOk(L)) {
        reasons.push(group === 'BB' ? `${L} is a big-blind defend: call, you're already part-way in.` : `${L} is strong enough to call${c.inPositionVsRaiser ? ' in position' : ''}.`);
        return res('call', 0.2 + depth(call) * 0.7, { close: top > pctOf(raise) + pctOf(call) * 0.85 });
      }
      reasons.push(`${L} isn't strong enough to continue: fold.`);
      return res('fold', 1 - Math.min(1, (top - (pctOf(raise) + pctOf(call))) / 10), { close: top <= (pctOf(raise) + pctOf(call)) * 1.2 });
    }

    // ----- facing a 3-bet or more -----
    if (c.raises === 2) {
      let ch;
      if (c.heroOpened) {
        const lateVsBlind = c.behind <= 3 && R.blind;
        ch = lateVsBlind ? VS_3BET.LATE_VS_BLIND : c.inPositionVsRaiser ? VS_3BET.IP : VS_3BET.OOP;
        reasons.push(`${R.name} (${R.pos}) 3-bet to ${both(c.max)}: that range is strong, about 5% of hands.`);
      } else { ch = COLD_3BET; reasons.push(`There's a raise and a 3-bet in front of you: only premium hands continue.`); }
      cont = pctOf(ch.raise) + pctOf(ch.call);
      if (rangeHas(ch.raise, L)) { const to = raiseTo(c.max * 2.3); reasons.push(`${L} is strong enough to 4-bet.`); return res('raise', 0.5 + depth(ch.raise) * 0.5, { to }); }
      if (rangeHas(ch.call, L)) { reasons.push(`${L} can call${c.inPositionVsRaiser ? ' in position' : ''}.`); return res('call', 0.4, { close: true }); }
      reasons.push(`${L} folds to a 3-bet.`);
      return res('fold', 0.5, { close: top <= 6 });
    }
    cont = pctOf(VS_4BET.raise) + pctOf(VS_4BET.call);
    reasons.push(`${R.name} has 4-bet: their range is very strong (about the top 2–3%).`);
    if (rangeHas(VS_4BET.raise, L)) { reasons.push(`${L} is strong enough to go all-in.`); return res('raise', 0.9, { to: raiseTo(1e12) }); }
    if (rangeHas(VS_4BET.call, L)) { reasons.push(`${L} can call.`); return res('call', 0.4, { close: true }); }
    reasons.push(`${L} folds to a 4-bet.`);
    return res('fold', 0.6);
  }

  // Likely hands for an opponent from what they did preflop. ev: {kind, behind, players, raiserBehind, raiserPct, group}
  function rangeFor(ev) {
    switch (ev.kind) {
      case 'open': return { range: rfi(ev.behind, ev.players), label: 'opened' };
      case 'limp': return { range: LIMP, label: 'limped' };
      case 'sb-complete': return { range: SB_COMPLETE, label: 'completed the small blind' };
      case 'bb-check': return { range: 'top 85%', label: 'checked the big blind' };
      case 'call-open': { const ch = (VS_OPEN[ev.group] || VS_OPEN.IP)[tier(ev.raiserBehind, ev.raiserPct)] || VS_OPEN.IP.EP; return { range: ch.call || ch.raise, label: 'called a raise' }; }
      case '3bet': { const ch = (VS_OPEN[ev.group] || VS_OPEN.IP)[tier(ev.raiserBehind, ev.raiserPct)] || VS_OPEN.IP.EP; return { range: ch.raise || 'QQ+, AK', label: '3-bet' }; }
      case 'call-3bet': return { range: VS_3BET.IP.call, label: 'called a 3-bet' };
      case '4bet': return { range: 'QQ+, AK', label: '4-bet' };
      case 'call-4bet': return { range: VS_4BET.call + ', ' + VS_4BET.raise, label: 'called a 4-bet' };
      default: return { range: '', label: '' };
    }
  }

  return { RFI, VS_OPEN, VS_3BET, COLD_3BET, VS_4BET, ISO_BB, SB_COMPLETE, OVERLIMP, LIMP, rangeHas, pctOf, rfi, tier, preflop, rangeFor };
});
