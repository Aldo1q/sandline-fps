// SANDLINE boot and the one loop: a fixed 60 Hz simulation feeding a render at
// the display's rate. This file owns the game state — the round, the shooting,
// the plant and the money — and wires the modules together. ?shot=start|play|
// buy|end with &seed=N sets up a deterministic frame for a capture, renders it
// twice, then freezes it and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { mulberry32, pick } from './rng.js';
import { createWorld, MAP } from './map.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPON_DEFS } from './weapons.js';
import { createGrenades } from './grenades.js';
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
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 30, 72);
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
const bomb = createBomb(scene, world.sites);
const bots = createBots(scene, world);
const input = createInput(renderer.domElement, onLockChange);

const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const tmpVec = new THREE.Vector3();
const tmpVec2 = new THREE.Vector3();

// Player tracer pool (muzzle to hit point, fades in 60 ms).
const playerTracers = [];
for (let i = 0; i < 6; i += 1) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffe1a0), transparent: true, opacity: 0 }));
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  playerTracers.push({ line, left: 0 });
}
let playerTracerIdx = 0;

function spawnPlayerTracer(from, to) {
  const t = playerTracers[playerTracerIdx];
  playerTracerIdx = (playerTracerIdx + 1) % playerTracers.length;
  t.line.geometry.setFromPoints([from, to]);
  t.line.material.opacity = 0.9;
  t.line.visible = true;
  t.left = 0.06;
}

const state = {
  started: false,
  frozen: false,
  elapsed: 0,
  noises: [],
  lastSeenEnemy: new Map(), // bot id -> time last seen by the player
  spectateBot: null,
  grenadeCooldown: 0,
  fireHeld: false,
  plantHeld: false,
  attackSite: 'A',
  buyOpen: false,
  accumulator: 0,
  lastTime: performance.now(),
  bannerSeq: 0, // guards the round-start banner auto-hide: a later banner bumps this so the stale timer cannot hide it
};

function setWeapon(id) {
  const eco = economy.state;
  if (!eco.owned[id]) return false;
  eco.owned[weapon.def.id] = weapon.ammo();
  eco.currentWeapon = id;
  weapon.equip(WEAPON_DEFS[id], eco.owned[id]);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def.name);
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
  player.eyePosition(eyePos);
  camera.getWorldDirection(direction);
  grenades.throwGrenade(kind, eyePos, direction);
  audio.shot('smg');
}

function addNoise(pos) {
  state.noises.push({ pos: pos.clone(), time: state.elapsed });
  if (state.noises.length > 12) state.noises.shift();
}

function killfeedFor(killerName, victimName, head, killerIsPlayer) {
  const text = `${killerName} ${head ? '⌖' : '✕'} ${victimName}`;
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
  spawnPlayerTracer(eyePos.clone().addScaledVector(direction, 0.4), endPoint);
  if (hit && hit.object.userData.bot) {
    const bot = hit.object.userData.bot;
    const part = hit.object.userData.part || 'body';
    const dmg = part === 'head' ? weapon.def.headDamage : weapon.def.bodyDamage;
    bots.damageBot(bot, dmg, part, null, botCtx);
    hud.hitMarker(bot.health <= 0);
    if (bot.health <= 0) {
      economy.awardKill();
      killfeedFor('You', bot.name, part === 'head', true);
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
  get noises() {
    return state.noises;
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
  onPlayerHit(dmg, part, fromBot) {
    if (!player.state.alive) return;
    const dealt = player.damage(dmg);
    hud.flashDamage();
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
  state.noises.length = 0;
  state.lastSeenEnemy.clear();
  economy.nextRound();
  bomb.reset();
  grenades.reset();
  bots.spawnRound(state.attackSite, random);
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
  economy.state.grenades = { frag: 0, smoke: 0 };
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
    if (id === 'kevlar') {
      player.state.armor = 100;
      hud.setHealth(player.state.health, 100);
    }
    hud.setMoney(economy.state.money);
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
    const idx = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'].findIndex((k) => pressed.has(k));
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
        killfeedFor('You', `planted the bomb at site ${site.id}`, false, true);
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
      addNoise(pos);
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
    } else {
      hud.hideBomb();
    }

    // Bots fight only in the live phase.
    if (r.phase === 'live') {
      bots.step(dt, botCtx);
    }
  }

  // Prune old noises.
  while (state.noises.length && state.elapsed - state.noises[0].time > 2) state.noises.shift();

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

  // Tracers fade.
  for (const t of playerTracers) {
    if (t.left > 0) {
      t.left -= dt;
      t.line.material.opacity = Math.max(0, t.left / 0.06) * 0.9;
      if (t.left <= 0) t.line.visible = false;
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
    // Stage a duel: player at mid doors, a defender holding the gap in view.
    player.state.position.set(-2, 0, 6);
    player.state.yaw = 0.5;
    player.state.pitch = 0;
    const defender = bots.defenders[0];
    defender.pos.set(-2, 0, -3);
    defender.yaw = Math.PI;
    defender.group.rotation.y = Math.PI;
    settle(30);
    // Fire twice at the defender; the second shot lands.
    tmpVec.copy(defender.pos);
    tmpVec.y += 1.2;
    const dx = tmpVec.x - player.state.position.x;
    const dy = tmpVec.y - (player.state.position.y + player.state.eye);
    const dz = tmpVec.z - player.state.position.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    player.state.yaw = Math.atan2(-dx, -dz);
    player.state.pitch = Math.asin(Math.max(-1, Math.min(1, dy / len)));
    syncCamera();
    shoot(0);
    settle(6);
    shoot(0);
    settle(4);
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
