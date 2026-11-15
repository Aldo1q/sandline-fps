// Grenades: thrown on an arc, bouncing off walls and floor, then either a frag
// that hurts by distance (halved through a wall) or a smoke that blinds bots
// and the player for twelve seconds. One small pool, reused every round.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { overlaps } from './collision.js';

const GRAVITY = 14;
const FRAG_FUSE = 1.6;
const FRAG_RADIUS = 7;
const FRAG_MAX = 90;
const SMOKE_TIME = 12;

export function createGrenades(scene, colliders, meshes) {
  const group = new THREE.Group();
  scene.add(group);
  const fragMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steelLight), roughness: 0.5, metalness: 0.5 });
  const smokeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.muted), roughness: 0.9, metalness: 0 });
  const items = [];
  const clouds = [];

  function spawnCloud(center) {
    const puffs = [];
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(0xd8d2c4), transparent: true, opacity: 0.82, roughness: 1, depthWrite: false,
    });
    for (let i = 0; i < 14; i += 1) {
      const p = new THREE.Mesh(new THREE.SphereGeometry(0.9 + Math.random() * 0.9, 10, 8), mat);
      p.position.set(
        center.x + (Math.random() * 2 - 1) * 2.2,
        0.6 + Math.random() * 1.8,
        center.z + (Math.random() * 2 - 1) * 2.2,
      );
      p.scale.y = 0.8;
      group.add(p);
      puffs.push(p.position.clone());
    }
    const cloud = { center: center.clone(), puffs, meshes: [], radius: 3.2, left: SMOKE_TIME, active: true };
    for (let i = 0; i < 14; i += 1) cloud.meshes.push(group.children[group.children.length - 14 + i]);
    clouds.push(cloud);
    return cloud;
  }

  function throwGrenade(kind, from, dir, speed = 13) {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8), kind === 'smoke' ? smokeMat : fragMat);
    mesh.position.copy(from);
    group.add(mesh);
    items.push({
      kind,
      mesh,
      vel: dir.clone().multiplyScalar(speed).add(new THREE.Vector3(0, 3.2, 0)),
      fuse: FRAG_FUSE,
      done: false,
    });
  }

  // Explode a frag: returns a list of { target, damage } for main.js to apply.
  // Targets are { position: Vector3, radius } entries (player + bots).
  function explodeFrag(pos, targets, losBlocked) {
    const hits = [];
    for (const t of targets) {
      const d = t.position.distanceTo(pos);
      if (d > FRAG_RADIUS) continue;
      let dmg = FRAG_MAX * (1 - d / FRAG_RADIUS) + 10;
      if (losBlocked && losBlocked(t.position, pos)) dmg *= 0.5;
      hits.push({ target: t, damage: Math.round(dmg) });
    }
    return hits;
  }

  function step(dt, onFrag, onSmoke) {
    for (const item of items) {
      if (item.done) continue;
      item.vel.y -= GRAVITY * dt;
      const next = item.mesh.position.clone().addScaledVector(item.vel, dt);
      // Floor bounce.
      if (next.y < 0.09) {
        next.y = 0.09;
        item.vel.y = Math.abs(item.vel.y) * 0.45;
        item.vel.x *= 0.7;
        item.vel.z *= 0.7;
      }
      // Wall bounce: test the next spot against colliders, reflect the axis.
      if (overlaps(colliders, next.x, next.y, next.z, 0.09, 0.18, 0)) {
        const testX = item.mesh.position.clone();
        testX.x = next.x;
        if (overlaps(colliders, testX.x, testX.y, testX.z, 0.09, 0.18, 0)) item.vel.x *= -0.45;
        const testZ = item.mesh.position.clone();
        testZ.z = next.z;
        if (overlaps(colliders, testZ.x, testZ.y, testZ.z, 0.09, 0.18, 0)) item.vel.z *= -0.45;
        next.copy(item.mesh.position).addScaledVector(item.vel, dt);
        if (next.y < 0.09) next.y = 0.09;
      }
      item.mesh.position.copy(next);
      item.fuse -= dt;
      if (item.fuse <= 0) {
        item.done = true;
        group.remove(item.mesh);
        if (item.kind === 'frag') onFrag(item.mesh.position.clone());
        else {
          spawnCloud(item.mesh.position.clone());
          if (onSmoke) onSmoke();
        }
      }
    }
    for (let i = items.length - 1; i >= 0; i -= 1) {
      if (items[i].done) items.splice(i, 1);
    }
    for (let i = clouds.length - 1; i >= 0; i -= 1) {
      const c = clouds[i];
      c.left -= dt;
      const fade = Math.min(1, c.left / 2);
      for (const m of c.meshes) m.material.opacity = 0.82 * fade;
      if (c.left <= 0) {
        c.active = false;
        for (const m of c.meshes) group.remove(m);
        clouds.splice(i, 1);
      }
    }
  }

  function reset() {
    for (const item of items) group.remove(item.mesh);
    items.length = 0;
    for (const c of clouds) for (const m of c.meshes) group.remove(m);
    clouds.length = 0;
  }

  return {
    throwGrenade,
    explodeFrag,
    step,
    reset,
    get clouds() {
      return clouds;
    },
    get active() {
      return items.length > 0 || clouds.length > 0;
    },
  };
}
