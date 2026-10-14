'use strict';
// The advice benchmark: standard spots with the answers strong players and solvers broadly agree on.
// These are consensus answers chosen by hand, not solver output: spots where solvers mix between actions are left out,
// or accept every action they mix between. 6-handed, 100 big blinds (blinds 1/2, stacks 200) unless a spot says otherwise.
//
// A spot: {id, cat, pos (your position), hero, pre: [[who, action, to?]...], flop/turn/river: {cards, acts}, styles, ok: [actions]}
// The listed actions are played in turn order; players skipped over fold (or check when it's free). The last street's
// actions stop where it's your turn. ok: the actions counted as right (fold, check, call, bet, raise).

const spots = [];
const add = (cat, base, list) => list.forEach(([hero, ok, extra], i) => spots.push({ id: `${cat}-${i + 1}`, cat, ...base, hero, ok: [].concat(ok), ...(extra || {}) }));
const AGG = ['bet', 'raise'];

// ----- preflop: first in -----
add('open-utg', { pos: 'UTG', pre: [] }, [
  [['As', 'Ah'], 'raise'], [['Ks', 'Kd'], 'raise'], [['Qh', 'Qc'], 'raise'], [['Jd', 'Js'], 'raise'], [['Ah', 'Kh'], 'raise'], [['Ad', 'Kc'], 'raise'],
  [['As', 'Qs'], 'raise'], [['Ks', 'Qs'], 'raise'], [['Tc', 'Td'], 'raise'], [['Ah', 'Jh'], 'raise'],
  [['7c', '2d'], 'fold'], [['9h', '4c'], 'fold'], [['Jd', '5c'], 'fold'], [['Qc', '6d'], 'fold'], [['8s', '3h'], 'fold'], [['Kc', '4d'], 'fold'],
  [['Td', '6h'], 'fold'], [['Ah', '3c'], 'fold'], [['6c', '4d'], 'fold'],
]);
add('open-co', { pos: 'CO', pre: [] }, [
  [['Ah', 'Tc'], 'raise'], [['Kh', 'Jd'], 'raise'], [['9s', '8s'], 'raise'], [['Ad', '5d'], 'raise'], [['Qs', 'Js'], 'raise'], [['7h', '7d'], 'raise'], [['Kd', 'Ts'], 'raise'],
  [['Qc', '7d'], 'fold'], [['8c', '5h'], 'fold'], [['Jh', '3d'], 'fold'], [['9c', '4s'], 'fold'], [['Tc', '2h'], 'fold'],
]);
add('open-btn', { pos: 'BTN', pre: [] }, [
  [['Kh', '9c'], 'raise'], [['Ad', '2c'], 'raise'], [['Qs', '8s'], 'raise'], [['7c', '6c'], 'raise'], [['5h', '5d'], 'raise'], [['Kc', '5c'], 'raise'], [['Jd', 'Tc'], 'raise'], [['Ah', '7d'], 'raise'],
  [['7d', '2h'], 'fold'], [['9s', '3c'], 'fold'], [['Jc', '2d'], 'fold'], [['8h', '3d'], 'fold'], [['6s', '2c'], 'fold'],
]);

// ----- preflop: facing a raise -----
add('bb-vs-btn', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold']] }, [
  [['Kd', '7d'], ['call', 'raise']], [['Qh', '9c'], ['call', 'raise']], [['7s', '6s'], ['call', 'raise']], [['Ac', '5d'], ['call', 'raise']], [['9h', '8d'], ['call', 'raise']],
  [['Jc', 'Th'], ['call', 'raise']], [['4h', '4c'], ['call', 'raise']], [['Ks', '2s'], ['call', 'raise']],
  [['As', 'Ad'], 'raise'], [['Kh', 'Kc'], 'raise'], [['Ah', 'Kd'], 'raise'],
  [['7c', '2d'], 'fold'], [['8d', '3c'], 'fold'], [['9c', '2h'], 'fold'], [['6d', '2s'], 'fold'],
]);
add('co-vs-utg', { pos: 'CO', pre: [['UTG', 'raise', 5], ['HJ', 'fold']] }, [
  [['As', 'Ad'], 'raise'], [['Kh', 'Ks'], 'raise'], [['Ac', 'Kc'], ['raise', 'call']], [['Jh', 'Js'], ['call', 'raise']], [['Qd', 'Qc'], ['call', 'raise']],
  [['Kh', 'Tc'], 'fold'], [['Qd', '9c'], 'fold'], [['Ah', '6c'], 'fold'], [['Jc', '8d'], 'fold'], [['7d', '5c'], 'fold'],
]);

