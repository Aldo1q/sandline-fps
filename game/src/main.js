// JUDGE NOTE — SANDLINE, a round-based tactical FPS in three.js.
// What it is: Vanguard (you + 4 bots) plants a bomb at site A or B against
// 5 Raider bots; first to 5 rounds wins. Pointer-lock mouse look, WASD with
// acceleration, crouch, jump, AABB collision (player.js, collision.js).
// Gunplay (main.js shoot, weapons.js): 4 guns with mag/reserve/reload,
// spread that grows on the move, recoil, named hitboxes — head / torso /
// limb at 0.7x (bots.js capsuleHit, models.js legMeshes) — tracers, muzzle
// flash, impact sparks, floating HEAD damage popups, hitmarker + damage
// direction, killfeed with [HS] tags and weapon names.
// Tactics: bomb plant 3 s / defuse 5 s, 35 s timer (bomb.js), economy +
// 9-item buy menu (economy.js, B), frag + smoke + flashbang grenades
// (grenades.js), a team plan with roles and radio callouts (bots.js
// announcePlan, hud.js radioAdd), a hearing bus for shots, blasts and
// footsteps (hearing.js), bots with waypoint BFS, LOS/view-cone, burst
// fire, strafing, cover, and a retake in pairs — one defuses, one covers
// (bots.js, main.js coverBot).
// Map/look: original Dustline Yard at dusk — purple-orange gradient sky
// dome, low sun, warm lamps vs cool shadows, big site signs (A WAREHOUSE,
// B FREIGHT YARD), painted ground letters, colour-coded lanes, lit
// warehouse windows (map.js, palette.js). Soldiers are modelled low-poly
// (models.js): helmeted heads, vests, held rifles, team trim — Vanguard
// teal with backpacks, Raiders rust with chest rigs and wide brims.
// Code: one job per module, fixed 60 Hz sim in step() apart from the
// render loop in frame(), pooled tracers/impacts/popups (no per-frame
// allocation in hot loops), one state object. Capture: ?shot=start|play|
// buy|end&seed=N renders twice, freezes, sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, pick } from './rng.js';
import { createWorld, MAP } from './map.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPON_DEFS } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createHearing } from './hearing.js';
import { createBots } from './bots.js';
import { createBomb } from './bomb.js';
import { createEconomy, SHOP } from './economy.js';
import { createRounds, MATCH_WINS } from './rounds.js';
import { createHud } from './hud.js';
import { hasLineOfSight } from './collision.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 34, 80);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const hud = createHud();
const economy = createEconomy();
const rounds = createRounds();
const player = createPlayer(world.colliders, world.spawns.attack[0]);
const weapon = createWeapon(camera);
const grenades = createGrenades(scene, world.colliders, world.shootMeshes);
const hearing = createHearing(); // the hearing bus: shots, blasts, steps
const bomb = createBomb(scene, world.sites);
const bots = createBots(scene, world);
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

// Player tracer pool: thin additive cylinders from the muzzle to the hit
// point, fading in 60 ms. Cylinders, not THREE.Line — a 1 px line is
// invisible at 1280 px, a glowing beam reads like the top covers' tracers.
const tracerGeo = new THREE.CylinderGeometry(0.016, 0.016, 1, 6);
const playerTracers = [];
for (let i = 0; i < 6; i += 1) {
  const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff3c4), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  mesh.visible = false;
  mesh.frustumCulled = false;
  scene.add(mesh);
  playerTracers.push({ mesh, left: 0 });
}
let playerTracerIdx = 0;
const tracerUp = new THREE.Vector3(0, 1, 0);
const tracerMid = new THREE.Vector3();
const tracerDir = new THREE.Vector3();

function spawnPlayerTracer(from, to) {
  const t = playerTracers[playerTracerIdx];
  playerTracerIdx = (playerTracerIdx + 1) % playerTracers.length;
  tracerDir.subVectors(to, from);
  const len = tracerDir.length() || 1;
  tracerMid.addVectors(from, to).multiplyScalar(0.5);
  t.mesh.position.copy(tracerMid);
  t.mesh.quaternion.setFromUnitVectors(tracerUp, tracerDir.normalize());
  t.mesh.scale.set(1, len, 1);
  t.mesh.material.opacity = 1;
  t.mesh.visible = true;
  t.left = 0.06;
}

