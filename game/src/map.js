// Dustline Yard: an original desert-industrial yard, 46 x 32 m. Two bomb sites
// (A north-west, B north-east), a mid wall with two doors, a west and an east
// warehouse block that make the long corridors, and crates and containers for
// cover. Every solid is a box collider and a bullet stopper. Waypoints form the
// graph the bots pathfind on; edges are clear straight lines by construction.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32 } from './rng.js';

export const MAP = { minX: -23, maxX: 23, minZ: -16, maxZ: 16 };

export const SITES = {
  A: { id: 'A', center: new THREE.Vector3(-17, 0, -11), radius: 4.5 },
  B: { id: 'B', center: new THREE.Vector3(17, 0, -11), radius: 4.5 },
};

export const SPAWNS = {
  attack: [
    new THREE.Vector3(0, 0, 13),
    new THREE.Vector3(-3, 0, 13.5),
    new THREE.Vector3(3, 0, 13.5),
    new THREE.Vector3(-6, 0, 12),
    new THREE.Vector3(6, 0, 12),
  ],
  defend: [
    new THREE.Vector3(-16, 0, -10),
    new THREE.Vector3(-18.5, 0, -12.5),
    new THREE.Vector3(16, 0, -10),
    new THREE.Vector3(18.5, 0, -12.5),
    new THREE.Vector3(0, 0, -5),
  ],
};

// Waypoint graph: id -> { x, z, links }. Bots run BFS over it.
export const WAYPOINTS = {
  attSpawn: { x: 0, z: 13, links: ['attMid', 'attA1', 'attB1'] },
  attMid: { x: 0, z: 8, links: ['attSpawn', 'midL', 'midR', 'attA1', 'attB1'] },
  midL: { x: -2, z: 0, links: ['attMid', 'midC', 'attA2'] },
  midR: { x: 2, z: 0, links: ['attMid', 'midC', 'attB2'] },
  midC: { x: 0, z: -2, links: ['midL', 'midR', 'defMid', 'defMid2'] },
  defMid: { x: -3, z: -3, links: ['midC', 'defA1', 'defMid2'] },
  defMid2: { x: 3, z: -3, links: ['midC', 'defB1', 'defMid'] },
  attA1: { x: -10, z: 10, links: ['attSpawn', 'attMid', 'attA2', 'longW1'] },
  attA2: { x: -10, z: 4, links: ['attA1', 'midL', 'defA1'] },
  defA1: { x: -14, z: -8, links: ['attA2', 'defMid', 'siteA', 'defA2'] },
  defA2: { x: -20, z: -6, links: ['defA1', 'siteA', 'longW3'] },
  siteA: { x: -17, z: -11, links: ['defA1', 'defA2', 'longW3'] },
  longW1: { x: -21, z: 10, links: ['attA1', 'longW2'] },
  longW2: { x: -21, z: 0, links: ['longW1', 'longW3'] },
  longW3: { x: -21, z: -8, links: ['longW2', 'siteA', 'defA2'] },
  attB1: { x: 10, z: 10, links: ['attSpawn', 'attMid', 'attB2', 'long1'] },
  attB2: { x: 10, z: 4, links: ['attB1', 'midR', 'defB1'] },
  defB1: { x: 14, z: -8, links: ['attB2', 'defMid2', 'siteB', 'defB2'] },
  defB2: { x: 20, z: -6, links: ['defB1', 'siteB', 'long3'] },
  siteB: { x: 17, z: -11, links: ['defB1', 'defB2', 'long3'] },
  long1: { x: 21, z: 10, links: ['attB1', 'long2'] },
  long2: { x: 21, z: 0, links: ['long1', 'long3'] },
  long3: { x: 21, z: -8, links: ['long2', 'siteB', 'defB2'] },
};