// ----- preflop: your open gets 3-bet -----
add('vs-3bet', { pos: 'BTN', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['BB', 'raise', 20]] }, [
  [['As', 'Ah'], 'raise'], [['Kd', 'Kc'], 'raise'], [['Ad', 'Kc'], ['raise', 'call']], [['Jh', 'Jd'], ['call', 'raise']], [['Th', '9h'], ['call', 'fold']],
  [['Kc', '8d'], 'fold'], [['Qc', '7d'], 'fold'], [['Jd', '6c'], 'fold'], [['9c', '6d'], 'fold'],
]);

// ----- after the flop: the price and the hand -----
// a set never folds to a bet
add('set-vs-bet', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']] }, [
  [['7c', '7d'], ['call', 'raise'], { flop: { cards: ['7h', 'Kd', '2s'], acts: [['hero', 'check'], ['BTN', 'bet', 7]] } }],
  [['9c', '9d'], ['call', 'raise'], { flop: { cards: ['9h', '8h', '4c'], acts: [['hero', 'check'], ['BTN', 'bet', 9]] } }],
  [['4c', '4d'], ['call', 'raise'], { flop: { cards: ['Qs', 'Jc', '4h'], acts: [['hero', 'check'], ['BTN', 'bet', 5]] } }],
  [['2c', '2d'], ['call', 'raise'], { flop: { cards: ['As', '2h', '7d'], acts: [['hero', 'check'], ['BTN', 'bet', 4]] } }],
]);
// strong draws continue against a normal bet heads-up
add('draw-vs-bet', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']] }, [
  [['Ah', '5h'], ['call', 'raise'], { flop: { cards: ['Kh', '8h', '2c'], acts: [['hero', 'check'], ['BTN', 'bet', 5]] } }],
  [['Jd', 'Td'], ['call', 'raise'], { flop: { cards: ['9d', '8c', '3d'], acts: [['hero', 'check'], ['BTN', 'bet', 7]] } }],
  [['8s', '7s'], ['call', 'raise'], { flop: { cards: ['9h', '6c', '2d'], acts: [['hero', 'check'], ['BTN', 'bet', 4]] } }],
  [['Qc', 'Jc'], ['call', 'raise'], { flop: { cards: ['Tc', '9h', '4c'], acts: [['hero', 'check'], ['BTN', 'bet', 7]] } }],
  [['6h', '5h'], ['call', 'raise'], { flop: { cards: ['7h', '4d', 'Kh'], acts: [['hero', 'check'], ['BTN', 'bet', 6]] } }],
]);
// nothing at all: fold to a bet
add('air-vs-bet', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']] }, [
  [['3c', '2d'], 'fold', { flop: { cards: ['Ah', 'Kd', 'Qc'], acts: [['hero', 'check'], ['BTN', 'bet', 7]] } }],
  [['6c', '4d'], 'fold', { flop: { cards: ['Kh', 'Qd', '9c'], acts: [['hero', 'check'], ['BTN', 'bet', 7]] } }],
  [['8d', '3c'], 'fold', { flop: { cards: ['As', 'Jh', '6s'], acts: [['hero', 'check'], ['BTN', 'bet', 10]] } }],
  [['7h', '2c'], 'fold', { flop: { cards: ['Kc', 'Qs', 'Td'], acts: [['hero', 'check'], ['BTN', 'bet', 10]] } }],
]);
// weak pair facing a bet and a call in a multiway pot: fold
add('weak-multiway', { pos: 'BB', pre: [['CO', 'raise', 5], ['BTN', 'call'], ['SB', 'fold'], ['hero', 'call']] }, [
  [['5c', '3d'], 'fold', { flop: { cards: ['Ks', 'Td', '3h'], acts: [['hero', 'check'], ['CO', 'bet', 12], ['BTN', 'call']] } }],
  [['6h', '2c'], 'fold', { flop: { cards: ['Ah', 'Jd', '2s'], acts: [['hero', 'check'], ['CO', 'bet', 12], ['BTN', 'call']] } }],
  [['8c', '4d'], 'fold', { flop: { cards: ['Qd', 'Jc', '4s'], acts: [['hero', 'check'], ['CO', 'bet', 15], ['BTN', 'call']] } }],
]);
// value: strong made hands bet when checked to on the river, heads-up
add('river-value-ip', { pos: 'BTN', pre: [['hero', 'raise', 5], ['SB', 'fold'], ['BB', 'call']] }, [
  [['Ah', 'Kh'], 'bet', { flop: { cards: ['Ad', 'Kc', '7s'], acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: ['2h'], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: ['9c'], acts: [['BB', 'check']] } }],
  [['9h', '9d'], 'bet', { flop: { cards: ['9c', '5s', '2d'], acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: ['Jh'], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: ['3c'], acts: [['BB', 'check']] } }],
  [['Ks', 'Js'], 'bet', { flop: { cards: ['Qs', 'Ts', '9c'], acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: ['2d'], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: ['5h'], acts: [['BB', 'check']] } }],
  [['8h', '7h'], 'bet', { flop: { cards: ['Ah', 'Th', '3h'], acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: ['Kc'], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: ['2s'], acts: [['BB', 'check']] } }],
  [['Qd', 'Qc'], 'bet', { flop: { cards: ['Qh', '8d', '3s'], acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: ['3c'], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: ['Ks'], acts: [['BB', 'check']] } }],
  [['As', 'Qd'], 'bet', { flop: { cards: ['Ah', '7c', '4d'], acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: ['9s'], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: ['2c'], acts: [['BB', 'check']] } }],
  [['Jc', 'Jh'], 'bet', { flop: { cards: ['8c', '6d', '2s'], acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: ['4h'], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: ['3d'], acts: [['BB', 'check']] } }],
]);
// the nuts facing a river bet: raise
add('river-nuts-raise', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']] }, [
  [['Ah', 'Th'], 'raise', { flop: { cards: ['Kh', '7h', '2c'], acts: [['hero', 'check'], ['BTN', 'check']] }, turn: { cards: ['4d'], acts: [['hero', 'check'], ['BTN', 'check']] }, river: { cards: ['9h'], acts: [['hero', 'check'], ['BTN', 'bet', 8]] } }],
  [['8c', '6d'], 'raise', { flop: { cards: ['9s', '7d', '2c'], acts: [['hero', 'check'], ['BTN', 'check']] }, turn: { cards: ['Kh'], acts: [['hero', 'check'], ['BTN', 'check']] }, river: { cards: ['Ts'], acts: [['hero', 'check'], ['BTN', 'bet', 8]] } }],
  [['5c', '5d'], 'raise', { flop: { cards: ['5h', 'Jc', 'Jd'], acts: [['hero', 'check'], ['BTN', 'check']] }, turn: { cards: ['2s'], acts: [['hero', 'check'], ['BTN', 'check']] }, river: { cards: ['8h'], acts: [['hero', 'check'], ['BTN', 'bet', 8]] } }],
]);
// missed everything on the river facing a big bet: fold
add('river-air-fold', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']] }, [
  [['Jh', 'Th'], 'fold', { flop: { cards: ['9h', '4h', '2c'], acts: [['hero', 'check'], ['BTN', 'bet', 5], ['hero', 'call']] }, turn: { cards: ['Kc'], acts: [['hero', 'check'], ['BTN', 'bet', 15], ['hero', 'call']] }, river: { cards: ['3d'], acts: [['hero', 'check'], ['BTN', 'bet', 40]] } }],
  [['7s', '6s'], 'fold', { flop: { cards: ['8c', '5d', 'Kh'], acts: [['hero', 'check'], ['BTN', 'bet', 5], ['hero', 'call']] }, turn: { cards: ['Qs'], acts: [['hero', 'check'], ['BTN', 'bet', 15], ['hero', 'call']] }, river: { cards: ['2h'], acts: [['hero', 'check'], ['BTN', 'bet', 40]] } }],
  [['Ad', '3d'], 'fold', { flop: { cards: ['Kd', 'Qd', '7c'], acts: [['hero', 'check'], ['BTN', 'bet', 5], ['hero', 'call']] }, turn: { cards: ['8s'], acts: [['hero', 'check'], ['BTN', 'bet', 15], ['hero', 'call']] }, river: { cards: ['Jh'], acts: [['hero', 'check'], ['BTN', 'bet', 40]] } }],
]);
// a tiny river bet with a decent pair: call (or raise)
add('river-small-bet', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']] }, [
  [['Kc', 'Jd'], ['call', 'raise'], { flop: { cards: ['Kh', '8s', '3c'], acts: [['hero', 'check'], ['BTN', 'check']] }, turn: { cards: ['5d'], acts: [['hero', 'check'], ['BTN', 'check']] }, river: { cards: ['2h'], acts: [['hero', 'check'], ['BTN', 'bet', 3]] } }],
  [['9c', '8c'], ['call', 'raise'], { flop: { cards: ['9h', '6s', '2d'], acts: [['hero', 'check'], ['BTN', 'check']] }, turn: { cards: ['Jc'], acts: [['hero', 'check'], ['BTN', 'check']] }, river: { cards: ['4s'], acts: [['hero', 'check'], ['BTN', 'bet', 3]] } }],
  [['Td', 'Tc'], ['call', 'raise'], { flop: { cards: ['Qh', '7s', '3c'], acts: [['hero', 'check'], ['BTN', 'check']] }, turn: { cards: ['2d'], acts: [['hero', 'check'], ['BTN', 'check']] }, river: { cards: ['8s'], acts: [['hero', 'check'], ['BTN', 'bet', 3]] } }],
]);
// a big hand facing a turn bet never folds
add('turn-strong-vs-bet', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']] }, [
  [['Kc', '9c'], ['call', 'raise'], { flop: { cards: ['Kd', '9h', '4s'], acts: [['hero', 'check'], ['BTN', 'check']] }, turn: { cards: ['2c'], acts: [['hero', 'check'], ['BTN', 'bet', 7]] } }],
  [['6d', '6c'], ['call', 'raise'], { flop: { cards: ['Jd', '6h', '3s'], acts: [['hero', 'check'], ['BTN', 'bet', 4], ['hero', 'call']] }, turn: { cards: ['Tc'], acts: [['hero', 'check'], ['BTN', 'bet', 12]] } }],
  [['Ah', '4h'], ['call', 'raise'], { flop: { cards: ['Qh', '9h', '2c'], acts: [['hero', 'check'], ['BTN', 'check']] }, turn: { cards: ['6h'], acts: [['hero', 'check'], ['BTN', 'bet', 8]] } }],
]);
// betting the flop with a strong hand as the preflop raiser, heads-up in position
add('cbet-value', { pos: 'BTN', pre: [['hero', 'raise', 5], ['SB', 'fold'], ['BB', 'call']] }, [
  [['Ac', 'Kd'], AGG, { flop: { cards: ['Ah', '7c', '2s'], acts: [['BB', 'check']] } }],
  [['Qs', 'Qd'], AGG, { flop: { cards: ['9c', '5h', '2d'], acts: [['BB', 'check']] } }],
  [['8h', '8d'], AGG, { flop: { cards: ['8c', 'Jd', '4s'], acts: [['BB', 'check']] } }],
  [['Kh', 'Qh'], AGG, { flop: { cards: ['Kd', '6s', '3c'], acts: [['BB', 'check']] } }],
  [['Jh', 'Tc'], AGG, { flop: { cards: ['Qd', '9s', '8c'], acts: [['BB', 'check']] } }],
]);
// nothing, three opponents, out of position: check
add('check-multiway-air', { pos: 'SB', pre: [['CO', 'raise', 5], ['BTN', 'call'], ['hero', 'call'], ['BB', 'call']] }, [
  [['9c', '8d'], 'check', { flop: { cards: ['Ah', 'Kh', '3c'], acts: [] } }],
  [['7d', '6c'], 'check', { flop: { cards: ['Qs', 'Jd', '2h'], acts: [] } }],
  [['Tc', '4c'], 'check', { flop: { cards: ['Ks', '9d', '8h'], acts: [] } }],
]);
// against a calling station, don't bluff the river with nothing
add('no-bluff-station', { pos: 'BTN', pre: [['hero', 'raise', 5], ['SB', 'fold'], ['BB', 'call']], styles: { BB: 'station' } }, [
  [['5h', '4h'], 'check', { flop: { cards: ['Kd', 'Qc', '8s'], acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: ['Jh'], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: ['2c'], acts: [['BB', 'check']] } }],
  [['7c', '6c'], 'check', { flop: { cards: ['Ad', 'Th', '3s'], acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: ['Kc'], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: ['Qd'], acts: [['BB', 'check']] } }],
]);