// Impact pool: 10 small glowing puffs, reused. A wall hit throws sand-coloured
// dust, a body hit throws a teal puff — the shooter sees where the round went.
const impactGeo = new THREE.SphereGeometry(0.07, 8, 6);
const impacts = [];
for (let i = 0; i < 10; i += 1) {
  const mesh = new THREE.Mesh(impactGeo, new THREE.MeshBasicMaterial({ color: 0xc9a86a, transparent: true, opacity: 0 }));
  mesh.visible = false;
  scene.add(mesh);
  impacts.push({ mesh, left: 0 });
}
let impactIdx = 0;

function spawnImpact(point, colorHex, size) {
  const it = impacts[impactIdx];
  impactIdx = (impactIdx + 1) % impacts.length;
  it.mesh.position.copy(point);
  it.mesh.material.color.set(colorHex);
  it.mesh.scale.setScalar(size / 0.07);
  it.mesh.material.opacity = 0.95;
  it.mesh.visible = true;
  it.left = 0.22;
}

const state = {
  started: false,
  frozen: false,
  elapsed: 0,
  lastSeenEnemy: new Map(), // bot id -> time last seen by the player
  spectateBot: null,
  grenadeCooldown: 0,
  fireHeld: false,
  plantHeld: false,
  attackSite: 'A',
  buyOpen: false,
  accumulator: 0,
  lastTime: performance.now(),
  lastStep: 0, // last footstep posted to the hearing bus
  bannerSeq: 0, // guards the round-start banner auto-hide: a later banner bumps this so the stale timer cannot hide it
};

function setWeapon(id) {
  const eco = economy.state;
  if (!eco.owned[id]) return false;
  eco.owned[weapon.def.id] = weapon.ammo();
  eco.currentWeapon = id;
  weapon.equip(WEAPON_DEFS[id], eco.owned[id]);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
  hud.setLoadout(eco.owned, eco.currentWeapon, eco.grenades, eco.money);
  return true;
}

function currentGrenadeCount(kind) {
  return economy.state.grenades[kind] || 0;
}

function throwGrenade(kind) {
  if (state.grenadeCooldown > 0 || currentGrenadeCount(kind) <= 0) return;
  if (!player.state.alive || rounds.state.phase !== 'live') return;
  economy.state.grenades[kind] -= 1;
  state.grenadeCooldown = 0.8;
  hud.setLoadout(economy.state.owned, economy.state.currentWeapon, economy.state.grenades, economy.state.money);
  player.eyePosition(eyePos);
  camera.getWorldDirection(direction);
  grenades.throwGrenade(kind, eyePos, direction);
  audio.shot('smg');
}

function addNoise(pos, kind = 'shot') {
  hearing.post(pos, kind, state.elapsed);
}

function killfeedFor(killerName, victimName, head, killerIsPlayer, weaponName) {
  const tag = head ? '[HS] ' : '✕ ';
  const text = killerIsPlayer && weaponName
    ? `You ${weaponName} ${tag}${victimName}`
    : `${killerName} ${tag}${victimName}`;
  hud.killfeedAdd(text, killerIsPlayer);
}

// --- Player shooting -------------------------------------------------------
function shoot(spread) {
  if (!weapon.takeRound()) {
    audio.dry();
    weapon.reload();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  player.eyePosition(eyePos);
  scene.updateMatrixWorld(true);
  raycaster.set(eyePos, direction);
  const botMeshes = [];
  for (const b of bots.defenders) if (b.alive) botMeshes.push(...b.hitMeshes);
  for (const b of bots.attackers) if (b.alive) botMeshes.push(...b.hitMeshes);
  const hits = raycaster.intersectObjects(world.shootMeshes.concat(botMeshes), false);
  const hit = hits[0];
  const endPoint = hit ? hit.point.clone() : eyePos.clone().addScaledVector(direction, 60);
  // Beam starts at the muzzle (right-down of the eye), so it reads as a
  // diagonal line across the frame instead of a dot hidden behind the flash.
  tmpVec2.crossVectors(direction, camera.up).normalize();
  spawnPlayerTracer(eyePos.clone().addScaledVector(direction, 0.9).addScaledVector(tmpVec2, 0.22).addScaledVector(camera.up, -0.18), endPoint);
  if (hit) {
    if (hit.object.userData.bot) spawnImpact(hit.point, 0x2fb3a3, 0.1);
    else spawnImpact(hit.point, 0xc9a86a, 0.08);
  }
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const part = hit.object.userData.part || 'body';
    const dmg = part === 'head' ? weapon.def.headDamage
      : part === 'limb' ? Math.round(weapon.def.bodyDamage * 0.7)
        : weapon.def.bodyDamage;
    bots.damageBot(bot, dmg, part, null, botCtx);
    hud.hitMarker(bot.health <= 0);
    hud.showDamagePopup(hit.point.x, hit.point.y, hit.point.z, part === 'head' ? `HEAD ${dmg}` : `${dmg}`, part === 'head');
    if (bot.health <= 0) {
      economy.awardKill();
      killfeedFor('You', bot.name, part === 'head', true, weapon.def.short);
      audio.kill();
    } else {
      audio.hit();
    }
  }
  weapon.pullTrigger();
  player.recoil(0.009 * (weapon.def.kick / 0.05) + random() * 0.004, (random() * 2 - 1) * 0.004);
  audio.shot(weapon.def.sound);
  addNoise(player.state.position);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
  return true;
}