function canvasTexture(size, draw) {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  draw(c.getContext('2d'), size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

function groundTexture() {
  const random = mulberry32(1337);
  return canvasTexture(512, (g, s) => {
    g.fillStyle = PALETTE.sand;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 5200; i += 1) {
      const v = random();
      g.fillStyle = v < 0.5 ? 'rgba(120,90,50,0.25)' : 'rgba(230,205,150,0.22)';
      const r = 1 + random() * 3;
      g.beginPath();
      g.arc(random() * s, random() * s, r, 0, Math.PI * 2);
      g.fill();
    }
    // faint tyre tracks
    g.strokeStyle = 'rgba(90,65,35,0.18)';
    g.lineWidth = 9;
    for (let i = 0; i < 5; i += 1) {
      const y = 60 + i * 90 + random() * 20;
      g.beginPath();
      g.moveTo(0, y);
      g.bezierCurveTo(s * 0.3, y + 14, s * 0.6, y - 14, s, y + 6);
      g.stroke();
    }
  });
}

function wallTexture() {
  const random = mulberry32(777);
  return canvasTexture(256, (g, s) => {
    g.fillStyle = PALETTE.surface;
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < 1600; i += 1) {
      g.fillStyle = random() < 0.5 ? 'rgba(0,0,0,0.16)' : 'rgba(255,240,200,0.07)';
      g.fillRect(random() * s, random() * s, 2 + random() * 3, 2 + random() * 3);
    }
    g.strokeStyle = 'rgba(0,0,0,0.28)';
    g.lineWidth = 2;
    for (let y = 42; y < s; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(s, y);
      g.stroke();
    }
  });
}

