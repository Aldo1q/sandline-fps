// The player: acceleration, friction, gravity, crouch and jump, resolved as a
// box against the world's colliders one axis at a time, so a wall never swallows
// the player. Health and kevlar live here; damage is applied by the combat code
// in main.js, which reads the eye and body positions for bot targeting.
import * as THREE from 'three';
import { overlaps, moveAxis } from './collision.js';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createPlayer(colliders, spawn) {
  const state = {
    position: spawn.clone(),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    health: 100,
    armor: 0,
    alive: true,
  };
  const wish = new THREE.Vector3();

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  // Damage after kevlar: armour absorbs half of what it can, the rest is health.
  function damage(amount) {
    if (!state.alive) return 0;
    let left = amount;
    if (state.armor > 0) {
      const absorbed = Math.min(state.armor, left * 0.5);
      state.armor -= absorbed;
      left -= absorbed;
    }
    state.health = Math.max(0, state.health - left);
    if (state.health === 0) state.alive = false;
    return left;
  }

  function reset(spawnPoint, yaw) {
    state.position.copy(spawnPoint);
    state.velocity.set(0, 0, 0);
    state.yaw = yaw;
    state.pitch = 0;
    state.eye = STAND_EYE;
    state.health = 100;
    state.armor = 0;
    state.alive = true;
    state.crouching = false;
    state.height = STAND_HEIGHT;
  }

  function step(dt, keys) {
    if (!state.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (crouching && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
    } else if (!crouching && state.crouching && !overlaps(colliders, state.position.x, state.position.y, state.position.z, RADIUS, STAND_HEIGHT, 0.02)) {
      state.crouching = false;
      state.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }
    const speed = state.crouching ? CROUCH_SPEED : WALK_SPEED;
    const blend = Math.min(1, (state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }
    if (keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;
    state.onGround = moveAxis(colliders, state.position, state.velocity, dt, RADIUS, state.height);
  }

  return {
    state,
    step,
    look,
    recoil,
    damage,
    reset,
    eyePosition(out) {
      out.set(state.position.x, state.position.y + state.eye, state.position.z);
      return out;
    },
    bodyPosition(out) {
      out.set(state.position.x, state.position.y + state.height * 0.55, state.position.z);
      return out;
    },
    headPosition(out) {
      out.set(state.position.x, state.position.y + state.height * 0.88, state.position.z);
      return out;
    },
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
  };
}