// ----- harder: sizing and close spots -----
// spot.size = [lo, hi]: the bet as a share of the pot (a raise: the raise-to amount over the pot) must fall in this range
const checkedRiver = (flop, turn, river) => ({ flop: { cards: flop, acts: [['BB', 'check'], ['hero', 'check']] }, turn: { cards: [turn], acts: [['BB', 'check'], ['hero', 'check']] }, river: { cards: [river], acts: [['BB', 'check']] } });
// dry, ace- or king-high flops: the preflop raiser bets small in position
add('size-dry-cbet', { pos: 'BTN', pre: [['hero', 'raise', 5], ['SB', 'fold'], ['BB', 'call']], size: [0.2, 0.45] }, [
  [['Ac', 'Qd'], 'bet', { flop: { cards: ['Ah', '7c', '2s'], acts: [['BB', 'check']] } }],
  [['Kh', 'Kd'], 'bet', { flop: { cards: ['Ks', '8d', '3c'], acts: [['BB', 'check']] } }],
  [['As', 'Kc'], 'bet', { flop: { cards: ['Ad', '8h', '3c'], acts: [['BB', 'check']] } }],
  [['Kc', 'Qs'], 'bet', { flop: { cards: ['Kd', '7h', '2c'], acts: [['BB', 'check']] } }],
  [['Qh', 'Qc'], 'bet', { flop: { cards: ['Qd', '7c', '2h'], acts: [['BB', 'check']] } }],
]);
// a very strong hand on a wet, connected flop: bet big
add('size-wet-value', { pos: 'BTN', pre: [['hero', 'raise', 5], ['SB', 'fold'], ['BB', 'call']], size: [0.55, 1.3] }, [
  [['9h', '9d'], 'bet', { flop: { cards: ['9s', '8s', '6c'], acts: [['BB', 'check']] } }],
  [['Jh', 'Td'], 'bet', { flop: { cards: ['Jc', 'Ts', '7s'], acts: [['BB', 'check']] } }],
  [['7h', '7d'], 'bet', { flop: { cards: ['7s', '6h', '5h'], acts: [['BB', 'check']] } }],
  [['Qd', 'Qc'], 'bet', { flop: { cards: ['Qh', 'Jh', 'Tc'], acts: [['BB', 'check']] } }],
]);
// the nuts on the river after a checked-down hand: bet big (a small pot, a polarized bet)
add('size-river-nuts', { pos: 'BTN', pre: [['hero', 'raise', 5], ['SB', 'fold'], ['BB', 'call']], size: [0.66, 2.5] }, [
  [['Ah', 'Jh'], 'bet', checkedRiver(['Kh', '8h', '2c'], '5d', '3h')],
  [['Tc', '9d'], 'bet', checkedRiver(['Qs', 'Jd', '4c'], '2h', '8s')],
  [['6c', '6d'], 'bet', checkedRiver(['6h', 'Kc', '2s'], 'Kd', '9h')],
  [['As', '5s'], 'bet', checkedRiver(['Ks', 'Js', '3d'], '8c', '2s')],
]);
// a set facing a bet on a wet flop: raise (make the draws pay now)
add('raise-wet-set', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']] }, [
  [['8c', '8d'], 'raise', { flop: { cards: ['8h', '9h', 'Tc'], acts: [['hero', 'check'], ['BTN', 'bet', 7]] } }],
  [['6c', '6s'], 'raise', { flop: { cards: ['6h', '7h', '5c'], acts: [['hero', 'check'], ['BTN', 'bet', 7]] } }],
  [['Tc', 'Td'], 'raise', { flop: { cards: ['Th', 'Jh', '9s'], acts: [['hero', 'check'], ['BTN', 'bet', 7]] } }],
]);
// a calling station checks to you on the river: bet medium-strength hands for value
add('thin-value-station', { pos: 'BTN', pre: [['hero', 'raise', 5], ['SB', 'fold'], ['BB', 'call']], styles: { BB: 'station' } }, [
  [['Qc', '9c'], 'bet', checkedRiver(['Qh', '7d', '3s'], '2c', '5h')],
  [['8h', '8d'], 'bet', checkedRiver(['Jc', '6d', '2s'], '3h', '4c')],
  [['Kd', 'Td'], 'bet', checkedRiver(['Kh', '9c', '4s'], '5d', '2h')],
]);
// a maniac bets big on the river: top pair calls
add('call-maniac', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']], styles: { BTN: 'maniac' } }, [
  [['Kc', '9d'], ['call', 'raise'], { flop: { cards: ['Kh', '7s', '3c'], acts: [['hero', 'check'], ['BTN', 'bet', 7], ['hero', 'call']] }, turn: { cards: ['2d'], acts: [['hero', 'check'], ['BTN', 'bet', 18], ['hero', 'call']] }, river: { cards: ['6h'], acts: [['hero', 'check'], ['BTN', 'bet', 45]] } }],
  [['As', '8c'], ['call', 'raise'], { flop: { cards: ['Ah', 'Td', '4s'], acts: [['hero', 'check'], ['BTN', 'bet', 7], ['hero', 'call']] }, turn: { cards: ['5c'], acts: [['hero', 'check'], ['BTN', 'bet', 18], ['hero', 'call']] }, river: { cards: ['2h'], acts: [['hero', 'check'], ['BTN', 'bet', 45]] } }],
]);
// a nit bets big on every street: one pair folds on the river
add('fold-to-nit', { pos: 'BB', pre: [['BTN', 'raise', 5], ['SB', 'fold'], ['hero', 'call']], styles: { BTN: 'nit' } }, [
  [['Jc', '9d'], 'fold', { flop: { cards: ['Jh', '7s', '3c'], acts: [['hero', 'check'], ['BTN', 'bet', 8], ['hero', 'call']] }, turn: { cards: ['Kd'], acts: [['hero', 'check'], ['BTN', 'bet', 20], ['hero', 'call']] }, river: { cards: ['5h'], acts: [['hero', 'check'], ['BTN', 'bet', 55]] } }],
  [['8c', '8d'], 'fold', { flop: { cards: ['Th', '6s', '2c'], acts: [['hero', 'check'], ['BTN', 'bet', 8], ['hero', 'call']] }, turn: { cards: ['Qd'], acts: [['hero', 'check'], ['BTN', 'bet', 20], ['hero', 'call']] }, river: { cards: ['3h'], acts: [['hero', 'check'], ['BTN', 'bet', 55]] } }],
]);

// a nit checks to you on every street: their range is weak and they fold it, so a missed draw bets as a bluff
add('bluff-nit', { pos: 'BTN', pre: [['hero', 'raise', 5], ['SB', 'fold'], ['BB', 'call']], styles: { BB: 'nit' } }, [
  [['Jh', 'Th'], 'bet', checkedRiver(['9h', '4h', '2c'], 'Kd', '3s')],
  [['6c', '5c'], 'bet', checkedRiver(['8c', '7d', 'Kh'], 'Qs', '2d')],
  [['Qd', 'Jd'], 'bet', checkedRiver(['Td', '9c', '3d'], '2h', '4s')],
]);

module.exports = { spots };