function siteSignTexture(letter, colorHex) {
  return canvasTexture(128, (g, s) => {
    g.fillStyle = '#141210';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = colorHex;
    g.lineWidth = 6;
    g.strokeRect(8, 8, s - 16, s - 16);
    g.fillStyle = colorHex;
    g.font = 'bold 84px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(letter, s / 2, s / 2 + 4);
  });
}

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const groundTex = groundTexture();
  groundTex.repeat.set(6, 4);
  const wallTex = wallTexture();
  wallTex.repeat.set(8, 1);

  const mats = {
    ground: new THREE.MeshStandardMaterial({ map: groundTex, roughness: 0.96, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.92, metalness: 0 }),
    steel: new THREE.MeshStandardMaterial({ color: PALETTE.steel, roughness: 0.6, metalness: 0.45 }),
    steelLight: new THREE.MeshStandardMaterial({ color: PALETTE.steelLight, roughness: 0.55, metalness: 0.4 }),
    wood: new THREE.MeshStandardMaterial({ color: PALETTE.wood, roughness: 0.85, metalness: 0 }),
    sandbag: new THREE.MeshStandardMaterial({ color: PALETTE.sandDark, roughness: 1, metalness: 0 }),
    blue: new THREE.MeshStandardMaterial({ color: PALETTE.containerBlue, roughness: 0.65, metalness: 0.3 }),
    green: new THREE.MeshStandardMaterial({ color: PALETTE.containerGreen, roughness: 0.65, metalness: 0.3 }),
    rust: new THREE.MeshStandardMaterial({ color: PALETTE.rustDark, roughness: 0.7, metalness: 0.25 }),
    tower: new THREE.MeshStandardMaterial({ color: PALETTE.hairline, roughness: 0.8, metalness: 0.2 }),
  };

  const colliders = [];
  const shootables = [];

  function box(w, h, d, x, y, z, mat, collide = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    const bb = new THREE.Box3().setFromObject(mesh);
    if (collide) colliders.push(bb);
    shootables.push(mesh);
    return mesh;
  }

  // Ground and perimeter.
  box(46.4, 0.4, 32.4, 0, -0.2, 0, 'ground');
  box(46.4, 4.6, 0.4, 0, 2.3, -16.2, 'wall');
  box(46.4, 4.6, 0.4, 0, 2.3, 16.2, 'wall');
  box(0.4, 4.6, 32.4, -23.2, 2.3, 0, 'wall');
  box(0.4, 4.6, 32.4, 23.2, 2.3, 0, 'wall');

  // Mid wall across z=0 with two door gaps (x -3..-1 and 1..3).
  box(5, 4, 0.4, -5.5, 2, 0, 'wall');
  box(2, 4, 0.4, 0, 2, 0, 'wall');
  box(5, 4, 0.4, 5.5, 2, 0, 'wall');
  // Low cover walls either side of mid.
  box(4, 1.15, 0.4, -4, 0.575, 4, 'sandbag');
  box(4, 1.15, 0.4, 4, 0.575, 4, 'sandbag');
  box(4, 1.15, 0.4, -4, 0.575, -4, 'sandbag');
  box(4, 1.15, 0.4, 4, 0.575, -4, 'sandbag');

  // Warehouses: east (x 14..19, z 0..6) and west (x -19..-14, z 0..6).
  box(5, 4, 6, 16.5, 2, 3, 'steel');
  box(5, 4, 6, -16.5, 2, 3, 'steel');
  // Rooftop trim so the blocks read as buildings.
  box(5.4, 0.3, 6.4, 16.5, 4.15, 3, 'steelLight');
  box(5.4, 0.3, 6.4, -16.5, 4.15, 3, 'steelLight');

  // Site A cover: crates and a blue container.
  box(1.2, 1.2, 1.2, -15, 0.6, -9, 'wood');
  box(1.2, 1.2, 1.2, -19, 0.6, -9, 'wood');
  box(1.2, 1.2, 1.2, -14, 0.6, -13, 'wood');
  box(2.4, 2.4, 4.4, -20.5, 1.2, -13.5, 'blue');
  box(1.2, 1.2, 1.2, -15, 1.8, -9, 'wood');
  // Site B cover: mirrored, green container.
  box(1.2, 1.2, 1.2, 15, 0.6, -9, 'wood');
  box(1.2, 1.2, 1.2, 19, 0.6, -9, 'wood');
  box(1.2, 1.2, 1.2, 14, 0.6, -13, 'wood');
  box(2.4, 2.4, 4.4, 20.5, 1.2, -13.5, 'green');
  box(1.2, 1.2, 1.2, 15, 1.8, -9, 'wood');

  // Spawn cover: sandbag lines south.
  box(3, 1.1, 0.5, -4, 0.55, 10.5, 'sandbag');
  box(3, 1.1, 0.5, 4, 0.55, 10.5, 'sandbag');
  // Mid-field crates.
  box(1.2, 1.2, 1.2, -7, 0.6, 6, 'wood');
  box(1.2, 1.2, 1.2, 7, 0.6, 6, 'wood');
  box(1.2, 1.2, 1.2, -7, 0.6, -6, 'wood');
  box(1.2, 1.2, 1.2, 7, 0.6, -6, 'wood');
  // Long corridors: a rust container each side for the corner fight.
  box(2.4, 2.4, 2.4, 21, 1.2, -3, 'rust');
  box(2.4, 2.4, 2.4, -21, 1.2, -3, 'rust');
  // Watchtower pillar north of mid.
  box(1.6, 8, 1.6, 0, 4, -8, 'tower');
  box(2.6, 0.4, 2.6, 0, 8.2, -8, 'tower');

  // Barrels (cylinders; collider approximated by a box).
  const barrelGeo = new THREE.CylinderGeometry(0.42, 0.42, 1.05, 12);
  const barrelMat = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.6, metalness: 0.35 });
  for (const [x, z] of [[-12, 8], [-11.2, 8.4], [12, -12], [12.8, -12.2], [-2, 12], [19, 6.5]]) {
    const b = new THREE.Mesh(barrelGeo, barrelMat);
    b.position.set(x, 0.525, z);
    b.castShadow = true;
    b.receiveShadow = true;
    group.add(b);
    colliders.push(new THREE.Box3(new THREE.Vector3(x - 0.42, 0, z - 0.42), new THREE.Vector3(x + 0.42, 1.05, z + 0.42)));
    shootables.push(b);
  }

  // Site decals: painted zones + signs on the north wall.
  function siteDecal(site, colorHex) {
    const decal = new THREE.Mesh(
      new THREE.CircleGeometry(site.radius, 40),
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.16, depthWrite: false }),
    );
    decal.rotation.x = -Math.PI / 2;
    decal.position.set(site.center.x, 0.02, site.center.z);
    group.add(decal);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(site.radius - 0.15, site.radius, 48),
      new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.center.x, 0.03, site.center.z);
    group.add(ring);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: siteSignTexture(site.id, colorHex), transparent: true }),
    );
    sign.position.set(site.center.x, 3.1, -15.95);
    group.add(sign);
  }
  siteDecal(SITES.A, PALETTE.accent);
  siteDecal(SITES.B, PALETTE.rust);

  // Light: warm late-afternoon key, cool fill, dusty sky.
  const sky = new THREE.HemisphereLight(new THREE.Color(PALETTE.sky), new THREE.Color(PALETTE.surface), 1.0);
  scene.add(sky);
  const key = new THREE.DirectionalLight(new THREE.Color(PALETTE.sun), 2.3);
  key.position.set(18, 24, 10);
  key.target.position.set(0, 0, -2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -30;
  key.shadow.camera.right = 30;
  key.shadow.camera.top = 30;
  key.shadow.camera.bottom = -30;
  key.shadow.camera.far = 70;
  key.shadow.bias = -0.0006;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(new THREE.Color(PALETTE.muted), 0.5);
  fill.position.set(-12, 10, -14);
  scene.add(fill);

  return { colliders, shootMeshes: shootables, group, sites: SITES, spawns: SPAWNS, waypoints: WAYPOINTS };
}
