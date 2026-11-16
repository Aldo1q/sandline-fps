// hearing.js — the hearing bus. One shared list of sounds: gunfire, blasts
// and footsteps, each with a position, a kind and a loudness range. The
// simulation posts to it (main.js: shots, explosions, the player's steps);
// bots read it (bots.js) and investigate what they hear. Nothing here knows
// about teams or the map — it is just a timed list of noises.
export function createHearing() {
  const events = []; // { pos: Vector3, kind, range, time }
  const RANGES = { shot: 26, boom: 30, step: 9 };

  function post(pos, kind, time) {
    events.push({ pos: pos.clone(), kind, range: RANGES[kind] || 9, time });
    if (events.length > 16) events.shift();
  }

  // The loudest event this position could have heard recently, or null.
  // maxAge keeps stale gunfire from pulling bots across the map forever.
  function heardBy(pos, time, maxAge = 1.5) {
    let best = null;
    let bestScore = -1;
    for (let i = events.length - 1; i >= 0; i -= 1) {
      const e = events[i];
      if (time - e.time > maxAge) continue;
      const d = Math.hypot(e.pos.x - pos.x, e.pos.z - pos.z);
      if (d > e.range) continue;
      const score = e.range - d;
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  function prune(time) {
    while (events.length && time - events[0].time > 2) events.shift();
  }

  return { post, heardBy, prune, get events() { return events; } };
}
