// Shared collision: axis-aligned boxes for walls and cover, one resolver for
// anything that walks (the player and every bot), and a line-of-sight test that
// treats smoke as a wall. Everything here is pure math on Box3 lists; the map
// owns the lists, the walkers own their radii.
import * as THREE from 'three';

const probe = new THREE.Box3();
const ray = new THREE.Raycaster();
const hitPoint = new THREE.Vector3();

// True when a vertical capsule of radius r and height h, feet at (x, y, z),
// overlaps any collider. lift shrinks the test at both ends so standing on the
// floor is not read as walking into a wall.
export function overlaps(colliders, x, y, z, radius, height, lift) {
  probe.min.set(x - radius, y + lift, z - radius);
  probe.max.set(x + radius, y + height - lift, z + radius);
  for (let i = 0; i < colliders.length; i += 1) {
    if (probe.intersectsBox(colliders[i])) return colliders[i];
  }
  return null;
}

// Move a walker one axis at a time so a wall never swallows it. Returns the
// position after the move, with velocity zeroed on the blocked axes.
export function moveAxis(colliders, pos, vel, dt, radius, height) {
  const nextX = pos.x + vel.x * dt;
  if (!overlaps(colliders, nextX, pos.y, pos.z, radius, height, 0.04)) pos.x = nextX;
  else vel.x = 0;
  const nextZ = pos.z + vel.z * dt;
  if (!overlaps(colliders, pos.x, pos.y, nextZ, radius, height, 0.04)) pos.z = nextZ;
  else vel.z = 0;
  pos.y += vel.y * dt;
  vel.y = Math.max(-30, vel.y - 20 * dt);
  const hit = overlaps(colliders, pos.x, pos.y, pos.z, radius, height, 0);
  if (hit && vel.y <= 0) {
    pos.y = hit.max.y;
    vel.y = 0;
    return true; // on ground
  }
  if (hit) {
    pos.y = hit.min.y - height;
    vel.y = 0;
  }
  if (pos.y < 0) {
    pos.y = 0;
    vel.y = 0;
    return true;
  }
  return false;
}

// Distance from `from` to the first solid surface along `dir`, or Infinity.
// `meshes` are the raycastable world meshes; smoke is checked separately.
export function wallDistance(from, dir, maxDist, meshes) {
  ray.set(from, dir);
  ray.far = maxDist;
  const hit = ray.intersectObjects(meshes, false)[0];
  return hit ? hit.distance : Infinity;
}

// Line of sight between two points, blocked by world meshes or smoke clouds.
// Smoke clouds are lists of { position, radius } spheres.
export function hasLineOfSight(from, to, meshes, smokeClouds) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const dist = dir.length();
  if (dist < 0.001) return true;
  dir.divideScalar(dist);
  if (wallDistance(from, dir, dist, meshes) < dist - 0.05) return false;
  if (smokeClouds) {
    for (let i = 0; i < smokeClouds.length; i += 1) {
      const c = smokeClouds[i];
      if (!c.active) continue;
      // Ray-sphere test against each puff of the cloud.
      for (let j = 0; j < c.puffs.length; j += 1) {
        const p = c.puffs[j];
        const oc = new THREE.Vector3().subVectors(p, from);
        const t = oc.dot(dir);
        if (t < 0 || t > dist) continue;
        hitPoint.copy(from).addScaledVector(dir, t);
        if (hitPoint.distanceTo(p) < c.radius) return false;
      }
    }
  }
  return true;
}
