// The bomb: the attackers' objective. The player plants it by holding E inside
// a site (3 s channel); it ticks for 35 s and then ends the round for the
// attackers. A defender channels 5 s beside it to defuse. The bomb is a small
// box with a blinking light, so everyone in the round can find it by ear and eye.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PLANT_TIME = 3;
const DEFUSE_TIME = 5;
const BOMB_TIME = 35;

export function createBomb(scene, sites) {
  const group = new THREE.Group();
  scene.add(group);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.34, 0.2, 0.24),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steelLight), roughness: 0.5, metalness: 0.6 }),
  );
  body.castShadow = true;
  const light = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 8, 6),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.rust) }),
  );
  light.position.set(0.1, 0.13, 0);
  const antenna = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.008, 0.3, 6),
    new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.4, metalness: 0.7 }),
  );
  antenna.position.set(-0.12, 0.24, 0);
  group.add(body, light, antenna);
  group.visible = false;

  const beepLight = new THREE.PointLight(new THREE.Color(PALETTE.rust), 0, 4);
  group.add(beepLight);

  const state = {
    carried: true, // with the player until planted
    planted: false,
    site: null,
    position: new THREE.Vector3(),
    timer: BOMB_TIME,
    plantProgress: 0,
    defuseProgress: 0,
    defuser: null,
    exploded: false,
    defused: false,
    blink: 0,
  };

  function reset() {
    state.carried = true;
    state.planted = false;
    state.site = null;
    state.timer = BOMB_TIME;
    state.plantProgress = 0;
    state.defuseProgress = 0;
    state.defuser = null;
    state.exploded = false;
    state.defused = false;
    group.visible = false;
    beepLight.intensity = 0;
  }

  // Which site the player stands in, or null.
  function siteAt(pos) {
    for (const key of Object.keys(sites)) {
      const s = sites[key];
      const dx = pos.x - s.center.x;
      const dz = pos.z - s.center.z;
      if (dx * dx + dz * dz < s.radius * s.radius) return s;
    }
    return null;
  }

  function plantAt(site, pos) {
    state.carried = false;
    state.planted = true;
    state.site = site;
    state.position.copy(pos);
    state.position.y = 0.1;
    state.timer = BOMB_TIME;
    group.position.copy(state.position);
    group.visible = true;
  }

  // dt seconds of channel time. Returns 'planted' | 'defused' | 'exploded' | null.
  // planting: the player holds E in a site. defusing: a defender channels by the bomb.
  function step(dt, planting, defusingBot) {
    if (state.planted) {
      state.timer -= dt;
      state.blink += dt;
      const fast = state.timer < 10;
      const period = fast ? 0.35 : 0.8;
      const on = (state.blink % period) < period * 0.5;
      light.material.color.set(on ? PALETTE.rust : PALETTE.canvas);
      beepLight.intensity = on ? 2.2 : 0;
      if (defusingBot) {
        state.defuseProgress += dt;
        if (state.defuseProgress >= DEFUSE_TIME) {
          state.defused = true;
          group.visible = false;
          return 'defused';
        }
      } else {
        state.defuseProgress = 0;
      }
      if (state.timer <= 0) {
        state.exploded = true;
        group.visible = false;
        return 'exploded';
      }
      return null;
    }
    if (planting) {
      state.plantProgress += dt;
      if (state.plantProgress >= PLANT_TIME) {
        state.plantProgress = 0;
        return 'planted';
      }
    } else {
      state.plantProgress = 0;
    }
    return null;
  }

  return {
    state,
    group,
    reset,
    siteAt,
    plantAt,
    step,
    get planted() {
      return state.planted;
    },
    get timer() {
      return state.timer;
    },
  };
}
