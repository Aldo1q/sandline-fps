// Weapons: four guns, one class. Each definition owns its numbers — damage,
// headshot damage, magazine, reserve, fire rate, reload time, spread and price.
// The class owns the view model, the muzzle flash, the kick and the reload
// animation. main.js owns the ray and the damage; this file never decides a hit.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', short: 'P9', price: 0,
    bodyDamage: 34, headDamage: 100, magSize: 12, reserve: 36,
    fireGap: 0.16, reloadTime: 1.4, auto: false, sound: 'pistol',
    spreadStill: 0.004, spreadMoving: 0.03, kick: 0.03, barrel: 0.22, bulky: 0.7,
  },
  rifle: {
    id: 'rifle', name: 'VK-47 Rifle', short: 'VK-47', price: 2700,
    bodyDamage: 34, headDamage: 100, magSize: 30, reserve: 90,
    fireGap: 0.1, reloadTime: 2.0, auto: true, sound: 'rifle',
    spreadStill: 0.0022, spreadMoving: 0.028, kick: 0.05, barrel: 0.42, bulky: 1,
  },
  smg: {
    id: 'smg', name: 'KX-9 SMG', short: 'KX-9', price: 1500,
    bodyDamage: 26, headDamage: 78, magSize: 32, reserve: 96,
    fireGap: 0.075, reloadTime: 1.8, auto: true, sound: 'smg',
    spreadStill: 0.006, spreadMoving: 0.032, kick: 0.032, barrel: 0.3, bulky: 0.85,
  },
  sniper: {
    id: 'sniper', name: 'LR-80 Marksman', short: 'LR-80', price: 4000,
    bodyDamage: 88, headDamage: 200, magSize: 5, reserve: 15,
    fireGap: 1.1, reloadTime: 2.8, auto: false, sound: 'sniper',
    spreadStill: 0.0008, spreadMoving: 0.05, kick: 0.11, barrel: 0.62, bulky: 1.15,
  },
};

export function createWeapon(camera) {
  const gripMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.5, metalness: 0.35 });
  const accentMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.3 });
  const skinMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(0xc9a06a), roughness: 0.9, metalness: 0 });
  const sleeveMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.85, metalness: 0.05 });

  const model = new THREE.Group();
  model.position.set(0.24, -0.2, -0.42);
  camera.add(model);

  // The player's own arms, holding the gun: two sleeved forearms reaching
  // from below the frame to the receiver, so the viewmodel reads as a person,
  // not a floating gun. They sit low and far forward so only their ends and
  // the hands show at the bottom edge of the frame.
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), sleeveMat);
  armR.position.set(0.31, -0.4, -0.34);
  armR.rotation.x = 0.9;
  const handR = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.09), skinMat);
  handR.position.set(0.27, -0.28, -0.5);
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), sleeveMat);
  armL.position.set(0.1, -0.42, -0.42);
  armL.rotation.x = 1.0;
  armL.rotation.y = 0.3;
  const handL = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.06, 0.09), skinMat);
  handL.position.set(0.19, -0.29, -0.62);
  camera.add(armR, handR, armL, handL);

  // Muzzle flash: two crossed planes with a soft star texture (bright core,
  // transparent edges, additive) plus a point light, so the shot reads as a
  // star burst and lights the wall ahead — never a solid yellow board.
  const flashCanvas = document.createElement('canvas');
  flashCanvas.width = 64;
  flashCanvas.height = 64;
  const fg = flashCanvas.getContext('2d');
  const grad = fg.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, 'rgba(255,240,200,1)');
  grad.addColorStop(0.35, 'rgba(255,194,102,0.9)');
  grad.addColorStop(1, 'rgba(255,150,60,0)');
  fg.fillStyle = grad;
  fg.fillRect(0, 0, 64, 64);
  fg.fillStyle = 'rgba(255,220,150,0.9)';
  fg.fillRect(30, 4, 4, 56);
  fg.fillRect(4, 30, 56, 4);
  const flashTex = new THREE.CanvasTexture(flashCanvas);
  const flashMat = new THREE.MeshBasicMaterial({ map: flashTex, color: new THREE.Color(PALETTE.flash), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
  flash.position.set(0.24, -0.18, -1.0);
  flash.visible = false;
  const flash2 = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
  flash2.position.copy(flash.position);
  flash2.rotation.y = Math.PI / 2;
  flash2.visible = false;
  camera.add(flash, flash2);

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.flash), 0, 5.5);
  flashLight.position.set(0.24, -0.16, -1.1);
  camera.add(flashLight);

  let def = WEAPON_DEFS.pistol;
  const state = { mag: def.magSize, reserve: def.reserve, cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, switching: 0 };

  function buildModel() {
    while (model.children.length) model.remove(model.children[0]);
    const s = def.bulky;
    const receiver = new THREE.Mesh(new THREE.BoxGeometry(0.09 * s, 0.1 * s, 0.42 * s), bodyMat);
    const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045 * s, 0.045 * s, def.barrel), gripMat);
    barrel.position.set(0, 0.025 * s, -0.21 * s - def.barrel / 2);
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.075 * s, 0.08 * s, 0.22 * s), gripMat);
    stock.position.set(0, -0.02 * s, 0.3 * s);
    const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.05 * s, 0.06), accentMat);
    sight.position.set(0, 0.07 * s, -0.1 * s);
    model.add(receiver, barrel, stock, sight);
  }
  buildModel();

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    state.switching = Math.max(0, state.switching - dt);
    model.position.z = -0.42 + state.kick;
    model.position.y = -0.2 - state.switching * 0.12;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash2.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flash2.rotation.z = -state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 7 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      model.rotation.x = -0.55 * Math.min(1, (def.reloadTime - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.magSize - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    get def() {
      return def;
    },
    step,
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0 && state.switching === 0;
    },
    pullTrigger() {
      state.cooldown = def.fireGap;
      state.flash = 0.06;
      state.kick = 0.055 * def.kick / 0.05;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      if (state.reloadLeft > 0 || state.mag === def.magSize || state.reserve === 0) return false;
      state.reloadLeft = def.reloadTime;
      return true;
    },
    spread(speed) {
      const move = Math.min(1, speed / 5.2);
      return def.spreadStill + move * def.spreadMoving;
    },
    refill() {
      state.mag = def.magSize;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
    // Switch to another gun, keeping the ammo the player owns for it.
    equip(nextDef, ammo) {
      def = nextDef;
      state.mag = ammo.mag;
      state.reserve = ammo.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.switching = 0.35;
      buildModel();
    },
    ammo() {
      return { mag: state.mag, reserve: state.reserve };
    },
  };
}
