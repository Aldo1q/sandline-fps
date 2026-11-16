// The economy: money earned and spent between rounds. A kill pays, a plant
// pays, winning pays more than losing, and a losing streak pays a little extra
// so a bad half never locks the player out of a rifle. The buy menu sells guns,
// grenades and kevlar; the player starts with a pistol and $800.
import { WEAPON_DEFS } from './weapons.js';

export const SHOP = [
  { id: 'rifle', kind: 'weapon', name: 'VK-47 Rifle', price: 2700, desc: 'Auto rifle. 3 shots to the body, 1 to the head.' },
  { id: 'smg', kind: 'weapon', name: 'KX-9 SMG', price: 1500, desc: 'Fast, light, forgiving up close.' },
  { id: 'sniper', kind: 'weapon', name: 'LR-80 Marksman', price: 4000, desc: 'One body shot nearly kills. Slow, loud, final.' },
  { id: 'frag', kind: 'grenade', name: 'Frag Grenade', price: 300, desc: 'Bounces, then bursts. Up to 90 damage.' },
  { id: 'smoke', kind: 'grenade', name: 'Smoke Grenade', price: 300, desc: 'A 12 s cloud bots cannot see through.' },
  { id: 'flash', kind: 'grenade', name: 'Flashbang', price: 200, desc: 'Blinds anyone looking at the burst.' },
  { id: 'kevlar', kind: 'armor', name: 'Kevlar Vest', price: 650, armor: 100, desc: '100 armour. Absorbs half of each hit.' },
  { id: 'heavy', kind: 'armor', name: 'Heavy Kevlar', price: 1000, armor: 150, desc: '150 armour. Heavy plate, same half-absorb.' },
  { id: 'medkit', kind: 'medkit', name: 'Field Kit', price: 400, desc: 'Restore full health during the buy phase.' },
];

export const AWARDS = {
  kill: 300,
  plant: 300,
  win: 3250,
  loss: 1900,
  lossStreakBonus: 500,
  lossStreakMax: 3400,
};

export function createEconomy() {
  const state = {
    money: 800,
    lossStreak: 0,
    owned: { pistol: { mag: 12, reserve: 36 } },
    currentWeapon: 'pistol',
    grenades: { frag: 0, smoke: 0, flash: 0 },
    armor: 0,
  };

  function canAfford(price) {
    return state.money >= price;
  }

  // Buy an item. Returns { ok, reason }. Weapons keep the ammo the player
  // already owns for them; buying a gun the player owns refills its reserve.
  function buy(id) {
    const item = SHOP.find((s) => s.id === id);
    if (!item) return { ok: false, reason: 'unknown item' };
    if (!canAfford(item.price)) return { ok: false, reason: 'not enough money' };
    if (item.kind === 'weapon') {
      const def = WEAPON_DEFS[id];
      if (state.owned[id]) {
        state.owned[id].reserve = def.reserve;
      } else {
        state.owned[id] = { mag: def.magSize, reserve: def.reserve };
      }
      state.currentWeapon = id;
    } else if (item.kind === 'grenade') {
      if (state.grenades[id] >= 2) return { ok: false, reason: 'already carrying two' };
      state.grenades[id] += 1;
    } else if (item.kind === 'armor') {
      if (state.armor >= (item.armor || 100)) return { ok: false, reason: 'armour already full' };
      state.armor = item.armor || 100;
    } else if (item.kind === 'medkit') {
      // Health itself lives on the player; main.js applies the heal.
    }
    state.money -= item.price;
    return { ok: true };
  }

  function awardKill() {
    state.money += AWARDS.kill;
  }

  function awardPlant() {
    state.money += AWARDS.plant;
  }

  function awardRound(won) {
    if (won) {
      state.money += AWARDS.win;
      state.lossStreak = 0;
    } else {
      const lossPay = Math.min(AWARDS.loss + state.lossStreak * AWARDS.lossStreakBonus, AWARDS.lossStreakMax);
      state.money += lossPay;
      state.lossStreak += 1;
    }
  }

  // A new round keeps the guns and armour; grenades stay bought, ammo refills
  // only what the player owns (reserve is kept, the magazine is topped up).
  function nextRound() {
    for (const id of Object.keys(state.owned)) {
      const def = WEAPON_DEFS[id];
      const ammo = state.owned[id];
      const need = def.magSize - ammo.mag;
      const take = Math.min(need, ammo.reserve);
      ammo.mag += take;
      ammo.reserve -= take;
    }
  }

  return {
    state,
    canAfford,
    buy,
    awardKill,
    awardPlant,
    awardRound,
    nextRound,
  };
}
