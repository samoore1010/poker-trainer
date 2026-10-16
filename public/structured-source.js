// Explicit same-page adapter for an application you control. No listener accepts unsolicited cross-origin messages.
(function (root) {
  function observation(raw) {
    const card = x => typeof x === 'string' && /^[2-9TJQKA][cdhs]$/.test(x);
    const amount = x => typeof x === 'number' && Number.isFinite(x) && x >= 0;
    if (!raw || !['chips','bb'].includes(raw.unit) || !Array.isArray(raw.seats) || raw.seats.length < 2 || raw.seats.length > 9) throw Error('A source observation needs units and 2–9 ordered seats.');
    if (!Array.isArray(raw.hero) || raw.hero.length !== 2 || !raw.hero.every(card) || !Array.isArray(raw.board) || ![0,3,4,5].includes(raw.board.length) || !raw.board.every(card) || new Set([...raw.hero,...raw.board]).size !== raw.hero.length+raw.board.length) throw Error('Supply valid, unique hero and board cards.');
    if (!amount(raw.pot) || raw.seats.some(s => !s || !amount(s.bet) || typeof s.folded !== 'boolean' || (s.stack !== null && !amount(s.stack)))) throw Error('Pot, bets and known stacks must be non-negative numbers.');
    const c = raw.controls;
    if (!c || typeof c.active !== 'boolean' || typeof c.enabled !== 'boolean' || !['call','check','unknown'].includes(c.action) || (c.active && (!amount(c.toCall) || c.action === 'unknown' || (c.action === 'check' && c.toCall !== 0)))) throw Error('Supply explicit active action controls and additional call price.');
    if (raw.toAct !== null && (!Number.isInteger(raw.toAct) || raw.toAct < 0 || raw.toAct >= raw.seats.length)) throw Error('Invalid seat to act.');
    return { unit:raw.unit, pot:raw.pot, hero:raw.hero.slice(),board:raw.board.slice(),toAct:raw.toAct,
      seats:raw.seats.map(s=>({name:typeof s.name==='string'?s.name.slice(0,24):'',stack:s.stack,bet:s.bet,folded:s.folded,dealer:s.dealer===true,last:'none'})),
      controls:{...c,confidence:1,unit:raw.unit},readable:{cards:true,seats:true,betting:true,stacks:raw.seats.every(s=>s.stack!==null),names:false},problems:[],rotate:0 };
  }
  if (typeof module === 'object' && module.exports) module.exports = { observation }; else root.StructuredPokerSource = { observation };
})(typeof self !== 'undefined' ? self : this);
