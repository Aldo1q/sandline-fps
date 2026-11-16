// Bots: nine of them, four Vanguard attackers with the player and five Raider
// defenders. Each bot is a small state machine — hold, move, engage, investigate,
// cover, retake, defuse — running on a waypoint graph. They see by line of
// sight and a view cone, hear gunfire, strafe and burst-fire when they fight,
// take cover when hurt, and call out contacts, sounds and the bomb on the radio
// (callout). After a plant the defenders retake the site in pairs while one
// defuses; a flashbang blinds them (blindLeft, blindBots). Their bodies are
// low-poly soldiers from models.js, with a walk cycle and an aim pose.
import * as THREE from 'three';
import { createSoldier } from './models.js';
import { moveAxis, hasLineOfSight, wallDistance } from './collision.js';
import { mulberry32, shuffle } from './rng.js';

const BOT_RADIUS = 0.34;
const BOT_HEIGHT = 1.72;
const BOT_EYE = 1.58;
const WALK_SPEED = 3.7;
const PUSH_SPEED = 4.3;
const REACT_MIN = 0.35;
const REACT_MAX = 0.62;
const SIGHT_RANGE = 46;
const BURST_MIN = 3;
const BURST_MAX = 5;
const BOT_DAMAGE = 13;
const BOT_HEAD_MULT = 2.4;

const NAMES_ATTACK = ['Vex', 'Hale', 'Mira', 'Odo'];
const NAMES_DEFEND = ['Rook', 'Sable', 'Fenn', 'Ivo', 'Kestrel'];

