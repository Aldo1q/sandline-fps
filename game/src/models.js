// models.js — the soldiers. One builder, one job: turn three.js primitives
// into a readable low-poly soldier with a helmeted head, a team-coloured vest,
// arms holding a rifle, and legs that swing while walking. Vanguard wear teal,
// Raiders wear rust, so the enemy reads at a glance down a lane. Materials
// are shared per team (built once, reused by all nine bots) and every part is
// a plain box or cylinder, so the whole squad costs nine small draw groups.
// The group faces -Z, matching bots.js (yaw 0 = facing north, toward -Z).
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const teamMats = {};
function matsFor(team) {
  if (teamMats[team]) return teamMats[team];
  const teamColor = team === 'attack' ? PALETTE.accent : PALETTE.rust;
  const m = {
    vest: new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColor), roughness: 0.85, metalness: 0.05 }),
    cloth: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.9, metalness: 0.05 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color(0x1c1e22), roughness: 0.7, metalness: 0.2 }),
    skin: new THREE.MeshStandardMaterial({ color: new THREE.Color(0xc9a06a), roughness: 0.9, metalness: 0 }),
    gun: new THREE.MeshStandardMaterial({ color: new THREE.Color(0x14161a), roughness: 0.45, metalness: 0.55 }),
    plate: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steelLight), roughness: 0.6, metalness: 0.35 }),
    glow: new THREE.MeshBasicMaterial({ color: new THREE.Color(teamColor) }),
  };
  teamMats[team] = m;
  return m;
}

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  return mesh;
}

// Build one soldier. Returns { group, head, torso, legL, legR, armL, armR,
// gun } — head/torso are the hit meshes (bots.js / main.js raycast them),
// the legs are hip-pivoted groups so the walk swing is one rotation each,
// and the arms are shoulder-pivoted groups aimed forward at the rifle.
export function createSoldier(team) {
  const m = matsFor(team);
  const group = new THREE.Group();

  // Legs: hip pivot at y 0.78, boot toe forward (-Z is forward). Raiders get
  // bulky knee pads; Vanguard get slim shin guards — silhouette differs.
  function leg(side) {
    const pivot = new THREE.Group();
    pivot.position.set(0.14 * side, 0.78, 0);
    const thigh = box(0.19, 0.5, 0.22, m.cloth, 0, -0.25, 0);
    const boot = box(0.2, 0.12, 0.3, m.dark, 0, -0.72, -0.03);
    pivot.add(thigh, boot);
    if (team === 'defend') pivot.add(box(0.21, 0.14, 0.08, m.dark, 0, -0.48, -0.13));
    else pivot.add(box(0.2, 0.3, 0.05, m.plate, 0, -0.55, -0.12));
    return pivot;
  }
  const legL = leg(-1);
  const legR = leg(1);

  // Torso: vest, darker chest plate, belt, shoulder pads.
  const torso = box(0.52, 0.6, 0.3, m.vest, 0, 1.09, 0);
  const plate = box(0.4, 0.34, 0.06, m.plate, 0, 1.14, -0.16);
  const belt = box(0.54, 0.08, 0.32, m.dark, 0, 0.82, 0);
  // Kit differs by team: Vanguard carry a backpack, Raiders wear a chest
  // rig with two front pouches — readable from the front and the back.
  const pack = team === 'attack'
    ? box(0.4, 0.44, 0.16, m.cloth, 0, 1.16, 0.22)
    : box(0.4, 0.2, 0.1, m.dark, 0, 1.0, -0.19);
  const pouchL = team === 'defend' ? box(0.14, 0.16, 0.08, m.dark, -0.11, 1.0, -0.2) : null;
  const pouchR = team === 'defend' ? box(0.14, 0.16, 0.08, m.dark, 0.11, 1.0, -0.2) : null;
  const padL = box(0.16, 0.08, 0.3, m.vest, -0.3, 1.36, 0);
  const padR = box(0.16, 0.08, 0.3, m.vest, 0.3, 1.36, 0);
  // Team stripe across the chest so the side reads at 40 m.
  const stripe = box(0.54, 0.07, 0.32, m.glow, 0, 1.3, 0);
  // Team armband on the left arm, another colour cue at a glance.
  const armband = box(0.15, 0.09, 0.16, m.glow, -0.31, 1.28, 0);

  // Head: skin face, helmet, dark visor slit, team helmet band. Helmets
  // differ: Vanguard wear a low dome, Raiders a wide brim.
  const head = box(0.3, 0.28, 0.3, m.skin, 0, 1.58, 0);
  const helmet = team === 'attack'
    ? box(0.34, 0.16, 0.34, m.dark, 0, 1.74, 0)
    : box(0.36, 0.12, 0.36, m.dark, 0, 1.74, 0);
  const brim = team === 'attack'
    ? box(0.36, 0.04, 0.38, m.dark, 0, 1.68, -0.01)
    : box(0.44, 0.04, 0.44, m.dark, 0, 1.68, -0.01);
  const visor = box(0.26, 0.07, 0.02, m.glow, 0, 1.6, -0.16);
  const band = box(0.37, 0.05, 0.37, m.vest, 0, 1.7, 0);

  // Rifle, held across the chest pointing forward (-Z): receiver, long
  // barrel, magazine, stock, sight. The arms reach to it.
  const gun = new THREE.Group();
  gun.position.set(0.1, 1.24, -0.3);
  gun.add(
    box(0.08, 0.1, 0.5, m.gun, 0, 0, -0.12),
    box(0.04, 0.04, 0.42, m.gun, 0, 0.03, -0.5),
    box(0.06, 0.16, 0.1, m.dark, 0, -0.11, -0.05),
    box(0.07, 0.09, 0.2, m.dark, 0, -0.01, 0.22),
    box(0.02, 0.05, 0.08, m.plate, 0, 0.08, -0.05),
  );

  // Arms: shoulder pivots, angled down-forward so the hands meet the rifle.
  // Right hand grips the receiver, left hand reaches the barrel.
  function arm(side, reachZ) {
    const pivot = new THREE.Group();
    pivot.position.set(0.31 * side, 1.34, 0);
    pivot.rotation.x = -1.05; // swing the arm forward to the gun
    const limb = box(0.13, 0.52, 0.14, m.vest, 0, -0.26, 0);
    const hand = box(0.12, 0.1, 0.12, m.skin, 0, -0.54, 0);
    pivot.add(limb, hand);
    pivot.rotation.z = side * -0.18; // angle inward toward the rifle
    pivot.userData.reachZ = reachZ;
    return pivot;
  }
  const armR = arm(1, -0.3);
  const armL = arm(-1, -0.55);

  group.add(legL, legR, torso, plate, belt, pack, padL, padR, stripe, armband,
    head, helmet, brim, visor, band, gun, armR, armL);
  if (pouchL) group.add(pouchL, pouchR);
  group.traverse((o) => { if (o.isMesh) o.userData.botBody = true; });
  head.userData.part = 'head';
  torso.userData.part = 'body';
  // Limb hitboxes: thighs and boots count as limbs (0.7x damage, main.js).
  const legMeshes = [legL.children[0], legL.children[1], legR.children[0], legR.children[1]];
  for (const lm of legMeshes) lm.userData.part = 'limb';
  return { group, head, torso, legL, legR, armL, armR, gun, legMeshes };
}
