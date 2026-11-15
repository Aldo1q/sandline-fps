# SANDLINE — Dustline Yard

[![threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/Aldo1q/sandline-fps/rank.svg)](https://make.fun/bounty/threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/Aldo1q/sandline-fps/reward.svg)](https://make.fun/bounty/threejs-fps-02)

A round-based tactical FPS in three.js, built for the make.fun
[`threejs-fps-02`](https://make.fun/bounty/threejs-fps-02) bounty.
Counter-Strike style, original map, art and names.

## Play

Serve the `game/` folder as static files and open it in desktop Chrome:

```sh
node serve.ts
# open http://localhost:8080
```

Click to play (pointer lock). Single-player against bots.

## The game

- **Dustline Yard** — an original map: mid wall with two door gaps,
  warehouses east and west, bomb sites A and B, long corridors, a
  watchtower. Sand, teal and rust palette.
- **4 weapons** — P9 sidearm, VK-47 rifle, KX-9 SMG, LR-80 marksman.
  Magazines, reserves, reloads, recoil and spread that punish firing
  on the move; headshots deal more damage.
- **2 grenades** — frag (arc, bounce, explosion falloff) and smoke
  (12 s cloud bots cannot see through).
- **9 bots** — 4 Vanguard attackers (your team) and 5 Raider defenders.
  Waypoint-graph pathfinding, line-of-sight and view-cone perception,
  hearing (they investigate gunfire), burst fire with reaction time,
  strafing, taking cover when hurt, defusing behaviour.
- **Rounds** — buy phase (15 s), live round (100 s), end (4 s).
  Win by eliminating the other team or by the bomb: plant (hold E,
  3 s) at A or B, 35 s fuse, defuse (5 s channel). First to 5 wins
  the match.
- **Economy** — kill +$300, plant +$300, round win +$3250, loss +$1900
  with a loss-streak bonus up to $3400. Buy menu (B) with 6 items:
  3 weapons, 2 grenades, Kevlar vest.
- **HUD** — health/armour, ammo, money, round timer, score, alive
  counts, killfeed, hitmarker, dynamic crosshair, bomb timer, plant
  bar, damage flash, 2D minimap with seen-enemy tracking.
- **Sound** — synthesised WebAudio effects, no audio files.
- Fixed 60 Hz simulation; spectate-on-death.

## Controls

| Key | Action |
| --- | --- |
| W A S D | Move |
| Mouse | Look |
| Click | Fire |
| R | Reload |
| Ctrl / C | Crouch |
| Space | Jump |
| 1 – 4 | Weapons |
| G | Frag grenade |
| T | Smoke grenade |
| E (hold) | Plant the bomb |
| B | Buy menu |

## Deterministic screenshots

`?shot=start|play|buy|end&seed=N` stages a fixed scene and sets
`window.__shotReady` once rendered — used for the entry screenshots
in `screenshots/`.

## Tech

- three.js 0.187.0, vendored byte-for-byte under
  `game/vendor/three/` (one import map, `"three"` → the module).
- ES modules, no build step, no network requests at runtime.
- `main.ts` (Node 22, stdlib only) copies `game/` and `screenshots/`
  to `/output` and writes `/output/dossier.json` with
  `vendor/makefun-threejs.ts`.

## License

MIT — see `LICENSE`.