function bfsPath(waypoints, fromId, toId) {
  if (fromId === toId) return [toId];
  const prev = { [fromId]: null };
  const queue = [fromId];
  while (queue.length) {
    const cur = queue.shift();
    for (const next of waypoints[cur].links) {
      if (prev[next] !== undefined) continue;
      prev[next] = cur;
      if (next === toId) {
        const path = [toId];
        let node = cur;
        while (node) {
          path.unshift(node);
          node = prev[node];
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [toId];
}

function nearestNode(waypoints, x, z) {
  let best = null;
  let bestD = Infinity;
  for (const id of Object.keys(waypoints)) {
    const w = waypoints[id];
    const d = (w.x - x) * (w.x - x) + (w.z - z) * (w.z - z);
    if (d < bestD) {
      bestD = d;
      best = id;
    }
  }
  return best;
}

// Radio location names, so a callout says where the fight is.
function siteName(x, z) {
  if (Math.hypot(x + 17, z + 11) < 7) return 'site A';
  if (Math.hypot(x - 17, z + 11) < 7) return 'site B';
  if (Math.abs(x) < 7 && z > -5 && z < 5) return 'mid';
  if (x < -10) return 'west lane';
  if (x > 10) return 'east lane';
  if (z < -6) return 'north yard';
  return 'south yard';
}

export function createBots(scene, world) {
  const { waypoints, colliders, shootMeshes } = world;
  const random = mulberry32(20261115);
  const bots = [];
  const tracers = [];
  const tracerMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffd9a0), transparent: true, opacity: 0 });
  for (let i = 0; i < 12; i += 1) {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, tracerMat.clone());
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, left: 0 });
  }
  let tracerIdx = 0;

  function spawnTracer(from, to) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    t.line.geometry.setFromPoints([from, to]);
    t.line.material.opacity = 0.85;
    t.line.visible = true;
    t.left = 0.07;
  }

  // Radio callout, throttled per bot so the feed stays readable.
  function callout(bot, text, ctx) {
    if (!ctx.onCallout) return;
    if (ctx.time - (bot.lastCallout || -99) < 6) return;
    bot.lastCallout = ctx.time;
    ctx.onCallout(`${bot.callName}: ${text}`, bot.team);
  }

  function makeBot(team, name, spawn, yaw) {
    const parts = createSoldier(team);
    const group = parts.group;
    group.position.copy(spawn);
    group.rotation.y = yaw;
    scene.add(group);
    const bot = {
      id: name,
      team,
      name,
      callName: `${team === 'attack' ? 'VANGUARD' : 'RAIDER'}-${team === 'attack' ? NAMES_ATTACK.indexOf(name) + 1 : NAMES_DEFEND.indexOf(name) + 1}`,
      group,
      head: parts.head,
      torso: parts.torso,
      legL: parts.legL,
      legR: parts.legR,
      armL: parts.armL,
      armR: parts.armR,
      gun: parts.gun,
      pos: group.position,
      vel: new THREE.Vector3(),
      yaw,
      pitch: 0,
      health: 100,
      alive: true,
      state: 'hold',
      holdNode: null,
      path: [],
      pathIdx: 0,
      target: null, // { kind: 'player'|'bot', ref, lastSeen }
      reactLeft: 0,
      burstLeft: 0,
      shotTimer: 0,
      pauseLeft: 0,
      strafeDir: 1,
      strafeLeft: 0,
      scanPhase: random() * Math.PI * 2,
      thinkLeft: random() * 0.15,
      investigatePos: null,
      investigateLeft: 0,
      noiseHeard: 0,
      defusing: false,
      announcedDefuse: false,
      blindLeft: 0, // flashbang: cannot see or shoot while > 0
      role: null, // team plan role: entry | support | lurk | holdA | holdB | mid
      lastCallout: -99,
      fallT: 0,
      hitMeshes: [parts.head, parts.torso, ...parts.legMeshes],
    };
    parts.head.userData.bot = bot;
    parts.torso.userData.bot = bot;
    bots.push(bot);
    return bot;
  }

  // Ray vs a vertical capsule (feet..head) at `center` (feet position).
  // Returns { dist, part } or null.
  const tmpDir = new THREE.Vector3();
  const tmpTo = new THREE.Vector3();
  function capsuleHit(from, dir, center, height, radius) {
    tmpTo.set(center.x - from.x, 0, center.z - from.z);
    const along = tmpTo.dot(new THREE.Vector3(dir.x, 0, dir.z));
    if (along < 0) return null;
    const closestX = from.x + dir.x * along;
    const closestZ = from.z + dir.z * along;
    const radial = Math.hypot(closestX - center.x, closestZ - center.z);
    if (radial > radius) return null;
    // Height at that point along the ray.
    const yAt = from.y + dir.y * along;
    if (yAt < center.y || yAt > center.y + height) return null;
    // Named hitbox zones: head above 86% of height, limbs below 45%, torso
    // between — each with its own damage multiplier (shootAt).
    return { dist: along, part: yAt > center.y + height * 0.86 ? 'head' : yAt < center.y + height * 0.45 ? 'limb' : 'body' };
  }

  function shootAt(bot, target, ctx) {
    // Aim at the target's chest or head with error that grows with distance,
    // the target's speed and the bot's own movement.
    const eye = new THREE.Vector3(bot.pos.x, bot.pos.y + BOT_EYE, bot.pos.z);
    const tPos = new THREE.Vector3();
    let tHeight = BOT_HEIGHT;
    let tRadius = 0.42;
    let isPlayer = false;
    if (target.kind === 'player') {
      ctx.player.bodyPosition(tPos);
      tHeight = ctx.player.state.height;
      isPlayer = true;
    } else {
      tPos.copy(target.ref.pos);
      tPos.y += 1.0;
    }
    const dist = eye.distanceTo(tPos);
    const speed = target.kind === 'player' ? ctx.player.groundSpeed() : Math.hypot(target.ref.vel.x, target.ref.vel.z);
    const ownMove = Math.hypot(bot.vel.x, bot.vel.z);
    const err = 0.012 + dist * 0.0011 + speed * 0.006 + ownMove * 0.008;
    const aim = tPos.clone();
    // One in five shots goes for the head.
    if (random() < 0.2) aim.y += tHeight * 0.42;
    aim.x += (random() * 2 - 1) * err * dist;
    aim.y += (random() * 2 - 1) * err * dist * 0.7;
    aim.z += (random() * 2 - 1) * err * dist;
    tmpDir.subVectors(aim, eye).normalize();
    const wallD = wallDistance(eye, tmpDir, dist + 30, shootMeshes);
    const hit = capsuleHit(eye, tmpDir, isPlayer ? ctx.player.state.position : target.ref.pos, tHeight, tRadius);
    const end = eye.clone().addScaledVector(tmpDir, Math.min(wallD, hit ? hit.dist : dist + 30));
    spawnTracer(eye.clone().addScaledVector(tmpDir, 0.5), end);
    if (hit && hit.dist < wallD) {
      const mult = hit.part === 'head' ? BOT_HEAD_MULT : hit.part === 'limb' ? 0.7 : 1;
      const dmg = Math.round(BOT_DAMAGE * mult * Math.max(0.55, 1 - dist / 90));
      if (isPlayer) ctx.onPlayerHit(dmg, hit.part, bot);
      else damageBot(target.ref, dmg, hit.part, bot, ctx);
      return true;
    }
    return false;
  }

  function damageBot(bot, amount, part, from, ctx) {
    if (!bot.alive) return;
    bot.health -= amount;
    if (bot.health <= 0) {
      bot.health = 0;
      bot.alive = false;
      bot.state = 'dead';
      bot.fallT = 0;
      ctx.onBotKilled(bot, from);
    } else if (bot.health < 35 && bot.state !== 'engage') {
      bot.state = 'cover';
      bot.path = [];
    }
  }

  function visibleEnemy(bot, ctx) {
    if (bot.blindLeft > 0) return null; // flashbanged: sees nothing
    const eye = new THREE.Vector3(bot.pos.x, bot.pos.y + BOT_EYE, bot.pos.z);
    const candidates = [];
    const player = ctx.player;
    if (player.state.alive && bot.team === 'defend') {
      const pPos = new THREE.Vector3();
      player.bodyPosition(pPos);
      candidates.push({ kind: 'player', ref: player, pos: pPos, dist: eye.distanceTo(pPos) });
    }
    for (const other of bots) {
      if (other === bot || !other.alive || other.team === bot.team) continue;
      const oPos = other.pos.clone();
      oPos.y += 1.0;
      candidates.push({ kind: 'bot', ref: other, pos: oPos, dist: eye.distanceTo(oPos) });
    }
    candidates.sort((a, b) => a.dist - b.dist);
    for (const c of candidates) {
      if (c.dist > SIGHT_RANGE) continue;
      // View cone: within ~110 degrees of facing, or very close.
      const dx = c.pos.x - bot.pos.x;
      const dz = c.pos.z - bot.pos.z;
      const facing = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
      const toTarget = new THREE.Vector3(dx, 0, dz).normalize();
      if (c.dist > 3 && facing.dot(toTarget) < 0.15) continue;
      const headPos = c.pos.clone();
      headPos.y += 0.5;
      if (!hasLineOfSight(eye, headPos, shootMeshes, ctx.smokeClouds)) continue;
      return c;
    }
    return null;
  }

  function setPath(bot, targetNode) {
    const from = nearestNode(waypoints, bot.pos.x, bot.pos.z);
    bot.path = bfsPath(waypoints, from, targetNode);
    bot.pathIdx = 0;
  }

  function moveToward(bot, tx, tz, speed, dt) {
    const dx = tx - bot.pos.x;
    const dz = tz - bot.pos.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.05) return true;
    const vx = (dx / len) * speed;
    const vz = (dz / len) * speed;
    bot.vel.x += (vx - bot.vel.x) * Math.min(1, dt * 8);
    bot.vel.z += (vz - bot.vel.z) * Math.min(1, dt * 8);
    const targetYaw = Math.atan2(-dx, -dz);
    let dy = targetYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += dy * Math.min(1, dt * 8);
    moveAxis(colliders, bot.pos, bot.vel, dt, BOT_RADIUS, BOT_HEIGHT);
    bot.group.rotation.y = bot.yaw;
    return len < 0.5;
  }

  function faceTarget(bot, target, dt) {
    const dx = target.pos.x - bot.pos.x;
    const dz = target.pos.z - bot.pos.z;
    const targetYaw = Math.atan2(-dx, -dz);
    let dy = targetYaw - bot.yaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    bot.yaw += dy * Math.min(1, dt * 10);
    bot.group.rotation.y = bot.yaw;
  }

  function stepBot(bot, dt, ctx) {
    if (!bot.alive) {
      if (bot.fallT < 1) {
        bot.fallT = Math.min(1, bot.fallT + dt * 3);
        bot.group.rotation.z = (Math.PI / 2) * bot.fallT * (bot.team === 'attack' ? 1 : -1);
        bot.group.position.y = bot.pos.y - 0.35 * bot.fallT;
      }
      return;
    }
    bot.thinkLeft -= dt;
    const think = bot.thinkLeft <= 0;
    if (think) bot.thinkLeft = 0.15;
    bot.blindLeft = Math.max(0, bot.blindLeft - dt);

    // Perception.
    if (think) {
      const seen = visibleEnemy(bot, ctx);
      if (seen) {
        if (!bot.target || bot.target.ref !== seen.ref) {
          bot.target = { kind: seen.kind, ref: seen.ref, pos: seen.pos, lastSeen: ctx.time };
          bot.reactLeft = REACT_MIN + random() * (REACT_MAX - REACT_MIN);
          bot.burstLeft = 0;
          callout(bot, `Contact ${siteName(seen.pos.x, seen.pos.z)}!`, ctx);
        } else {
          bot.target.pos = seen.pos;
          bot.target.lastSeen = ctx.time;
        }
        if (bot.state !== 'engage' && bot.state !== 'defuse') bot.state = 'engage';
      } else if (bot.target && ctx.time - bot.target.lastSeen > 1.2) {
        bot.target = null;
        if (bot.state === 'engage') bot.state = bot.team === 'defend' ? 'hold' : 'move';
      }
      // Hearing bus: a recent sound nearby pulls an idle holder to look.
      // Shots and blasts carry 26–30 m, footsteps only 9 m.
      if (!bot.target && bot.state === 'hold' && ctx.hearing) {
        const heard = ctx.hearing.heardBy(bot.pos, ctx.time);
        if (heard) {
          bot.investigatePos = heard.pos.clone();
          bot.investigateLeft = 2.5;
          bot.state = 'investigate';
          const what = heard.kind === 'shot' ? 'shots' : heard.kind === 'boom' ? 'a blast' : 'steps';
          callout(bot, `Heard ${what} — checking ${siteName(heard.pos.x, heard.pos.z)}.`, ctx);
        }
      }
      // The bomb pulls defenders to defuse — one defuses, one covers the
      // defuser, the rest retake the site in pairs and clear it first.
      if (ctx.bombPlanted && bot.team === 'defend' && bot.state !== 'engage' && !bot.defusing) {
        if (ctx.defuseBot === bot) {
          if (bot.state !== 'defuse') {
            bot.state = 'defuse';
            setPath(bot, 'site' + (ctx.bombSite || 'B'));
          }
        } else if (ctx.coverBot === bot) {
          if (bot.state !== 'retake') {
            bot.state = 'retake';
            setPath(bot, 'site' + (ctx.bombSite || 'B'));
            callout(bot, `Covering the defuse at site ${ctx.bombSite || 'B'}!`, ctx);
          }
        } else if (bot.state !== 'retake') {
          bot.state = 'retake';
          setPath(bot, 'site' + (ctx.bombSite || 'B'));
          callout(bot, `Bomb planted — retaking site ${ctx.bombSite || 'B'}!`, ctx);
        }
      }
    }

    switch (bot.state) {
      case 'hold': {
        bot.vel.x *= Math.max(0, 1 - dt * 8);
        bot.vel.z *= Math.max(0, 1 - dt * 8);
        bot.scanPhase += dt * 0.5;
        bot.yaw += Math.sin(bot.scanPhase) * dt * 0.35;
        bot.group.rotation.y = bot.yaw;
        break;
      }
      case 'investigate': {
        if (bot.investigatePos) {
          const arrived = moveToward(bot, bot.investigatePos.x, bot.investigatePos.z, WALK_SPEED, dt);
          bot.investigateLeft -= dt;
          if (arrived || bot.investigateLeft <= 0) {
            bot.investigateLeft -= dt;
            bot.scanPhase += dt * 1.2;
            bot.yaw += Math.sin(bot.scanPhase) * dt * 0.8;
            bot.group.rotation.y = bot.yaw;
            if (bot.investigateLeft <= -1.5) {
              bot.state = 'hold';
              bot.investigatePos = null;
            }
          }
        } else bot.state = 'hold';
        break;
      }
      case 'move': {
        if (!bot.path.length) {
          const dest = bot.team === 'attack' ? ctx.attackSiteNode : bot.holdNode;
          setPath(bot, dest || 'midC');
        }
        const node = waypoints[bot.path[Math.min(bot.pathIdx, bot.path.length - 1)]];
        if (node && moveToward(bot, node.x, node.z, bot.team === 'attack' ? PUSH_SPEED : WALK_SPEED, dt)) {
          bot.pathIdx += 1;
          if (bot.pathIdx >= bot.path.length) {
            bot.path = [];
            bot.state = 'hold';
          }
        }
        break;
      }
      case 'cover': {
        if (!bot.path.length) {
          const near = Object.keys(waypoints).filter((id) => {
            const w = waypoints[id];
            return Math.hypot(w.x - bot.pos.x, w.z - bot.pos.z) < 9;
          });
          setPath(bot, near.length ? near[Math.floor(random() * near.length)] : bot.holdNode || 'midC');
        }
        const node = waypoints[bot.path[Math.min(bot.pathIdx, bot.path.length - 1)]];
        if (node && moveToward(bot, node.x, node.z, WALK_SPEED, dt)) {
          bot.pathIdx += 1;
          if (bot.pathIdx >= bot.path.length) {
            bot.path = [];
            bot.state = 'hold';
            bot.health = Math.min(bot.health + 20, 100);
          }
        }
        break;
      }
      case 'retake': {
        // Converge on the planted site; once there, hold and clear it.
        if (!bot.path.length) {
          bot.state = 'hold';
          break;
        }
        const node = waypoints[bot.path[Math.min(bot.pathIdx, bot.path.length - 1)]];
        if (node && moveToward(bot, node.x, node.z, PUSH_SPEED, dt)) {
          bot.pathIdx += 1;
          if (bot.pathIdx >= bot.path.length) {
            bot.path = [];
            bot.state = 'hold';
          }
        }
        break;
      }
      case 'defuse': {
        const bomb = ctx.bombPos;
        if (!bomb) {
          bot.state = 'hold';
          break;
        }
        const d = Math.hypot(bomb.x - bot.pos.x, bomb.z - bot.pos.z);
        if (d > 1.6) {
          moveToward(bot, bomb.x, bomb.z, PUSH_SPEED, dt);
          bot.defusing = false;
        } else {
          bot.vel.x = 0;
          bot.vel.z = 0;
          bot.defusing = true;
          if (!bot.announcedDefuse) {
            bot.announcedDefuse = true;
            callout(bot, 'Defusing — cover me!', ctx);
          }
          faceTarget(bot, { pos: bomb }, dt);
        }
        break;
      }
      case 'engage': {
        if (!bot.target) {
          bot.state = bot.team === 'defend' ? 'hold' : 'move';
          break;
        }
        faceTarget(bot, bot.target, dt);
        bot.reactLeft -= dt;
        if (bot.reactLeft <= 0) {
          bot.pauseLeft -= dt;
          if (bot.pauseLeft <= 0) {
            if (bot.burstLeft <= 0) {
              bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
              bot.pauseLeft = 0.45 + random() * 0.45;
              bot.strafeDir = random() < 0.5 ? -1 : 1;
              bot.strafeLeft = 0.4 + random() * 0.5;
            }
            bot.shotTimer -= dt;
            if (bot.shotTimer <= 0 && bot.burstLeft > 0) {
              bot.shotTimer = 0.11;
              bot.burstLeft -= 1;
              shootAt(bot, bot.target, ctx);
              ctx.onBotShot(bot);
            }
          }
          // Strafe while fighting.
          bot.strafeLeft -= dt;
          if (bot.strafeLeft <= 0) {
            bot.strafeDir *= -1;
            bot.strafeLeft = 0.5 + random() * 0.6;
          }
          const sx = Math.cos(bot.yaw) * bot.strafeDir;
          const sz = -Math.sin(bot.yaw) * bot.strafeDir;
          bot.vel.x += (sx * 1.8 - bot.vel.x) * Math.min(1, dt * 6);
          bot.vel.z += (sz * 1.8 - bot.vel.z) * Math.min(1, dt * 6);
          moveAxis(colliders, bot.pos, bot.vel, dt, BOT_RADIUS, BOT_HEIGHT);
        }
        break;
      }
      default:
        break;
    }

    // Walk cycle: hip-pivoted legs swing, torso leans into the run; in a
    // firefight the arms rise and the rifle points at the target.
    const speed = Math.hypot(bot.vel.x, bot.vel.z);
    const swing = speed > 0.3 ? Math.sin(ctx.time * 9) * 0.5 : 0;
    bot.legL.rotation.x = swing;
    bot.legR.rotation.x = -swing;
    bot.group.rotation.x = speed > 0.3 ? 0.06 : 0;
    const aim = bot.state === 'engage' ? -1.32 : -1.05;
    bot.armL.rotation.x = aim;
    bot.armR.rotation.x = aim;
  }

  function step(dt, ctx) {
    for (const t of tracers) {
      if (t.left > 0) {
        t.left -= dt;
        t.line.material.opacity = Math.max(0, t.left / 0.07) * 0.85;
        if (t.left <= 0) t.line.visible = false;
      }
    }
    for (const bot of bots) stepBot(bot, dt, ctx);
  }

  // TEAM PLAN — roles for the round. Attackers: an entry fragger leads the
  // push, a support cuts mid rotations, a lurker takes the long lane, and
  // the fourth entry follows the planter (the player carries the bomb).
  // Defenders: two hold A, two hold B, one roams mid. announcePlan() reads
  // the plan out on the radio at the start of the round (main.js calls it).
  const ATTACK_ROLES = ['entry', 'support', 'lurk', 'entry'];
  const DEFEND_ROLES = ['holdA', 'holdB', 'holdA', 'holdB', 'mid'];

  function announcePlan(attackSite, ctx) {
    const entry = bots.find((b) => b.team === 'attack' && b.role === 'entry');
    const support = bots.find((b) => b.team === 'attack' && b.role === 'support');
    const holder = bots.find((b) => b.team === 'defend' && b.role === (attackSite === 'A' ? 'holdA' : 'holdB'));
    if (entry) callout(entry, `Rushing site ${attackSite} via ${attackSite === 'A' ? 'west lane' : 'east lane'}!`, ctx);
    if (support) callout(support, 'Pushing mid to cut rotations.', ctx);
    if (holder) callout(holder, `Holding site ${attackSite} — two on ${attackSite === 'A' ? 'B' : 'A'}.`, ctx);
  }

  function spawnRound(attackSite, randomFn) {
    // Defenders: two hold A, two hold B, one roams mid.
    const defHolds = shuffle(randomFn, ['defA1', 'defA2', 'defB1', 'defB2', 'defMid']);
    const defSpawns = world.spawns.defend;
    const attSpawns = world.spawns.attack;
    let di = 0;
    let ai = 0;
    for (const bot of bots) {
      if (bot.team === 'defend') {
        const s = defSpawns[di % defSpawns.length];
        di += 1;
        bot.pos.copy(s);
        bot.pos.y = 0;
        bot.yaw = Math.PI; // face south, into the yard
        bot.holdNode = defHolds[di - 1];
        bot.role = DEFEND_ROLES[di - 1];
        bot.state = 'hold';
        bot.path = [];
      } else {
        const s = attSpawns[ai % attSpawns.length];
        ai += 1;
        bot.pos.copy(s);
        bot.pos.y = 0;
        bot.yaw = 0; // face north
        bot.holdNode = attackSite === 'A' ? 'siteA' : 'siteB';
        bot.role = ATTACK_ROLES[ai - 1];
        bot.state = 'move';
        bot.path = [];
      }
      bot.vel.set(0, 0, 0);
      bot.health = 100;
      bot.alive = true;
      bot.target = null;
      bot.defusing = false;
      bot.announcedDefuse = false;
      bot.blindLeft = 0;
      bot.lastCallout = -99;
      bot.fallT = 0;
      bot.group.rotation.set(0, bot.yaw, 0);
      bot.group.position.y = 0;
      bot.group.visible = true;
    }
  }

  function createTeams() {
    const defSpawns = world.spawns.defend;
    const attSpawns = world.spawns.attack;
    NAMES_DEFEND.forEach((name, i) => {
      makeBot('defend', name, defSpawns[i % defSpawns.length], Math.PI);
    });
    NAMES_ATTACK.forEach((name, i) => {
      makeBot('attack', name, attSpawns[i % attSpawns.length], 0);
    });
  }

  createTeams();

  // Flashbang: every living bot with line of sight to the burst and inside
  // 26 m is blinded — longer up close, briefly at the edge.
  function blindBots(pos) {
    for (const bot of bots) {
      if (!bot.alive) continue;
      const eye = new THREE.Vector3(bot.pos.x, bot.pos.y + BOT_EYE, bot.pos.z);
      const d = eye.distanceTo(pos);
      if (d > 26) continue;
      if (!hasLineOfSight(pos, eye, shootMeshes, [])) continue;
      bot.blindLeft = Math.max(bot.blindLeft, 1 + 1.8 * (1 - d / 26));
      bot.target = null;
      if (bot.state === 'engage') bot.state = bot.team === 'defend' ? 'hold' : 'move';
    }
  }

  return {
    bots,
    step,
    spawnRound,
    announcePlan,
    damageBot,
    blindBots,
    aliveCount(team) {
      return bots.filter((b) => b.team === team && b.alive).length;
    },
    get attackers() {
      return bots.filter((b) => b.team === 'attack');
    },
    get defenders() {
      return bots.filter((b) => b.team === 'defend');
    },
  };
}