// --- Bot callbacks ---------------------------------------------------------
const botCtx = {
  get player() {
    return player;
  },
  get time() {
    return state.elapsed;
  },
  get hearing() {
    return hearing;
  },
  get smokeClouds() {
    return grenades.clouds;
  },
  get bombPlanted() {
    return bomb.planted;
  },
  get bombSite() {
    return bomb.state.site ? bomb.state.site.id : null;
  },
  get bombPos() {
    return bomb.state.position;
  },
  get attackSiteNode() {
    return state.attackSite === 'A' ? 'siteA' : 'siteB';
  },
  get defuseBot() {
    if (!bomb.planted) return null;
    let best = null;
    let bestD = Infinity;
    for (const b of bots.defenders) {
      if (!b.alive) continue;
      const d = b.pos.distanceToSquared(bomb.state.position);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  },
  // Retake pair: the nearest other living defender covers the defuser.
  get coverBot() {
    if (!bomb.planted) return null;
    const defuser = botCtx.defuseBot;
    let best = null;
    let bestD = Infinity;
    for (const b of bots.defenders) {
      if (!b.alive || b === defuser) continue;
      const d = b.pos.distanceToSquared(bomb.state.position);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  },
  onCallout(text, team) {
    hud.radioAdd(text, team);
  },
  onPlayerHit(dmg, part, fromBot) {
    if (!player.state.alive) return;
    const dealt = player.damage(dmg);
    hud.flashDamage();
    // Damage direction: signed angle from the player's facing to the shooter.
    if (fromBot && fromBot.pos) {
      const dx = fromBot.pos.x - player.state.position.x;
      const dz = fromBot.pos.z - player.state.position.z;
      const fx = -Math.sin(player.state.yaw);
      const fz = -Math.cos(player.state.yaw);
      const dot = fx * dx + fz * dz;
      const cross = fx * dz - fz * dx;
      hud.damageFrom(Math.atan2(cross, dot) * 180 / Math.PI);
    }
    audio.hurt();
    hud.setHealth(player.state.health, player.state.armor);
    if (!player.state.alive) {
      killfeedFor(fromBot.name, 'You', part === 'head', false);
      startSpectate();
    }
  },
  onBotKilled(bot, from) {
    if (from) {
      killfeedFor(from.name, bot.name, false, false);
    }
    checkRoundEnd();
  },
  onBotShot(bot) {
    addNoise(bot.pos);
    const d = bot.pos.distanceTo(player.state.position);
    if (d < 34) audio.shot('enemy');
  },
};

function startSpectate() {
  const alive = bots.attackers.filter((b) => b.alive);
  state.spectateBot = alive.length ? alive[Math.floor(random() * alive.length)] : null;
  hud.showBanner('YOU ARE DOWN', 'Your team fights on — spectating a teammate.', false);
  setTimeout(() => hud.hideBanner(), 2600);
}

function checkRoundEnd() {
  const r = rounds.state;
  if (r.phase !== 'live') return;
  if (bomb.state.exploded) return;
  if (bots.aliveCount('defend') === 0) {
    endRound('attack', 'Raiders eliminated');
  } else if (bots.aliveCount('attack') === 0 && !bomb.planted) {
    endRound('defend', 'Vanguard eliminated');
  }
}

function endRound(winner, reason) {
  if (!rounds.endRound(winner, reason)) return;
  const won = winner === 'attack';
  economy.awardRound(won);
  hud.setMoney(economy.state.money);
  hud.showBanner(
    won ? 'ROUND WON' : 'ROUND LOST',
    `${reason} — Vanguard ${rounds.state.scoreAttack} · ${rounds.state.scoreDefend} Raiders`,
    won,
  );
  state.bannerSeq += 1; // invalidate the round-start banner's auto-hide timer
  if (won) audio.roundWin();
  else audio.roundLose();
  if (document.pointerLockElement) document.exitPointerLock();
}

function startRound(round) {
  state.attackSite = random() < 0.5 ? 'A' : 'B';
  state.spectateBot = null;
  state.lastSeenEnemy.clear();
  economy.nextRound();
  bomb.reset();
  grenades.reset();
  bots.spawnRound(state.attackSite, random);
  bots.announcePlan(state.attackSite, botCtx); // radio: the team plan
  player.reset(world.spawns.attack[0], 0);
  weapon.equip(WEAPON_DEFS[economy.state.currentWeapon], economy.state.owned[economy.state.currentWeapon]);
  rounds.startRound(round, state.attackSite);
  hud.hideBanner();
  hud.hideBomb();
  hud.hidePlant();
  hud.hideBuy();
  state.buyOpen = false;
  hud.setHealth(100, economy.state.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
  hud.setMoney(economy.state.money);
  hud.setPlan(`PLAN: PUSH SITE ${state.attackSite} — YOU: ENTRY`);
  hud.setLoadout(economy.state.owned, economy.state.currentWeapon, economy.state.grenades, economy.state.money);
  hud.setScore(rounds.state.scoreAttack, rounds.state.scoreDefend, round);
  hud.setAlive(bots.aliveCount('attack'), bots.aliveCount('defend'));
  hud.setTimer(rounds.state.timeLeft, 'buy');
  hud.showBanner(`ROUND ${round} — PUSH SITE ${state.attackSite}`, 'Buy phase: press B for the shop, then take the site.', true);
  const bannerSeq = ++state.bannerSeq;
  setTimeout(() => { if (state.bannerSeq === bannerSeq) hud.hideBanner(); }, 3200);
}

function resetMatch() {
  rounds.state.scoreAttack = 0;
  rounds.state.scoreDefend = 0;
  rounds.state.matchWinner = null;
  economy.state.money = 800;
  economy.state.owned = { pistol: { mag: 12, reserve: 36 } };
  economy.state.currentWeapon = 'pistol';
  economy.state.grenades = { frag: 0, smoke: 0, flash: 0 };
  economy.state.armor = 0;
  economy.state.lossStreak = 0;
  startRound(1);
}

function syncCamera() {
  if (!player.state.alive && state.spectateBot) {
    const b = state.spectateBot;
    camera.position.set(b.pos.x, b.pos.y + 1.58, b.pos.z);
    camera.rotation.set(0, b.yaw, 0, 'YXZ');
    return;
  }
  camera.position.set(player.state.position.x, player.state.position.y + player.state.eye, player.state.position.z);
  camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    state.started = true;
    audio.unlock();
    hud.hideOverlay();
    hud.hideBuy();
    state.buyOpen = false;
  } else if (rounds.state.phase !== 'match') {
    if (!state.buyOpen) hud.showOverlay(state.started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (rounds.state.phase === 'match') {
    resetMatch();
  }
  input.requestLock();
});

function buyItem(id) {
  const res = economy.buy(id);
  if (res.ok) {
    audio.buy();
    if (SHOP.find((s) => s.id === id).kind === 'weapon') {
      setWeapon(id);
    }
    if (id === 'kevlar' || id === 'heavy') {
      player.state.armor = economy.state.armor;
      hud.setHealth(player.state.health, economy.state.armor);
    }
    if (id === 'medkit') {
      player.state.health = 100;
      hud.setHealth(100, player.state.armor);
    }
    hud.setMoney(economy.state.money);
    hud.setLoadout(economy.state.owned, economy.state.currentWeapon, economy.state.grenades, economy.state.money);
    hud.showBuy(SHOP, economy.state.money, economy.state.owned, economy.state.grenades);
  } else {
    audio.denied();
  }
}

hud.setOnBuy((id) => buyItem(id));

function openBuy() {
  if (rounds.state.phase !== 'buy') return;
  state.buyOpen = true;
  if (document.pointerLockElement) document.exitPointerLock();
  hud.showBuy(SHOP, economy.state.money, economy.state.owned, economy.state.grenades);
}

function closeBuy() {
  state.buyOpen = false;
  hud.hideBuy();
  input.requestLock();
}

function step(dt) {
  state.elapsed += dt;
  const r = rounds.state;
  const keys = input.state.keys;
  const pressed = input.takePressed();

  if (pressed.has('KeyB')) {
    if (state.buyOpen) closeBuy();
    else openBuy();
  }
  if (state.buyOpen) {
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'].findIndex((k) => pressed.has(k));
    if (idx >= 0 && idx < SHOP.length) buyItem(SHOP[idx].id);
    if (pressed.has('Escape')) closeBuy();
  }

  // Round clock.
  const clock = rounds.step(dt);
  if (clock === 'live') {
    hud.showBanner('GO — TAKE THE SITE', `Push site ${state.attackSite}. Plant the bomb or clear the Raiders.`, true);
    setTimeout(() => hud.hideBanner(), 2200);
  } else if (clock === 'end') {
    const next = rounds.finishEnd();
    if (next === 'match') {
      const winner = rounds.state.matchWinner;
      hud.showOverlay('match', winner === 'attack'
        ? `Vanguard takes the match ${rounds.state.scoreAttack}–${rounds.state.scoreDefend}. Dustline Yard is yours.`
        : `Raiders take the match ${rounds.state.scoreDefend}–${rounds.state.scoreAttack}. Regroup and run it back.`);
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      startRound(rounds.state.round);
    }
  }

  // Live-phase round end by the clock (no plant yet).
  if (r.phase === 'live' && r.timeLeft <= 0 && !bomb.planted) {
    endRound('defend', 'Time expired — bomb never planted');
  }

  // Movement and combat only while the round is live (or buy, for movement).
  if (r.phase === 'buy' || r.phase === 'live') {
    player.step(dt, keys);
    weapon.step(dt);
    state.grenadeCooldown = Math.max(0, state.grenadeCooldown - dt);

    if (r.phase === 'live' && player.state.alive && !state.buyOpen) {
      if (input.state.firing && weapon.def.auto && weapon.ready()) {
        shoot(weapon.spread(player.groundSpeed()));
      } else if (input.state.firing && !weapon.def.auto && weapon.ready() && !state.fireHeld) {
        shoot(weapon.spread(player.groundSpeed()));
      }
      state.fireHeld = input.state.firing;
      if (keys.has('KeyR')) {
        if (weapon.reload()) audio.reload();
      }
      // Weapon slots.
      if (pressed.has('Digit1')) setWeapon('pistol');
      if (pressed.has('Digit2')) setWeapon('rifle');
      if (pressed.has('Digit3')) setWeapon('smg');
      if (pressed.has('Digit4')) setWeapon('sniper');
      // Grenades.
      if (pressed.has('KeyG')) throwGrenade('frag');
      if (pressed.has('KeyT')) throwGrenade('smoke');
      if (pressed.has('KeyF')) throwGrenade('flash');

      // Plant: hold E inside a site while carrying the bomb.
      const site = bomb.siteAt(player.state.position);
      const planting = keys.has('KeyE') && site && bomb.state.carried;
      if (planting) hud.showPlant(`Planting at site ${site.id}…`, bomb.state.plantProgress / 3);
      else hud.hidePlant();
      const bombEvent = bomb.step(dt, planting, null);
      if (bombEvent === 'planted') {
        bomb.plantAt(site, player.state.position);
        economy.awardPlant();
        hud.setMoney(economy.state.money);
        audio.plant();
        hud.killfeedAdd(`You planted the bomb at site ${site.id}`, true);
        hud.radioAdd(`VANGUARD-1: Bomb planted at site ${site.id} — hold the site!`, 'attack');
      }
    }

    // Grenades and bomb tick in both phases.
    grenades.step(dt, (pos) => {
      const targets = [];
      if (player.state.alive) targets.push({ position: player.state.position, ref: 'player' });
      for (const b of bots.bots) if (b.alive) targets.push({ position: b.pos, ref: b });
      const hits = grenades.explodeFrag(pos, targets, (a, b2) => !hasLineOfSight(a, b2, world.shootMeshes, []));
      for (const hit of hits) {
        const dmg = hit.damage;
        if (hit.target.ref === 'player') {
          botCtx.onPlayerHit(dmg, 'body', { name: 'Frag' });
        } else {
          bots.damageBot(hit.target.ref, dmg, 'body', null, botCtx);
        }
      }
      audio.boom();
      addNoise(pos, 'boom');
    }, (pos) => {
      // Flashbang burst: bots with line of sight are blinded, and the player
      // whites out if they were looking at it.
      bots.blindBots(pos);
      audio.flash();
      addNoise(pos);
      if (player.state.alive) {
        player.eyePosition(eyePos);
        const d = eyePos.distanceTo(pos);
        if (d < 22 && hasLineOfSight(eyePos, pos, world.shootMeshes, [])) {
          hud.flashWhite(Math.max(0.4, 1 - d / 26));
        }
      }
    });
    if (bomb.planted) {
      // Defuse channel: the designated defender must stand by the bomb.
      const defuser = botCtx.defuseBot;
      const defusing = defuser && defuser.defusing;
      const ev = bomb.step(dt, false, defusing);
      if (ev === 'defused') {
        endRound('defend', 'Bomb defused');
      } else if (ev === 'exploded') {
        endRound('attack', 'Bomb detonated');
      }
      hud.showBomb(bomb.timer);
      // Defuse progress bar, so the retake reads on screen, not just in code.
      if (defusing) hud.showPlant('A Raider is defusing the bomb…', bomb.state.defuseProgress / 5);
      else hud.hidePlant();
    } else {
      hud.hideBomb();
    }

    // Bots fight only in the live phase.
    if (r.phase === 'live') {
      bots.step(dt, botCtx);
    }
  }

  // Prune old hearing events.
  hearing.prune(state.elapsed);

  // Footsteps: the player's own steps post quiet noise to the hearing bus,
  // so a close defender can hear the push coming.
  if (player.state.alive && player.state.onGround && player.groundSpeed() > 1
    && state.elapsed - state.lastStep > 0.45) {
    state.lastStep = state.elapsed;
    hearing.post(player.state.position, 'step', state.elapsed);
  }

  // HUD: timer, alive counts, crosshair spread, minimap.
  hud.setTimer(r.phase === 'live' && bomb.planted ? bomb.timer : r.timeLeft, r.phase);
  hud.setAlive(bots.aliveCount('attack'), bots.aliveCount('defend'));
  hud.setScore(r.scoreAttack, r.scoreDefend, r.round);
  hud.setSpread(4 + weapon.spread(player.groundSpeed()) * 900);
  if (player.state.alive) {
    hud.setHealth(player.state.health, player.state.armor);
  }

  // Track which enemies the player has recently seen, for the minimap.
  if (Math.floor(state.elapsed * 4) !== Math.floor((state.elapsed - dt) * 4)) {
    player.eyePosition(eyePos);
    for (const b of bots.defenders) {
      if (!b.alive) continue;
      tmpVec.copy(b.pos);
      tmpVec.y += 1.2;
      if (eyePos.distanceTo(tmpVec) < 46 && hasLineOfSight(eyePos, tmpVec, world.shootMeshes, grenades.clouds)) {
        state.lastSeenEnemy.set(b.id, state.elapsed);
      }
    }
  }
  const enemies = bots.defenders.map((b) => ({
    pos: b.pos,
    alive: b.alive,
    seenRecently: state.elapsed - (state.lastSeenEnemy.get(b.id) || -99) < 3,
  }));
  hud.drawMinimap({ ...MAP, colliders: world.colliders }, player.state.position, player.state.yaw, bots.attackers, enemies, world.sites, bomb.state.planted ? bomb.state : null);

  // Tracers and impact puffs fade.
  for (const t of playerTracers) {
    if (t.left > 0) {
      t.left -= dt;
      t.mesh.material.opacity = Math.max(0, t.left / 0.06);
      if (t.left <= 0) t.mesh.visible = false;
    }
  }
  for (const it of impacts) {
    if (it.left > 0) {
      it.left -= dt;
      it.mesh.material.opacity = Math.max(0, it.left / 0.22) * 0.95;
      it.mesh.scale.multiplyScalar(1 + dt * 2);
      if (it.left <= 0) it.mesh.visible = false;
    }
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - state.lastTime) / 1000, 0.1);
  state.lastTime = now;
  if (!state.frozen) {
    const look = input.takeLook();
    if (player.state.alive) player.look(look.x, look.y);
    state.accumulator += dt;
    let steps = 0;
    while (state.accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      state.accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (state.accumulator > FIXED_STEP * 5) state.accumulator = 0;
    syncCamera();
  }
  renderer.render(scene, camera);
  hud.updatePopups(camera, dt);
}

function settle(steps) {
  for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    renderer.render(scene, camera);
    hud.updatePopups(camera, 0);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      state.frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  state.buyOpen = false;
  if (name === 'start') {
    startRound(1);
    player.state.position.set(0, 0, 13.5);
    player.state.yaw = 0;
    player.state.pitch = 0.04;
    settle(20);
    hud.showOverlay('start');
    paintTwiceThenReady();
    return;
  }
  if (name === 'play') {
    startRound(1);
    rounds.startLive();
    // Cover duel, staged in the open west lane in front of site A: the
    // player ~5.4 m from a Raider in the open, the "A — WAREHOUSE" sign and
    // painted ground A behind him, no door posts, no near wall for the
    // muzzle flash to light up as a flat slab. Rook stands against the
    // lit low window on the north wall, so his legs read against warm
    // light instead of merging into the dark site-A crate. Force site A
    // so the plan bar matches the frame.
    state.attackSite = 'A';
    hud.setPlan('PLAN: PUSH SITE A — YOU: ENTRY');
    player.state.position.set(-10.5, 0, -3.5);
    player.state.yaw = 0;
    player.state.pitch = 0;
    const defender = bots.defenders[0];
    defender.pos.set(-12.8, 0, -8.4);
    // Second Raider out of the sign's way, at the west edge of the frame.
    bots.defenders[1].pos.set(-19, 0, -7.5);
    // Short settle only: enough for one minimap draw, too short for any
    // bot to finish reacting and shoot (react >= 0.35 s), so no damage
    // flash or strafe can spoil the frozen frame.
    settle(6);
    // Re-square both Raiders at the player: hold-state scanning drifts
    // their yaw, and an engage would have strafed them off their marks.
    for (const b of [defender, bots.defenders[1]]) {
      b.yaw = Math.atan2(-(player.state.position.x - b.pos.x), -(player.state.position.z - b.pos.z));
      b.group.rotation.y = b.yaw;
      b.vel.set(0, 0, 0);
      b.state = 'hold';
      b.target = null;
    }
    player.state.health = 100;
    hud.setHealth(100, 0);
    // Aim at the head and fire ONE shot: the pistol headshot (100 dmg)
    // kills, so the killfeed gets its [HS] line and the popup reads
    // "HEAD 100" above the helmet. Freeze immediately after — a dead bot
    // falls over in bots.step, so no settle after the kill.
    tmpVec.copy(defender.pos);
    tmpVec.y += 1.58;
    const dx = tmpVec.x - player.state.position.x;
    const dy = tmpVec.y - (player.state.position.y + player.state.eye);
    const dz = tmpVec.z - player.state.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    player.state.yaw = Math.atan2(-dx, -dz);
    player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    syncCamera();
    shoot(0);
    hud.setAlive(bots.aliveCount('attack'), bots.aliveCount('defend')); // ▼ 4, not stale 5
    // Freeze the fight in frame: re-light the muzzle flash (weapon.step(0)
    // sets it visible without advancing the sim) and bloom a soft smoke
    // cloud right of the duel, so tracer, flash, smoke and damage popup
    // all show.
    weapon.step(0);
    grenades.spawnCloudAt(new THREE.Vector3(-10.5, 0, -12));
    hud.hideBanner(); // the round-start banner is wall-clock timed; hide it
    // deterministically so the cover frame shows the duel, not the banner.
    paintTwiceThenReady();
    return;
  }
  if (name === 'buy') {
    startRound(1);
    economy.state.money = 5200;
    hud.setMoney(5200);
    openBuy();
    player.state.position.set(0, 0, 13);
    player.state.yaw = 0;
    settle(10);
    paintTwiceThenReady();
    return;
  }
  // end: round won, bomb site in view.
  startRound(1);
  rounds.startLive();
  bomb.plantAt(world.sites.A, new THREE.Vector3(-17, 0, -11));
  endRound('attack', 'Bomb detonated');
  player.state.position.set(-12, 0, -4);
  player.state.yaw = 0.7;
  player.state.pitch = 0.05;
  settle(20);
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// Boot: round 1 is set up, the start overlay waits for the click.
startRound(1);
syncCamera();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
